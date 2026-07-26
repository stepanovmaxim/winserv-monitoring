const db = require('../db');
const { sendTelegramMessage } = require('./telegram');
const { sendWebhookAlert } = require('./webhookService');
const { logAlert } = require('./alertLog');
const { isBannable, parseAllowlist } = require('../lib/ipGuard');
const { shouldAutoBan, DEFAULT_BAD_ACCOUNTS, parseList } = require('../lib/banPolicy');

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
// Fleet-wide auto-ban sweep. Counting per-server let a low-and-slow spray hide
// (8 failures on each of 3 servers never reached a per-server threshold of 10),
// so failures are aggregated per SOURCE IP across the whole fleet, and a ban is
// pushed to every server that IP actually touched.
async function runAutoban() {
  try {
    const config = await db.queryOne('SELECT * FROM telegram_config LIMIT 1');
    if (!config || !config.autoban_enabled) return;

    const windowMin = Math.min(1440, Math.max(1, parseInt(config.autoban_window_minutes) || 60));
    const threshold = parseInt(config.autoban_threshold) || 30;
    const minAccounts = parseInt(config.autoban_min_accounts) || 3;
    const badAccounts = parseList(config.autoban_bad_accounts, DEFAULT_BAD_ACCOUNTS);
    const protectedAccounts = parseList(config.autoban_protected_accounts, []);
    const mins = parseInt(config.autoban_minutes);

    const rows = await db.queryAll(
      `SELECT ip,
              COUNT(*)::int AS fails,
              COUNT(DISTINCT server_id)::int AS servers_hit,
              array_agg(DISTINCT account) FILTER (WHERE account <> '') AS accounts,
              array_agg(DISTINCT server_id) AS server_ids
         FROM security_events
        WHERE event = 'fail' AND ip <> '' AND ip <> '-'
          AND created_at > NOW() - ($1 || ' minutes')::interval
        GROUP BY ip HAVING COUNT(*) >= $2`,
      [String(windowMin), threshold]
    );

    for (const r of rows) {
      if (!(await canBan(r.ip))) continue; // local / reserved / allowlisted

      const decision = shouldAutoBan({
        enabled: true,
        count: r.fails,
        threshold,
        accounts: r.accounts || [],
        minAccounts,
        serversHit: r.servers_hit,
        badAccounts,
        protectedAccounts,
      });
      if (!decision.ban) {
        if (decision.reason === 'single-account' || decision.reason === 'protected-account') {
          console.log(`[Ban] Skipped ${r.ip}: ${r.fails} fails/${windowMin}min, accounts=${(r.accounts || []).join(',')} — ${decision.reason}`);
        }
        continue;
      }

      // Never ban a source that also authenticated successfully somewhere recently.
      const recentSuccess = await db.queryOne(
        `SELECT 1 FROM security_events WHERE ip = $1 AND event = 'success'
           AND created_at > NOW() - INTERVAL '24 hours' LIMIT 1`,
        [r.ip]
      );
      if (recentSuccess) {
        console.log(`[Ban] Skipped auto-ban of ${r.ip}: recent successful logon`);
        continue;
      }

      const acctList = (r.accounts || []).slice(0, 3).join(', ');
      const reason = `auto/${decision.reason}: ${r.fails} fails, ${(r.accounts || []).length} acct(s), ${r.servers_hit} server(s) / ${windowMin}min`;

      let placed = 0;
      for (const sid of r.server_ids || []) {
        const server = await db.queryOne('SELECT id, hostname, customer_id FROM servers WHERE id = $1', [sid]);
        if (!server) continue;
        const res = await queueBlock(server, r.ip, {
          reason, auto: true,
          minutes: Number.isFinite(mins) ? mins : 1440,
          requestedBy: 'auto-ban',
        });
        if (res.ok) placed++;
      }
      if (!placed) continue; // already blocked everywhere

      const dur = (Number.isFinite(mins) && mins > 0) ? `${mins} min` : 'until removed';
      const msg = `<b>AUTO-BANNED</b> ${r.ip} — ${decision.reason}: ${r.fails} fails on ${r.servers_hit} server(s) in ${windowMin} min (${acctList}${(r.accounts || []).length > 3 ? '…' : ''}) — blocked on ${placed} server(s), ${dur}`;
      sendTelegramMessage(msg).catch(() => {});
      sendWebhookAlert(msg);
      logAlert({ severity: 'critical', kind: 'security', message: msg });
    }
  } catch (err) {
    console.error('[Autoban]', err.message);
  }
}

module.exports = { canBan, queueBlock, queueUnblock, expireBans, runAutoban };
