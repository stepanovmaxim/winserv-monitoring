const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const { requireServerAccess, customerFilter } = require('../services/scopeService');
const { sendTelegramMessage } = require('../services/telegram');
const { sendWebhookAlert } = require('../services/webhookService');
const { isMuted } = require('../services/maintenanceService');
const { parseIgnore, isIgnoredService } = require('../services/serviceFilter');
const { logAlert } = require('../services/alertLog');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();
const certAlerted = new Map();

function notify(text, muted, meta = {}) {
  if (muted) return;
  sendTelegramMessage(text).catch(() => {});
  sendWebhookAlert(text);
  logAlert({ message: text, ...meta });
}

// Agent deep-health report (services, certs, failed tasks, pending reboot).
router.post('/', async (req, res) => {
  const { token, registration_key, hostname, pending_reboot } = req.body;
  let { services, certs, tasks } = req.body;

  let serverId = null;
  if (token) {
    const a = await db.queryOne('SELECT server_id FROM agent_tokens WHERE token = $1', [token]);
    if (a) serverId = a.server_id;
  }
  if (!serverId && registration_key === REGISTRATION_KEY && hostname) {
    const s = await db.queryOne('SELECT id FROM servers WHERE hostname = $1', [hostname]);
    if (s) serverId = s.id;
  }
  if (!serverId) return res.status(401).json({ error: 'Valid token or registration_key required' });

  const ignoreRow = await db.queryOne('SELECT service_ignore FROM telegram_config LIMIT 1');
  const ignoreList = parseIgnore(ignoreRow ? ignoreRow.service_ignore : undefined);
  services = (Array.isArray(services) ? services : []).filter(s => !isIgnoredService(s && s.name, ignoreList)).slice(0, 500);
  certs = (Array.isArray(certs) ? certs : []).slice(0, 500);
  tasks = (Array.isArray(tasks) ? tasks : []).slice(0, 500);

  const server = await db.queryOne('SELECT id, hostname, group_id, customer_id, health_at FROM servers WHERE id = $1', [serverId]);
  if (!server) return res.status(404).json({ error: 'server not found' });
  const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
  const muted = await isMuted(server);
  const firstReport = !server.health_at; // don't alert on the baseline snapshot

  // Service stop/recover alerts by diffing against the stored snapshot.
  if (config && !firstReport) {
    const prev = await db.queryAll("SELECT name FROM health_items WHERE server_id = $1 AND kind = 'service_stopped'", [serverId]);
    const prevSet = new Set(prev.map(p => p.name));
    const newSet = new Set(services.map(s => s.name));
    const added = services.filter(s => !prevSet.has(s.name));
    const recovered = [...prevSet].filter(n => !newSet.has(n));
    if (added.length) notify(`<b>Service stopped</b> on ${server.hostname}: ${added.map(s => s.display || s.name).join(', ')}`, muted, { severity: 'critical', kind: 'service', server_id: server.id, customer_id: server.customer_id });
    if (recovered.length) notify(`<b>Service recovered</b> on ${server.hostname}: ${recovered.join(', ')}`, muted, { severity: 'info', kind: 'service', server_id: server.id, customer_id: server.customer_id });
  }

  // Replace the snapshot.
  await db.query('DELETE FROM health_items WHERE server_id = $1', [serverId]);
  for (const s of services) {
    await db.query("INSERT INTO health_items (server_id, kind, name, detail) VALUES ($1, 'service_stopped', $2, $3)", [serverId, s.name || '', s.display || '']);
  }
  for (const c of certs) {
    await db.query("INSERT INTO health_items (server_id, kind, name, expires_at) VALUES ($1, 'cert_expiring', $2, $3)", [serverId, c.subject || '', c.expires || null]);
  }
  for (const t of tasks) {
    await db.query("INSERT INTO health_items (server_id, kind, name, detail) VALUES ($1, 'task_failed', $2, $3)", [serverId, t.name || '', 'result ' + (t.result != null ? t.result : '?')]);
  }
  await db.query('UPDATE servers SET pending_reboot = $1, health_at = NOW() WHERE id = $2', [pending_reboot ? 1 : 0, serverId]);

  // Certificate expiry alerts (within 7 days, once/day per cert).
  if (config && !muted) {
    for (const c of certs) {
      if (!c.expires) continue;
      const days = (new Date(c.expires).getTime() - Date.now()) / 86400000;
      if (days <= 7) {
        const key = serverId + ':' + (c.subject || '');
        if (Date.now() - (certAlerted.get(key) || 0) > 24 * 60 * 60 * 1000) {
          certAlerted.set(key, Date.now());
          notify(`<b>Certificate expiring</b> on ${server.hostname}: ${c.subject} (${c.expires})`, muted, { severity: 'warning', kind: 'cert', server_id: server.id, customer_id: server.customer_id });
        }
      }
    }
  }

  // --- Microsoft Defender posture + detections ---
  try { await ingestDefender(server, req.body.defender, config, muted); }
  catch (e) { console.error('[Defender]', e.message); }

  // --- Ransomware early warning ---
  try { await ingestRansomware(server, req.body.ransomware, config, muted); }
  catch (e) { console.error('[Ransomware]', e.message); }

  res.json({ success: true });
});

