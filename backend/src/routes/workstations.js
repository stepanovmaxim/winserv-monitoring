const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const { customerFilter, canSeeCustomer } = require('../services/scopeService');
const { customerForDomain } = require('../services/tenantService');
const { resolveWorkstation } = require('../lib/workstationIdentity');
const { normalizeHostname } = require('../lib/hostname');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();

const s = (v, n = 200) => String(v == null ? '' : v).slice(0, n);
const int = (v) => { const n = parseInt(v); return Number.isFinite(n) ? n : 0; };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const ts = (v) => { const d = new Date(v); return isNaN(d.getTime()) ? null : d.toISOString(); };
const validDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')) ? v : null;

// Ingest: a relay (a domain host running our agent) posts a batch of PC configs
// it has collected from the GPO drop folder. Authenticated by the relay's own
// agent token, or the shared registration key. Workstations never talk to us
// directly - they write a file to an SMB share and the relay forwards it.
router.post('/report', async (req, res) => {
  const { token, registration_key } = req.body;
  const relayHost = s(req.body.relay_host, 120);

  let authed = false;
  if (token) {
    const a = await db.queryOne('SELECT server_id FROM agent_tokens WHERE token = $1', [token]);
    if (a) authed = true;
  }
  if (!authed && registration_key === REGISTRATION_KEY) authed = true;
  if (!authed) return res.status(401).json({ error: 'Valid token or registration_key required' });

  let list = req.body.workstations;
  if (typeof list === 'string') { try { list = JSON.parse(list); } catch { list = []; } }
  if (!Array.isArray(list)) list = [];
  if (list.length > 500) list = list.slice(0, 500);

  let saved = 0, clones = 0, renames = 0;
  for (const w of list) {
    try {
      const r = await upsertWorkstation(w, relayHost);
      if (r.saved) saved++;
      if (r.clone) clones++;
      if (r.rename) renames++;
    } catch (err) {
      console.error('[Workstations] one record failed:', err.message);
    }
  }
  res.json({ success: true, received: list.length, saved, clones, renames });
});

