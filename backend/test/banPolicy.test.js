const { test } = require('node:test');
const assert = require('node:assert');
const { shouldAutoBan, DEFAULT_BAD_ACCOUNTS, parseList } = require('../src/lib/banPolicy');

// Defaults matching production config (threshold 10 / window 60m / minAccounts 3).
const base = { enabled: true, threshold: 10, minAccounts: 3, badAccounts: DEFAULT_BAD_ACCOUNTS };
const withProtected = { ...base, protectedAccounts: ['dmitrievav', 'nedlinve', 'vaskovvn'] };

// --- Real cases that must NOT be banned -------------------------------------

test('REGRESSION: real employee with a stale Outlook password is never banned', () => {
  // 95.105.74.57 — 7303 fails, account DmitrievAV, Exchange only.
  const r = shouldAutoBan({ ...withProtected, count: 7303, accounts: ['DmitrievAV'], serversHit: 1 });
  assert.strictEqual(r.ban, false);
  assert.strictEqual(r.reason, 'protected-account');
});

test('Microsoft 365 infra with a stale credential is not banned (single acct, one server)', () => {
  // 52.98.199.117 — 119 fails, NedlinVE, SMGEXCH01 only. Banning MS would break mail.
  const r = shouldAutoBan({ ...withProtected, count: 119, accounts: ['NedlinVE'], serversHit: 1 });
  assert.strictEqual(r.ban, false);
});

test('an unknown single account on a single server is alert-only, not banned', () => {
  const r = shouldAutoBan({ ...base, count: 500, accounts: ['SomeUser'], serversHit: 1 });
  assert.strictEqual(r.ban, false);
  assert.strictEqual(r.reason, 'single-account');
});

test('below the threshold nothing is banned', () => {
  assert.strictEqual(shouldAutoBan({ ...base, count: 4, accounts: ['a', 'b', 'c', 'd'], serversHit: 3 }).ban, false);
});

test('disabled engine never bans', () => {
  assert.strictEqual(shouldAutoBan({ ...base, enabled: false, count: 9999, accounts: ['a', 'b', 'c'], serversHit: 5 }).ban, false);
});

// --- Real cases that MUST be banned (the gaps found in production) ----------

test('GAP 1: single-account hammer on a never-legit username IS banned (AUDITOR)', () => {
  // 85.30.235.176 — 3696 fails, account AUDITOR. Was escaping the diversity guard.
  const r = shouldAutoBan({ ...withProtected, count: 3696, accounts: ['AUDITOR'], serversHit: 4 });
  assert.strictEqual(r.ban, true);
});

test('GAP 1b: ADMINISTRATOR / GUEST on a single server are banned', () => {
  // 45.145.224.33 (ADMINISTRATOR, 265, 1 server) and 45.12.54.97 (GUEST, 213, 1 server).
  assert.deepStrictEqual(shouldAutoBan({ ...base, count: 265, accounts: ['ADMINISTRATOR'], serversHit: 1 }),
    { ban: true, reason: 'bad-account' });
  assert.deepStrictEqual(shouldAutoBan({ ...base, count: 213, accounts: ['GUEST'], serversHit: 1 }),
    { ban: true, reason: 'bad-account' });
});

test('GAP 2: a single unknown account sweeping several servers is banned (scanning)', () => {
  // 85.15.92.27 — 781 fails, account ПРОИЗВОДСТВО, 3 servers. A broken client hits one.
  const r = shouldAutoBan({ ...base, count: 781, accounts: ['ПРОИЗВОДСТВО'], serversHit: 3 });
  assert.deepStrictEqual(r, { ban: true, reason: 'multi-server' });
});

test('GAP 3: a low-volume spray is banned on fleet-wide totals', () => {
  // 93.152.205.162 — only 8 fails per server (under threshold) but 24 fleet-wide
  // across 8 accounts and 3 servers.
  const perServer = shouldAutoBan({ ...base, count: 8, accounts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], serversHit: 1 });
  assert.strictEqual(perServer.ban, false, 'per-server counting misses it — this is why we aggregate');
  const fleetWide = shouldAutoBan({ ...base, count: 24, accounts: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'], serversHit: 3 });
  assert.deepStrictEqual(fleetWide, { ban: true, reason: 'spray' });
});

// --- Rule interactions ------------------------------------------------------

test('a protected username cannot shield an IP that sweeps multiple servers', () => {
  // 171.225.249.107 used the real name DmitrievAV from abroad. On one server it is
  // shielded (safe default); across servers the exemption must not apply.
  const oneServer = shouldAutoBan({ ...withProtected, count: 157, accounts: ['DmitrievAV'], serversHit: 1 });
  assert.strictEqual(oneServer.ban, false);
  const sweeping = shouldAutoBan({ ...withProtected, count: 157, accounts: ['DmitrievAV'], serversHit: 3 });
  assert.strictEqual(sweeping.ban, true);
});

test('spray wins even if one of the accounts is protected', () => {
  const r = shouldAutoBan({ ...withProtected, count: 100, accounts: ['DmitrievAV', 'admin2', 'petrov'], serversHit: 1 });
  assert.deepStrictEqual(r, { ban: true, reason: 'spray' });
});

test('account matching is case-insensitive', () => {
  assert.strictEqual(shouldAutoBan({ ...base, count: 50, accounts: ['aDmInIsTrAtOr'], serversHit: 1 }).ban, true);
  assert.strictEqual(shouldAutoBan({ ...withProtected, count: 50, accounts: ['DMITRIEVAV'], serversHit: 1 }).ban, false);
});

test('empty account names do not crash or count as diversity', () => {
  const r = shouldAutoBan({ ...base, count: 50, accounts: ['', '  ', ''], serversHit: 1 });
  assert.strictEqual(r.ban, false);
});

test('parseList splits on newlines/commas/semicolons and lowercases', () => {
  assert.deepStrictEqual(parseList('Admin\nGuest, Root; Test'), ['admin', 'guest', 'root', 'test']);
  assert.deepStrictEqual(parseList(''), []);
  assert.deepStrictEqual(parseList(null, ['x']), ['x']);
});
