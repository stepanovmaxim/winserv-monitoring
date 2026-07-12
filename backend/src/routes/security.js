const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const { sendTelegramMessage } = require('../services/telegram');
const { sendWebhookAlert } = require('../services/webhookService');
const { logAlert } = require('../services/alertLog');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();
const bruteAlerted = new Map(); // `${serverId}:${ip}` -> last alert ms

// Agent ingest of Security-log logons (4625 fails / 4624 RDP successes).
router.post('/', async (req, res) => {
  const { token, registration_key, hostname } = req.body;
  let { events } = req.body;
  if (typeof events === 'string') { try { events = JSON.parse(events); } catch { events = []; } }
  if (!Array.isArray(events)) events = [];
  if (events.length > 500) events = events.slice(0, 500);
  if (events.length === 0) return res.json({ success: true, count: 0 });

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

  let inserted = 0;
  for (const ev of events) {
    const type = ev.event === 'success' ? 'success' : 'fail';
    // Dedup: agents resend a lookback window, so skip an already-stored event
    // (same server/account/ip at the same timestamp).
    const r = await db.query(
      `INSERT INTO security_events (server_id, event, account, ip, logon_type, recorded_at)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE NOT EXISTS (
         SELECT 1 FROM security_events
         WHERE server_id = $1 AND event = $2 AND account = $3 AND ip = $4 AND recorded_at = $6
       )`,
      [serverId, type, ev.account || '', ev.ip || '', String(ev.logon_type || ''), ev.recorded_at || null]
    );
    if (r.rowCount > 0) inserted++;
  }

  if (inserted > 0) await detectBruteforce(serverId);
  res.json({ success: true, count: inserted });
});

async function detectBruteforce(serverId) {
  try {
    const config = await db.queryOne('SELECT * FROM telegram_config WHERE enabled = 1 LIMIT 1');
    if (!config || !config.notify_bruteforce) return;
    const threshold = parseInt(config.bruteforce_threshold) || 10;
    const rows = await db.queryAll(
      `SELECT ip, COUNT(*)::int n FROM security_events
       WHERE server_id = $1 AND event = 'fail' AND ip <> '' AND ip <> '-'
         AND created_at > NOW() - INTERVAL '1 hour'
       GROUP BY ip HAVING COUNT(*) >= $2`,
      [serverId, threshold]
    );
    if (rows.length === 0) return;
    const server = await db.queryOne('SELECT id, hostname, customer_id FROM servers WHERE id = $1', [serverId]);
    for (const r of rows) {
      const key = serverId + ':' + r.ip;
      if (Date.now() - (bruteAlerted.get(key) || 0) < 60 * 60 * 1000) continue;
      bruteAlerted.set(key, Date.now());
      const msg = `<b>RDP brute-force</b> on ${server.hostname}: ${r.n} failed logons from ${r.ip} in the last hour`;
      sendTelegramMessage(msg).catch(() => {});
      sendWebhookAlert(msg);
      logAlert({ severity: 'critical', kind: 'security', message: msg, server_id: server.id, customer_id: server.customer_id });
    }
  } catch (err) {
    console.error('[Bruteforce]', err.message);
  }
}

// Fleet view: top offending source IPs by failed logons.
router.get('/top', requireAuth, requireApproved, async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const rows = await db.queryAll(
    `SELECT se.ip, COUNT(*)::int fails, COUNT(DISTINCT se.server_id)::int servers,
        MAX(se.created_at) AS last_seen,
        (array_agg(DISTINCT s.hostname))[1:5] AS hostnames,
        array_agg(DISTINCT se.server_id) AS server_ids
     FROM security_events se JOIN servers s ON s.id = se.server_id
     WHERE se.event = 'fail' AND se.ip <> '' AND se.ip <> '-'
       AND se.created_at > NOW() - ($1 || ' hours')::INTERVAL
     GROUP BY se.ip ORDER BY fails DESC LIMIT 50`,
    [String(hours)]
  );
  res.json(rows);
});

// Per-server recent logons (success + fail).
router.get('/:serverId', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll(
    'SELECT * FROM security_events WHERE server_id = $1 ORDER BY created_at DESC LIMIT 200',
    [req.params.serverId]
  );
  res.json(rows);
});

module.exports = router;
