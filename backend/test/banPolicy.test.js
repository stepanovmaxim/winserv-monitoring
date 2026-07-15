const { test } = require('node:test');
const assert = require('node:assert');
const { shouldAutoBan } = require('../src/lib/banPolicy');

const base = { enabled: true, threshold: 30, minAccounts: 3 };

test('REGRESSION: a single-account hammer is never banned (stale Outlook password)', () => {
  // Real incident: 95.105.74.57 — 4237 fails, all for account DmitrievAV.
  const r = shouldAutoBan({ ...base, count: 4237, distinctAccounts: 1 });
  assert.strictEqual(r.ban, false);
  assert.strictEqual(r.reason, 'single-account');
});

test('a password-spray across many accounts IS banned', () => {
  // Real incident: 85.239.149.120 — 2091 fails across 951 accounts.
  const r = shouldAutoBan({ ...base, count: 2091, distinctAccounts: 951 });
  assert.strictEqual(r.ban, true);
  assert.strictEqual(r.reason, 'spray');
});

test('below the failure threshold, never ban', () => {
  assert.strictEqual(shouldAutoBan({ ...base, count: 10, distinctAccounts: 50 }).ban, false);
});

test('a couple of accounts still counts as a broken client, not a spray', () => {
  assert.strictEqual(shouldAutoBan({ ...base, count: 500, distinctAccounts: 2 }).ban, false);
  assert.strictEqual(shouldAutoBan({ ...base, count: 500, distinctAccounts: 3 }).ban, true);
});

test('disabled engine never bans', () => {
  assert.strictEqual(shouldAutoBan({ ...base, enabled: false, count: 9999, distinctAccounts: 999 }).ban, false);
});

test('minAccounts is clamped to at least 1', () => {
  assert.strictEqual(shouldAutoBan({ ...base, minAccounts: 0, count: 100, distinctAccounts: 1 }).ban, true);
});
