const { test } = require('node:test');
const assert = require('node:assert');
const { shouldAlertShadowDrop } = require('../src/lib/ransomPolicy');

test('REGRESSION: a backup deleting its single snapshot must not alert', () => {
  // Real false positive: "SHADOW COPIES DELETED on AVTOSTEK HOST: 1 restore
  // point(s) disappeared", fired at 01:03 by the nightly backup.
  const r = shouldAlertShadowDrop({ prev: 1, now: 0, zeroStreak: 5 });
  assert.strictEqual(r.alert, false);
  assert.strictEqual(r.reason, 'normal-churn');
});

test('two snapshots churning is still normal', () => {
  assert.strictEqual(shouldAlertShadowDrop({ prev: 2, now: 0, zeroStreak: 5 }).alert, false);
});

test('a real mass wipe alerts once confirmed', () => {
  const r = shouldAlertShadowDrop({ prev: 12, now: 0, zeroStreak: 2 });
  assert.strictEqual(r.alert, true);
  assert.strictEqual(r.reason, 'mass-deletion');
  assert.strictEqual(r.drop, 12);
});

test('a mass wipe is held back until it is confirmed by a later report', () => {
  const first = shouldAlertShadowDrop({ prev: 12, now: 0, zeroStreak: 1 });
  assert.strictEqual(first.alert, false);
  assert.strictEqual(first.reason, 'unconfirmed');
});

test('copies still present never alert, however big the drop', () => {
  assert.strictEqual(shouldAlertShadowDrop({ prev: 20, now: 4, zeroStreak: 9 }).alert, false);
});

test('SAFETY: an unreadable count is never a deletion', () => {
  assert.strictEqual(shouldAlertShadowDrop({ prev: 10, now: null, zeroStreak: 9 }).reason, 'unknown');
  assert.strictEqual(shouldAlertShadowDrop({ prev: null, now: 0, zeroStreak: 9 }).reason, 'unknown');
  assert.strictEqual(shouldAlertShadowDrop({}).alert, false);
});

test('the threshold is configurable for sites that keep many snapshots', () => {
  assert.strictEqual(shouldAlertShadowDrop({ prev: 2, now: 0, zeroStreak: 2, minDrop: 2 }).alert, true);
  assert.strictEqual(shouldAlertShadowDrop({ prev: 5, now: 0, zeroStreak: 2, minDrop: 8 }).alert, false);
});