// Remembers which posture warning we already sent, so a permanently-misconfigured
// host reports once a day instead of every ten minutes.
const defenderAlerted = new Map();
function onceADay(key) {
  const last = defenderAlerted.get(key) || 0;
  if (Date.now() - last < 24 * 60 * 60 * 1000) return false;
  defenderAlerted.set(key, Date.now());
  return true;
}

async function ingestDefender(server, d, config, muted) {
  if (!d || typeof d !== 'object') return;
  const b = (v) => (v ? 1 : 0);
  const age = (v) => (v === null || v === undefined || v === '' ? null : parseInt(v));

  await db.query(
    `INSERT INTO defender_status (server_id, available, av_enabled, realtime_enabled, behavior_monitor,
       tamper_protected, signature_age_days, signature_updated, quick_scan_age_days, full_scan_age_days,
       engine_version, product_version, third_party, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,NOW())
     ON CONFLICT (server_id) DO UPDATE SET available=$2, av_enabled=$3, realtime_enabled=$4,
       behavior_monitor=$5, tamper_protected=$6, signature_age_days=$7, signature_updated=$8,
       quick_scan_age_days=$9, full_scan_age_days=$10, engine_version=$11, product_version=$12,
       third_party=$13, updated_at=NOW()`,
    [server.id, b(d.available), b(d.av_enabled), b(d.realtime_enabled), b(d.behavior_monitor),
     b(d.tamper_protected), age(d.signature_age_days), d.signature_updated || null,
     age(d.quick_scan_age_days), age(d.full_scan_age_days),
     String(d.engine_version || '').slice(0, 60), String(d.product_version || '').slice(0, 60),
     String(d.third_party || '').slice(0, 200)]
  );

  // Malware detections: store new ones and alert on each.
  const threats = Array.isArray(d.threats) ? d.threats.slice(0, 25) : [];
  for (const t of threats) {
    if (!t || !t.name || !t.detected_at) continue;
    const r = await db.query(
      `INSERT INTO threat_detections (server_id, name, resource, action_success, detected_at)
       VALUES ($1,$2,$3,$4,$5) ON CONFLICT (server_id, name, detected_at) DO NOTHING`,
      [server.id, String(t.name).slice(0, 200), String(t.resource || '').slice(0, 400), b(t.action_success), t.detected_at]
    );
    if (r.rowCount > 0 && config) {
      const cleaned = t.action_success ? ' (neutralised)' : ' — <b>NOT neutralised</b>';
      notify(`<b>MALWARE</b> on ${server.hostname}: ${t.name}${cleaned}${t.resource ? '\n' + String(t.resource).slice(0, 200) : ''}`,
        muted, { severity: 'critical', kind: 'malware', server_id: server.id, customer_id: server.customer_id });
    }
  }

  if (!config || !config.notify_defender) return;

  // A third-party AV puts Defender into passive mode, so "off" is expected there
  // and must not be reported as an unprotected host.
  if (!d.available || d.third_party) return;

  const sigMax = parseInt(config.defender_signature_days) || 3;
  const scanMax = parseInt(config.defender_scan_days) || 14;
  const k = (s) => `${server.id}:${s}`;
  const meta = { kind: 'antivirus', server_id: server.id, customer_id: server.customer_id };

  if (!d.av_enabled && onceADay(k('av')))
    notify(`<b>ANTIVIRUS OFF</b> on ${server.hostname}: Microsoft Defender is disabled`, muted, { severity: 'critical', ...meta });
  else if (!d.realtime_enabled && onceADay(k('rtp')))
    notify(`<b>Real-time protection OFF</b> on ${server.hostname}`, muted, { severity: 'critical', ...meta });

  const sigAge = age(d.signature_age_days);
  if (sigAge !== null && sigAge > sigMax && onceADay(k('sig')))
    notify(`<b>Antivirus signatures stale</b> on ${server.hostname}: ${sigAge} days old (>${sigMax})`, muted, { severity: 'warning', ...meta });

  const quick = age(d.quick_scan_age_days), full = age(d.full_scan_age_days);
  const scanned = [quick, full].filter(v => v !== null);
  const bestScan = scanned.length ? Math.min(...scanned) : null;
  if (bestScan === null && onceADay(k('noscan')))
    notify(`<b>Antivirus never scanned</b> on ${server.hostname}: no quick or full scan on record`, muted, { severity: 'warning', ...meta });
  else if (bestScan !== null && bestScan > scanMax && onceADay(k('scan')))
    notify(`<b>Antivirus scan overdue</b> on ${server.hostname}: last scan ${bestScan} days ago (>${scanMax})`, muted, { severity: 'warning', ...meta });
}

