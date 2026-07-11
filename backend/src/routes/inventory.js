const express = require('express');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();

const s = (v, n = 200) => String(v == null ? '' : v).slice(0, n);
const int = (v) => { const n = parseInt(v); return Number.isFinite(n) ? n : 0; };
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };

// Agent inventory report: hardware snapshot + installed-software list.
router.post('/', async (req, res) => {
  const { token, registration_key, hostname, hardware, software } = req.body;

  let serverId = null;
  if (token) {
    const a = await db.queryOne('SELECT server_id FROM agent_tokens WHERE token = $1', [token]);
    if (a) serverId = a.server_id;
  }
  if (!serverId && registration_key === REGISTRATION_KEY && hostname) {
    const srv = await db.queryOne('SELECT id FROM servers WHERE hostname = $1', [hostname]);
    if (srv) serverId = srv.id;
  }
  if (!serverId) return res.status(401).json({ error: 'Valid token or registration_key required' });

  const hw = hardware || {};
  const disks = Array.isArray(hw.disks) ? hw.disks.slice(0, 32).map(d => ({
    model: s(d.model, 120), size_gb: num(d.size_gb), media: s(d.media, 40),
  })) : [];

  await db.query(
    `INSERT INTO server_hardware (server_id, manufacturer, model, serial, os_caption, os_version, os_build,
        cpu, cpu_cores, cpu_logical, ram_gb, disks_json, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (server_id) DO UPDATE SET
        manufacturer=$2, model=$3, serial=$4, os_caption=$5, os_version=$6, os_build=$7,
        cpu=$8, cpu_cores=$9, cpu_logical=$10, ram_gb=$11, disks_json=$12, updated_at=NOW()`,
    [serverId, s(hw.manufacturer, 120), s(hw.model, 120), s(hw.serial, 120), s(hw.os_caption, 120),
     s(hw.os_version, 60), s(hw.os_build, 60), s(hw.cpu, 160), int(hw.cpu_cores), int(hw.cpu_logical),
     num(hw.ram_gb), JSON.stringify(disks)]
  );

  // Replace the software snapshot atomically.
  if (Array.isArray(software)) {
    const list = software
      .filter(x => x && x.name)
      .slice(0, 1000)
      .map(x => [serverId, s(x.name, 200), s(x.version, 60), s(x.publisher, 160), s(x.installed_on, 20)]);
    await db.query('DELETE FROM inventory_software WHERE server_id = $1', [serverId]);
    for (const row of list) {
      await db.query(
        'INSERT INTO inventory_software (server_id, name, version, publisher, installed_on) VALUES ($1,$2,$3,$4,$5)',
        row
      );
    }
  }

  await db.query('UPDATE servers SET inventory_at = NOW() WHERE id = $1', [serverId]);
  res.json({ success: true });
});

// Panel: hardware + software for one server.
router.get('/:serverId', requireAuth, requireApproved, async (req, res) => {
  const hw = await db.queryOne('SELECT * FROM server_hardware WHERE server_id = $1', [req.params.serverId]);
  const software = await db.queryAll(
    'SELECT name, version, publisher, installed_on FROM inventory_software WHERE server_id = $1 ORDER BY lower(name)',
    [req.params.serverId]
  );
  let disks = [];
  try { disks = hw ? JSON.parse(hw.disks_json || '[]') : []; } catch {}
  res.json({ hardware: hw ? { ...hw, disks } : null, software });
});

module.exports = router;
