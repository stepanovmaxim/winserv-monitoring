const express = require('express');
const { normalizeHostname } = require('../lib/hostname');
const db = require('../db');
const { requireAuth, requireApproved, requireAdmin } = require('../middleware/authMiddleware');
const { sendTelegramMessage } = require('../services/telegram');
const { sendWebhookAlert } = require('../services/webhookService');
const { logAlert } = require('../services/alertLog');
const { runAutoban, queueBlock, queueUnblock, canBan } = require('../services/banService');
const { PROTECTED, isPrivateOrReserved } = require('../lib/ipGuard');
const { logonKind } = require('../lib/logonKind');
const { serverLabel } = require('../lib/serverLabel');
const { serviceOwner } = require('../lib/serviceRanges');
const { customerFilter, canSeeServer, requireServerAccess } = require('../services/scopeService');

const REGISTRATION_KEY = process.env.REGISTRATION_KEY || 'winserv-reg-key-change-me';
const router = express.Router();
const bruteAlerted = new Map(); // `${serverId}:${ip}` -> last alert ms

// Agent ingest of Security-log logons (4625 fails / 4624 RDP successes).
router.post('/', async (req, res) => {
  const { token, registration_key, hostname: rawHostname } = req.body;
  const hostname = normalizeHostname(rawHostname);
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
    const s = await db.queryOne('SELECT id FROM servers WHERE LOWER(hostname) = LOWER($1)', [hostname]);
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
    if (!config) return;
    const server = await db.queryOne('SELECT id, hostname, display_name, customer_id, platform FROM servers WHERE id = $1', [serverId]);
    if (!server) return;

    // Alerts: fixed 1h window, once/hour per IP.
    if (config.notify_bruteforce) {
      const threshold = parseInt(config.bruteforce_threshold) || 10;
      // Per source IP: how many fails, how many distinct accounts, and the
      // dominant logon type + account. The logon type names the real vector
      // (RDP is 10; Exchange OWA/basic-auth is 8; MAPI/EWS/SMB is 3), and the
      // account count separates a genuine spray (many accounts) from a single
      // account failing over and over - which, especially from an internal
      // host, is almost always a stale saved password, not an attack.
      const rows = await db.queryAll(
        `SELECT ip, COUNT(*)::int n, COUNT(DISTINCT account)::int accounts,
                MODE() WITHIN GROUP (ORDER BY logon_type) AS logon_type,
                MODE() WITHIN GROUP (ORDER BY account) AS account
         FROM security_events
         WHERE server_id = $1 AND event = 'fail' AND ip <> '' AND ip <> '-'
           AND created_at > NOW() - INTERVAL '1 hour'
         GROUP BY ip HAVING COUNT(*) >= $2`,
        [serverId, threshold]
      );
      for (const r of rows) {
        const key = serverId + ':' + r.ip;
        if (Date.now() - (bruteAlerted.get(key) || 0) < 60 * 60 * 1000) continue;
        bruteAlerted.set(key, Date.now());
        const kind = logonKind(r.logon_type, server.platform);
        const acct = r.account || '?';
        const service = serviceOwner(r.ip);
        let msg, severity;
        if (r.accounts >= 2) {
          // Many accounts from one IP: a password spray. Still critical even
          // from a cloud service range - that would mean the service is
          // relaying an actual spray at us, which is worth waking up for.
          const via = service ? ` via ${service}` : '';
          msg = `<b>${kind} password-spray</b> on ${serverLabel(server)}: ${r.n} failed logons from ${r.ip}${via} across ${r.accounts} accounts in the last hour`;
          severity = 'critical';
        } else if (service) {
          // One account from the mail cloud: a client with a stale saved
          // password looping through Exchange Online, not an attack on us.
          msg = `<b>${kind} login failures</b> on ${serverLabel(server)}: ${r.n} for ${acct} from ${r.ip} (${service}) in the last hour — one account via a mail cloud, usually a device with a stale saved password, not an attack`;
          severity = 'warning';
        } else if (isPrivateOrReserved(r.ip)) {
          // One account from an internal host: a stale credential, not an attack.
          msg = `<b>${kind} login failures</b> on ${serverLabel(server)}: ${r.n} for ${acct} from ${r.ip} (internal) in the last hour — one account from an internal host, usually a stale saved password, not an attack`;
          severity = 'warning';
        } else {
          // One account from an external IP: targeted brute-force.
          msg = `<b>${kind} brute-force</b> on ${serverLabel(server)}: ${r.n} failed logons for ${acct} from ${r.ip} in the last hour`;
          severity = 'critical';
        }
        sendTelegramMessage(msg).catch(() => {});
        sendWebhookAlert(msg);
        logAlert({ severity, kind: 'security', message: msg, server_id: server.id, customer_id: server.customer_id });
      }
    }

    // Auto-ban runs fleet-wide on a scheduler (see index.js), not per-report —
    // a spray spread thin across servers only shows up in the aggregate.
    if (config.autoban_enabled) runAutoban().catch(() => {});
  } catch (err) {
    console.error('[Bruteforce]', err.message);
  }
}

