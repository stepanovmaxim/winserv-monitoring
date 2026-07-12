const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
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

  res.json({ success: true });
});

router.get('/:serverId', requireAuth, requireApproved, async (req, res) => {
  const items = await db.queryAll(
    'SELECT * FROM health_items WHERE server_id = $1 ORDER BY kind, name',
    [req.params.serverId]
  );
  res.json(items);
});

module.exports = router;
