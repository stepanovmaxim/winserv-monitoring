const { test } = require('node:test');
const assert = require('node:assert');
const { isUnrestricted, canAccessCustomer, effectiveCustomerIds } = require('../src/lib/accessPolicy');

test('an unscoped user (null) is unrestricted — existing admins keep full access', () => {
  assert.strictEqual(isUnrestricted(null), true);
  assert.strictEqual(canAccessCustomer(null, 5), true);
  assert.strictEqual(canAccessCustomer(null, null), true);
});

test('a scoped user sees only their own customers', () => {
  assert.strictEqual(canAccessCustomer([5, 7], 5), true);
  assert.strictEqual(canAccessCustomer([5, 7], 7), true);
  assert.strictEqual(canAccessCustomer([5, 7], 6), false);
});

test('SAFETY: a scoped user never sees servers with no customer assigned', () => {
  assert.strictEqual(canAccessCustomer([5], null), false);
  assert.strictEqual(canAccessCustomer([5], undefined), false);
});

test('SAFETY: an empty scope grants nothing (fails closed)', () => {
  assert.strictEqual(canAccessCustomer([], 5), false);
  assert.strictEqual(canAccessCustomer([], null), false);
});

test('ids compare correctly across string/number forms', () => {
  assert.strictEqual(canAccessCustomer(['5'], 5), true);
  assert.strictEqual(canAccessCustomer([5], '5'), true);
});

test('effectiveCustomerIds: unrestricted user honours the requested filter', () => {
  assert.strictEqual(effectiveCustomerIds(null, null), null);
  assert.deepStrictEqual(effectiveCustomerIds(null, 3), [3]);
});

test('effectiveCustomerIds: scoped user defaults to their whole scope', () => {
  assert.deepStrictEqual(effectiveCustomerIds([5, 7], null), [5, 7]);
});

test('effectiveCustomerIds: a scoped user asking for someone else gets nothing', () => {
  assert.deepStrictEqual(effectiveCustomerIds([5, 7], 9), []);
  assert.deepStrictEqual(effectiveCustomerIds([5, 7], 5), [5]);
});
