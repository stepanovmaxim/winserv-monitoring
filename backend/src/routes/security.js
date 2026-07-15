const express = require('express');
const db = require('../db');
const { requireAuth, requireApproved, requireAdmin } = require('../middleware/authMiddleware');
const { sendTelegramMessage } = require('../services/telegram');
const { sendWebhookAlert } = require('../services/webhookService');
const { logAlert } = require('../services/alertLog');
const { autoBanFromBruteforce, queueBlock, queueUnblock, canBan } = require('../services/banService');
const { PROTECTED } = require('../lib/ipGuard');

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
    const server = await db.queryOne('SELECT id, hostname, customer_id, platform FROM servers WHERE id = $1', [serverId]);
    for (const r of rows) {
      const key = serverId + ':' + r.ip;
      // Alert is rate-limited to once/hour per IP...
      if (Date.now() - (bruteAlerted.get(key) || 0) >= 60 * 60 * 1000) {
        bruteAlerted.set(key, Date.now());
        const kind = server.platform === 'linux' ? 'SSH' : 'RDP';
        const msg = `<b>${kind} brute-force</b> on ${server.hostname}: ${r.n} failed logons from ${r.ip} in the last hour`;
        sendTelegramMessage(msg).catch(() => {});
        sendWebhookAlert(msg);
        logAlert({ severity: 'critical', kind: 'security', message: msg, server_id: server.id, customer_id: server.customer_id });
      }
      // ...but auto-ban is evaluated every time (own dedupe via active ip_blocks),
      // so an IP that climbs past the ban threshold later still gets banned.
      await autoBanFromBruteforce(server, r.ip, r.n, config);
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

// Built-in never-ban ranges — always protected, shown read-only in Settings.
router.get('/protected-ranges', requireAuth, requireApproved, (req, res) => {
  res.json(PROTECTED);
});

// Active IP blocks across the fleet.
router.get('/blocks', requireAuth, requireApproved, async (req, res) => {
  const rows = await db.queryAll(
    `SELECT b.*, s.hostname FROM ip_blocks b LEFT JOIN servers s ON s.id = b.server_id
     WHERE b.unblocked_at IS NULL ORDER BY b.created_at DESC LIMIT 500`
  );
  res.json(rows);
});

// Manual block: guarded like auto-ban — local/allowlisted IPs are refused.
router.post('/block', requireAuth, requireAdmin, async (req, res) => {
  const { ip, server_ids, minutes } = req.body;
  if (!ip) return res.status(400).json({ error: 'ip required' });
  if (!(await canBan(ip))) return res.status(400).json({ error: `${ip} is a local/reserved/allowlisted address and cannot be blocked` });
  const ids = Array.isArray(server_ids) ? server_ids : [];
  let queued = 0;
  for (const sid of ids) {
    const server = await db.queryOne('SELECT id, hostname, customer_id FROM servers WHERE id = $1', [sid]);
    if (!server) continue;
    const r = await queueBlock(server, ip, { reason: 'manual', minutes: minutes || 0, requestedBy: req.user.email });
    if (r.ok) queued++;
  }
  res.json({ success: true, queued });
});

router.post('/unblock/:id', requireAuth, requireAdmin, async (req, res) => {
  const r = await queueUnblock(parseInt(req.params.id), req.user.email);
  if (!r.ok) return res.status(404).json({ error: r.why });
  res.json({ success: true });
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
