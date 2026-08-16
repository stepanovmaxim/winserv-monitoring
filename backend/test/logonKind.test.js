'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { logonKind } = require('../src/lib/logonKind');

test('the Exchange cases that prompted this: not RDP', () => {
  // 52.98.199.117 hitting OWA/basic-auth on SMGEXCH01
  assert.equal(logonKind('8'), 'OWA/basic-auth');
  // 10.60.6.190 network logons (MAPI/EWS/SMB)
  assert.equal(logonKind('3'), 'network');
});

test('real RDP is type 10', () => {
  assert.equal(logonKind('10'), 'RDP');
  assert.equal(logonKind(10), 'RDP');
});

test('other interactive types', () => {
  assert.equal(logonKind('2'), 'console');
  assert.equal(logonKind('7'), 'unlock');
  assert.equal(logonKind('11'), 'cached');
});

test('linux is always SSH regardless of type', () => {
  assert.equal(logonKind('3', 'linux'), 'SSH');
  assert.equal(logonKind('', 'linux'), 'SSH');
});

test('unknown / empty / null degrade to a generic label, never crash', () => {
  assert.equal(logonKind(''), 'logon');
  assert.equal(logonKind(null), 'logon');
  assert.equal(logonKind(undefined), 'logon');
  assert.equal(logonKind('99'), 'logon');
  assert.equal(logonKind('  10  '), 'RDP'); // trims
});
