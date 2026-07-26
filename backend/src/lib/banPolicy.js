// Auto-ban decision. Pure, so every rule is unit-tested against real production
// cases (see test/banPolicy.test.js).
//
// The hard problem is telling a MISCONFIGURED CLIENT apart from an ATTACK when
// both hammer a single account thousands of times. Production data settled it:
//
//   95.105.74.57  DmitrievAV      7303 fails, 1 account, 1 server  -> real employee, stale Outlook
//   52.98.x.x     NedlinVE etc.    119+ fails, 1 account, 1 server  -> Microsoft 365 infra, stale credential
//   85.30.235.176 AUDITOR         3696 fails, 1 account, 4 servers -> attack
//   85.15.92.27   ПРОИЗВОДСТВО     781 fails, 1 account, 3 servers -> attack
//   45.12.54.97   GUEST            213 fails, 1 account, 1 server  -> attack (never-legit username)
//   93.152.205.162                  24 fails, 8 accounts, 3 servers -> spray (8/server: under a per-server threshold)
//
// So volume alone proves nothing. What separates them:
//   * account spread   — many accounts = spray
//   * username         — ADMINISTRATOR/GUEST/AUDITOR are never real staff
//   * server spread    — a broken client talks to ONE server; a scanner sweeps
//   * operator knowledge — named real users go on the protected list

// Usernames that are never legitimate staff accounts; a hammer against one of
// these is an attack regardless of volume or server count.
const DEFAULT_BAD_ACCOUNTS = [
  'administrator', 'admin', 'administrador', 'администратор',
  'guest', 'гость', 'root', 'auditor', 'test', 'test1', 'user', 'user1',
  'scanner', 'scan', 'backup', 'sql', 'sqlserver', 'mysql', 'postgres',
  'oracle', 'ftp', 'web', 'www', 'mail', 'support', 'operator', 'manager',
  'service', 'server', 'default', 'demo', 'temp', 'print', 'scanner1',
];

function parseList(raw, fallback = []) {
  if (raw == null) return fallback.map(s => s.toLowerCase());
  return String(raw)
    .split(/[\n,;]+/)
    .map(s => s.trim().toLowerCase())
    .filter(Boolean);
}

// accounts: distinct account names seen failing from this IP in the window.
// serversHit: how many distinct servers this IP hit in the window.
function shouldAutoBan({
  enabled,
  count,
  threshold,
  accounts = [],
  minAccounts = 3,
  serversHit = 1,
  badAccounts = DEFAULT_BAD_ACCOUNTS,
  protectedAccounts = [],
} = {}) {
  if (!enabled) return { ban: false, reason: 'disabled' };
  if (!(count >= threshold)) return { ban: false, reason: 'below-threshold' };

  const seen = accounts.map(a => String(a || '').trim().toLowerCase()).filter(Boolean);
  const distinct = new Set(seen).size;
  const bad = new Set(badAccounts.map(a => String(a).toLowerCase()));
  const prot = new Set(protectedAccounts.map(a => String(a).toLowerCase()));

  // Spray across many accounts — unambiguous attack.
  if (distinct >= Math.max(1, minAccounts)) return { ban: true, reason: 'spray' };

  // Known real user hammering a single server = broken client (stale password).
  // Requires serversHit <= 1 so an attacker can't hide behind a real username
  // while sweeping the fleet.
  if (seen.length && seen.every(a => prot.has(a)) && serversHit <= 1) {
    return { ban: false, reason: 'protected-account' };
  }

  // Never-legit username (ADMINISTRATOR / GUEST / AUDITOR ...) — attack.
  if (seen.some(a => bad.has(a))) return { ban: true, reason: 'bad-account' };

  // A misconfigured client talks to one server; hitting several = scanning.
  if (serversHit >= 2) return { ban: true, reason: 'multi-server' };

  // Single unknown account on a single server — ambiguous. Alert, don't ban.
  return { ban: false, reason: 'single-account' };
}

module.exports = { shouldAutoBan, DEFAULT_BAD_ACCOUNTS, parseList };