// Ransomware signals. A tripped canary means files are being rewritten right
// now; shadow copies going to zero is the step attackers take immediately before
// encrypting. An UNKNOWN shadow count (WMI unavailable) is never treated as
// "restore points deleted" — that would alarm on a permissions problem.
const ransomAlerted = new Map();
async function ingestRansomware(server, r, config, muted) {
  if (!r || typeof r !== 'object') return;

  const num = (v) => (v === null || v === undefined || v === '' ? null : parseInt(v));
  const shadows = num(r.shadow_copies);
  const tripped = num(r.canary_tripped) || 0;
  const total = num(r.canary_total) || 0;
  const detail = Array.isArray(r.tripped) ? r.tripped.slice(0, 5).join('; ').slice(0, 400) : '';

  const prev = await db.queryOne('SELECT shadow_copies FROM ransomware_status WHERE server_id = $1', [server.id]);
  const prevShadows = prev ? num(prev.shadow_copies) : null;

  await db.query(
    `INSERT INTO ransomware_status (server_id, canary_enabled, canary_total, canary_tripped, tripped_detail,
        shadow_copies, prev_shadow_copies, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
     ON CONFLICT (server_id) DO UPDATE SET canary_enabled=$2, canary_total=$3, canary_tripped=$4,
        tripped_detail=$5, shadow_copies=$6, prev_shadow_copies=$7, updated_at=NOW()`,
    [server.id, r.canary_enabled ? 1 : 0, total, tripped, detail, shadows, prevShadows]
  );

  if (!config || !config.notify_ransomware) return;
  const meta = { kind: 'ransomware', server_id: server.id, customer_id: server.customer_id };

  // Canary tripped — loud, and repeated while it keeps happening (this is live).
  if (tripped > 0) {
    const k = server.id + ':canary';
    if (Date.now() - (ransomAlerted.get(k) || 0) > 10 * 60 * 1000) {
      ransomAlerted.set(k, Date.now());
      notify(`<b>RANSOMWARE SUSPECTED</b> on ${server.hostname}: ${tripped} of ${total} canary file(s) were modified — files are being rewritten right now.\n${detail}`,
        muted, { severity: 'critical', ...meta });
    }
  }

  // Restore points wiped: only when both readings are known.
  if (prevShadows !== null && shadows !== null && prevShadows > 0 && shadows === 0) {
    const k = server.id + ':shadows';
    if (Date.now() - (ransomAlerted.get(k) || 0) > 60 * 60 * 1000) {
      ransomAlerted.set(k, Date.now());
      notify(`<b>SHADOW COPIES DELETED</b> on ${server.hostname}: ${prevShadows} restore point(s) disappeared. This is the usual step right before encryption — verify immediately.`,
        muted, { severity: 'critical', ...meta });
    }
  }
}

// Fleet ransomware view.
router.get('/ransomware/fleet', requireAuth, requireApproved, async (req, res) => {
  const scoped = await customerFilter(req.user, 's.customer_id', 1);
  const rows = await db.queryAll(
    `SELECT s.id AS server_id, s.hostname, c.name AS customer_name, r.*
     FROM servers s
     LEFT JOIN ransomware_status r ON r.server_id = s.id
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.platform <> 'linux'${scoped.sql}
     ORDER BY COALESCE(r.canary_tripped,0) DESC, s.hostname`,
    scoped.params
  );
  res.json(rows);
});

// Fleet antivirus posture. Ordered worst-first so problems surface at the top.
router.get('/defender/fleet', requireAuth, requireApproved, async (req, res) => {
  const scoped = await customerFilter(req.user, 's.customer_id', 1);
  const rows = await db.queryAll(
    `SELECT s.id AS server_id, s.hostname, s.status, c.name AS customer_name, d.*,
        (SELECT COUNT(*)::int FROM threat_detections t
          WHERE t.server_id = s.id AND t.detected_at > NOW() - INTERVAL '7 days') AS threats_7d
     FROM servers s
     LEFT JOIN defender_status d ON d.server_id = s.id
     LEFT JOIN customers c ON c.id = s.customer_id
     WHERE s.platform <> 'linux'${scoped.sql}
     ORDER BY
       (d.server_id IS NULL) DESC,
       (d.available = 1 AND d.av_enabled = 0) DESC,
       (d.available = 1 AND d.realtime_enabled = 0) DESC,
       COALESCE(d.signature_age_days, 999) DESC,
       s.hostname`,
    scoped.params
  );
  res.json(rows);
});

// Recent malware detections across the fleet.
router.get('/defender/threats', requireAuth, requireApproved, async (req, res) => {
  const scoped = await customerFilter(req.user, 's.customer_id', 1);
  const rows = await db.queryAll(
    `SELECT t.*, s.hostname FROM threat_detections t JOIN servers s ON s.id = t.server_id
     WHERE t.detected_at > NOW() - INTERVAL '30 days'${scoped.sql}
     ORDER BY t.detected_at DESC LIMIT 200`,
    scoped.params
  );
  res.json(rows);
});

router.get('/:serverId', requireAuth, requireApproved, requireServerAccess(), async (req, res) => {
  const items = await db.queryAll(
    'SELECT * FROM health_items WHERE server_id = $1 ORDER BY kind, name',
    [req.params.serverId]
  );
  res.json(items);
});

module.exports = router;
