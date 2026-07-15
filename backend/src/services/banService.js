const db = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { sendWebhookAlert } = require('./webhookService');
const { logAlert } = require('./alertLog');
const { isBannable, parseAllowlist } = require('../lib/ipGuard');

// Load the allowlist once per call — small table, keeps callers simple.
async function allowlist() {
  const cfg = await db.queryOne('SELECT autoban_allowlist FROM telegram_config LIMIT 1');
  return parseAllowlist(cfg ? cfg.autoban_allowlist : '');
}

// The single yes/no gate for any ban (auto OR manual). Fails closed.
async function canBan(ip) {
  return isBannable(ip, await allowlist());
}

// Queue a firewall block on one server and record it. Guarded and deduped.
// Returns { ok, why }.
async function queueBlock(server, ip, { reason = '', auto = false, minutes = null, requestedBy = 'system' } = {}) {
  if (!(await canBan(ip))) return { ok: false, why: 'protected' }; // private/reserved/allowlisted/invalid
  const active = await db.queryOne(
    'SELECT id FROM ip_blocks WHERE server_id = $1 AND ip = $2 AND unblocked_at IS NULL',
    [server.id, ip]
  );
  if (active) return { ok: false, why: 'already-blocked' };

  const mins = Number(minutes);
  const expiresExpr = mins && mins > 0 ? `NOW() + (${Math.floor(mins)} || ' minutes')::interval` : 'NULL';
  await db.query(
    `INSERT INTO ip_blocks (ip, server_id, customer_id, reason, auto, requested_by, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, ${expiresExpr})`,
    [ip, server.id, server.customer_id || null, reason, auto ? 1 : 0, requestedBy]
  );
  await db.query(
    "INSERT INTO server_commands (server_id, ctype, param, requested_by) VALUES ($1, 'block_ip', $2, $3)",
    [server.id, ip, requestedBy]
  );
  return { ok: true };
}

// Reverse an active block: queue unblock_ip and mark it unblocked.
async function queueUnblock(blockId, requestedBy = 'system') {
  const b = await db.queryOne('SELECT * FROM ip_blocks WHERE id = $1 AND unblocked_at IS NULL', [blockId]);
  if (!b) return { ok: false, why: 'not-found' };
  await db.query(
    "INSERT INTO server_commands (server_id, ctype, param, requested_by) VALUES ($1, 'unblock_ip', $2, $3)",
    [b.server_id, b.ip, requestedBy]
  );
  await db.query('UPDATE ip_blocks SET unblocked_at = NOW() WHERE id = $1', [blockId]);
  return { ok: true };
}

// Scheduler: lift bans whose expiry has passed.
async function expireBans() {
  try {
    const due = await db.queryAll(
      'SELECT id FROM ip_blocks WHERE unblocked_at IS NULL AND expires_at IS NOT NULL AND expires_at < NOW()'
    );
    for (const b of due) await queueUnblock(b.id, 'auto-expiry');
    if (due.length) console.log(`[Ban] Expired ${due.length} block(s)`);
  } catch (err) {
    console.error('[Ban expiry]', err.message);
  }
}

// Auto-ban decision from the brute-force detector. Extra anti-lockout guard:
// never auto-ban an IP that also authenticated SUCCESSFULLY here recently — that
// is far more likely a real user fat-fingering a password than an attacker.
async function autoBanFromBruteforce(server, ip, count, config) {
  if (!config.autoban_enabled) return;
  const threshold = parseInt(config.autoban_threshold) || 30;
  if (count < threshold) return;
  if (!(await canBan(ip))) return; // protected — silently skip (alert already fired)

  const recentSuccess = await db.queryOne(
    `SELECT 1 FROM security_events WHERE server_id = $1 AND ip = $2 AND event = 'success'
       AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
    [server.id, ip]
  );
  if (recentSuccess) {
    console.log(`[Ban] Skipped auto-ban of ${ip} on ${server.hostname}: recent successful logon`);
    return;
  }

  const mins = parseInt(config.autoban_minutes);
  const r = await queueBlock(server, ip, {
    reason: `auto: ${count} failed logons/hour`,
    auto: true,
    minutes: Number.isFinite(mins) ? mins : 1440,
    requestedBy: 'auto-ban',
  });
  if (!r.ok) return;

  const dur = (Number.isFinite(mins) && mins > 0) ? `${mins} min` : 'until removed';
  const msg = `<b>AUTO-BANNED</b> ${ip} on ${server.hostname}: ${count} failed logons/hour — firewall block (${dur})`;
  sendTelegramMessage(msg).catch(() => {});
  sendWebhookAlert(msg);
  logAlert({ severity: 'critical', kind: 'security', message: msg, server_id: server.id, customer_id: server.customer_id });
}

module.exports = { canBan, queueBlock, queueUnblock, expireBans, autoBanFromBruteforce };
