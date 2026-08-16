'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { serviceOwner } = require('../src/lib/serviceRanges');
const { isBannable } = require('../src/lib/ipGuard');

// The exact addresses from the SMGEXCH01 incident.
test('the Exchange Online addresses that were mislabelled are recognised', () => {
  assert.equal(serviceOwner('52.98.199.117'), 'Exchange Online');
  assert.equal(serviceOwner('52.98.199.85'), 'Exchange Online');
});

test('other published Microsoft ranges are recognised', () => {
  assert.equal(serviceOwner('40.107.5.5'), 'Exchange Online');
  assert.equal(serviceOwner('104.47.10.1'), 'Exchange Online');
  assert.equal(serviceOwner('13.107.128.1'), 'Microsoft 365');
  assert.equal(serviceOwner('2a01:111:f400::1'), 'Exchange Online');
});

// These are the genuine offenders seen in the same week - password sprays
// across 11-23 accounts, plus single-account external sources. If any of them
// matched, a real attacker would be relabelled as harmless AND made unbannable.
test('real attackers are NOT treated as a service', () => {
  for (const ip of ['80.66.88.30', '95.68.225.46', '188.234.218.124',
    '103.173.220.194', '85.175.216.191', '95.105.4.127',
    '193.178.118.168', '185.231.33.46']) {
    assert.equal(serviceOwner(ip), null, ip + ' must not match a service range');
  }
});

test('malformed input never throws and never matches', () => {
  for (const v of ['', null, undefined, 'garbage', '999.1.1.1', '10.0.0']) {
    assert.equal(serviceOwner(v), null);
  }
});

// Auto-ban is live on this deployment: banning Microsoft would cut mail flow.
test('service ranges are never bannable', () => {
  assert.equal(isBannable('52.98.199.117'), false);
  assert.equal(isBannable('40.107.5.5'), false);
  assert.equal(isBannable('104.47.10.1'), false);
});

test('the ban gate still bans real attackers and still protects private space', () => {
  assert.equal(isBannable('80.66.88.30'), true);
  assert.equal(isBannable('103.173.220.194'), true);
  assert.equal(isBannable('10.60.6.190'), false);
  assert.equal(isBannable('192.168.1.5'), false);
});

test('an operator allowlist still works alongside the service list', () => {
  assert.equal(isBannable('203.0.113.7'), true);
  assert.equal(isBannable('203.0.113.7', ['203.0.113.0/24']), false);
});
