const { test } = require('node:test');
const assert = require('node:assert');
const { normalizeStatus, overallStatus } = require('../src/lib/status');

test('normalizeStatus maps raw states to public states', () => {
  assert.strictEqual(normalizeStatus('online'), 'operational');
  assert.strictEqual(normalizeStatus('up'), 'operational');
  assert.strictEqual(normalizeStatus('warning'), 'degraded');
  assert.strictEqual(normalizeStatus('offline'), 'down');
  assert.strictEqual(normalizeStatus('down'), 'down');
  assert.strictEqual(normalizeStatus('critical'), 'down');
  assert.strictEqual(normalizeStatus('weird'), 'unknown');
});

test('overallStatus is worst-wins', () => {
  assert.strictEqual(overallStatus([{ status: 'operational' }, { status: 'operational' }]), 'operational');
  assert.strictEqual(overallStatus([{ status: 'operational' }, { status: 'degraded' }]), 'degraded');
  assert.strictEqual(overallStatus([{ status: 'degraded' }, { status: 'down' }]), 'down');
});

test('overallStatus is unknown when empty', () => {
  assert.strictEqual(overallStatus([]), 'unknown');
  assert.strictEqual(overallStatus(null), 'unknown');
});