async function upsertWorkstation(w, relayHost) {
  const uid = s(w.uid, 60).trim();
  const hostname = normalizeHostname(w.hostname);
  const serial = s(w.serial, 120).trim();
  if (!uid && !hostname) return { saved: false };

  // Exact identity is the pair (uid, serial); anyByUid catches a clone off the
  // same image (same uid, different serial). See lib/workstationIdentity.
  const exactByUidSerial = uid
    ? await db.queryOne("SELECT id, hostname, serial, clone_of FROM workstations WHERE agent_uid = $1 AND COALESCE(serial,'') = $2", [uid, serial])
    : null;
  const anyByUid = (uid && !exactByUidSerial)
    ? await db.queryOne('SELECT id, hostname, serial, clone_of FROM workstations WHERE agent_uid = $1 ORDER BY id LIMIT 1', [uid])
    : null;
  const existingByHost = (!exactByUidSerial && !anyByUid && hostname)
    ? await db.queryOne('SELECT id, hostname, serial, clone_of FROM workstations WHERE LOWER(hostname) = LOWER($1) AND agent_uid IS NULL', [hostname])
    : null;

  const pick = resolveWorkstation({ exactByUidSerial, anyByUid, existingByHost, hostname, uid, serial });

  const disks = Array.isArray(w.disks) ? w.disks.slice(0, 32).map(d => ({
    model: s(d.model, 120), size_gb: num(d.size_gb), free_gb: num(d.free_gb),
    media: s(d.media, 40), health: s(d.health, 40),
  })) : [];
  const monitors = Array.isArray(w.monitors) ? w.monitors.slice(0, 16).map(m => ({
    manufacturer: s(m.manufacturer, 80), model: s(m.model, 120), serial: s(m.serial, 80),
  })) : [];
  const hotfixes = Array.isArray(w.hotfixes) ? w.hotfixes.slice(0, 60).map(h => ({
    id: s(h.id, 30), installed_on: validDate(h.installed_on),
  })).filter(h => h.id) : [];

  const customerId = await customerForDomain(w.ad_domain);

  const cols = {
    agent_uid: uid || null,
    hostname,
    ad_domain: s(w.ad_domain, 120), ad_ou: s(w.ad_ou, 400), ad_site: s(w.ad_site, 120),
    manufacturer: s(w.manufacturer, 120), model: s(w.model, 120), serial, chassis: s(w.chassis, 60),
    os_caption: s(w.os_caption, 120), os_version: s(w.os_version, 60), os_build: s(w.os_build, 60),
    cpu: s(w.cpu, 160), cpu_cores: int(w.cpu_cores), cpu_logical: int(w.cpu_logical), ram_gb: num(w.ram_gb),
    disks_json: JSON.stringify(disks), monitors_json: JSON.stringify(monitors),
    ip: s(w.ip, 60), mac: s(w.mac, 60), last_user: s(w.last_user, 120),
    last_boot: ts(w.last_boot), last_patch_date: validDate(w.last_patch_date),
    hotfixes_json: JSON.stringify(hotfixes),
    relay_host: relayHost, collected_at: ts(w.collected_at) || new Date().toISOString(),
    customer_id: customerId,
  };

  let workstationId = pick.workstationId;

  if (pick.action === 'create' || pick.action === 'clone') {
    const keys = Object.keys(cols).concat(pick.action === 'clone' ? ['clone_of'] : []);
    const vals = keys.map(k => (k === 'clone_of' ? pick.cloneOf : cols[k]));
    const ph = keys.map((_, i) => '$' + (i + 1));
    const row = await db.query(
      `INSERT INTO workstations (${keys.join(',')}) VALUES (${ph.join(',')}) RETURNING id`, vals
    );
    workstationId = row.rows[0].id;
    if (pick.action === 'clone') {
      console.warn('[Workstations] clone of #%s (shared MachineGuid, different serial): %s', pick.cloneOf, hostname);
    }
  } else {
    // Update: only overwrite customer_id when we resolved one, never blank it.
    const keys = Object.keys(cols).filter(k => !(k === 'customer_id' && customerId == null));
    const set = keys.map((k, i) => `${k} = $${i + 1}`).concat('updated_at = NOW()');
    const vals = keys.map(k => cols[k]);
    vals.push(workstationId);
    await db.query(`UPDATE workstations SET ${set.join(', ')} WHERE id = $${vals.length}`, vals);
    if (pick.renamedFrom) {
      console.warn('[Workstations] #%s renamed: "%s" -> "%s"', workstationId, pick.renamedFrom, hostname);
    }
  }

  // Replace the software snapshot for this PC.
  if (Array.isArray(w.software)) {
    const soft = w.software.filter(x => x && x.name).slice(0, 2000).map(x => ({
      name: s(x.name, 200), version: s(x.version, 80), publisher: s(x.publisher, 160),
      installed_on: s(x.installed_on, 40),
    }));
    await db.query('DELETE FROM workstation_software WHERE workstation_id = $1', [workstationId]);
    for (const p of soft) {
      await db.query(
        'INSERT INTO workstation_software (workstation_id, name, version, publisher, installed_on) VALUES ($1,$2,$3,$4,$5)',
        [workstationId, p.name, p.version, p.publisher, p.installed_on]
      );
    }
  }

  return { saved: true, clone: pick.action === 'clone', rename: !!pick.renamedFrom };
}

// Panel: list workstations, scoped to what the user may see.
router.get('/', requireAuth, requireApproved, async (req, res) => {
  const scoped = await customerFilter(req.user, 'w.customer_id', 1);
  const rows = await db.queryAll(
    `SELECT w.id, w.hostname, w.ad_domain, w.ad_ou, w.manufacturer, w.model, w.os_caption,
        w.os_build, w.cpu, w.ram_gb, w.disks_json, w.ip, w.last_user, w.last_boot, w.last_patch_date,
        w.clone_of, w.relay_host, w.collected_at, w.customer_id, c.name AS customer_name
     FROM workstations w LEFT JOIN customers c ON c.id = w.customer_id
     WHERE 1=1${scoped.sql} ORDER BY w.hostname LIMIT 2000`,
    scoped.params
  );
  res.json(rows);
});

// Panel: one workstation with its full config and software list.
router.get('/:id', requireAuth, requireApproved, async (req, res) => {
  const w = await db.queryOne('SELECT * FROM workstations WHERE id = $1', [req.params.id]);
  if (!w) return res.status(404).json({ error: 'Not found' });
  if (w.customer_id && !(await canSeeCustomer(req.user, w.customer_id))) {
    return res.status(403).json({ error: 'No access' });
  }
  const software = await db.queryAll(
    'SELECT name, version, publisher, installed_on FROM workstation_software WHERE workstation_id = $1 ORDER BY name',
    [req.params.id]
  );
  res.json({ ...w, software });
});

module.exports = router;