// Fleet view: top offending source IPs by failed logons.
router.get('/top', requireAuth, requireApproved, async (req, res) => {
  const hours = Math.min(parseInt(req.query.hours) || 24, 168);
  const scopedTop = await customerFilter(req.user, 's.customer_id', 2);
  const rows = await db.queryAll(
    `SELECT se.ip, COUNT(*)::int fails, COUNT(DISTINCT se.server_id)::int servers,
        MAX(se.created_at) AS last_seen,
        (array_agg(DISTINCT s.hostname))[1:5] AS hostnames,
        array_agg(DISTINCT se.server_id) AS server_ids
     FROM security_events se JOIN servers s ON s.id = se.server_id
     WHERE se.event = 'fail' AND se.ip <> '' AND se.ip <> '-'
       AND se.created_at > NOW() - ($1 || ' hours')::INTERVAL${scopedTop.sql}
     GROUP BY se.ip ORDER BY fails DESC LIMIT 50`,
    [String(hours), ...scopedTop.params]
  );
  res.json(rows);
});

// Built-in never-ban ranges — always protected, shown read-only in Settings.
router.get('/protected-ranges', requireAuth, requireApproved, (req, res) => {
  res.json(PROTECTED);
});

// Active IP blocks across the fleet.
router.get('/blocks', requireAuth, requireApproved, async (req, res) => {
  const scopedB = await customerFilter(req.user, 's.customer_id', 1);
  const rows = await db.queryAll(
    `SELECT b.*, s.hostname FROM ip_blocks b LEFT JOIN servers s ON s.id = b.server_id
     WHERE b.unblocked_at IS NULL${scopedB.sql} ORDER BY b.created_at DESC LIMIT 500`,
    scopedB.params
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
    if (!(await canSeeServer(req.user, sid))) continue;
    const r = await queueBlock(server, ip, { reason: 'manual', minutes: minutes || 0, requestedBy: req.user.email });
    if (r.ok) queued++;
  }
  res.json({ success: true, queued });
});

router.post('/unblock/:id', requireAuth, requireAdmin, async (req, res) => {
  const b = await db.queryOne('SELECT server_id FROM ip_blocks WHERE id = $1', [req.params.id]);
  if (b && !(await canSeeServer(req.user, b.server_id))) return res.status(403).json({ error: 'No access to this server' });
  const r = await queueUnblock(parseInt(req.params.id), req.user.email);
  if (!r.ok) return res.status(404).json({ error: r.why });
  res.json({ success: true });
});

// Per-server recent logons (success + fail).
router.get('/:serverId', requireAuth, requireApproved, requireServerAccess(), async (req, res) => {
  const rows = await db.queryAll(
    'SELECT * FROM security_events WHERE server_id = $1 ORDER BY created_at DESC LIMIT 200',
    [req.params.serverId]
  );
  res.json(rows);
});

module.exports = router;
