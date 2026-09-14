'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { resolveWorkstation } = require('../src/lib/workstationIdentity');

const UID = '75f1af8a-6bf5-4d23-b9b4-42cc554981ac';

test('a brand new PC is created', () => {
  const r = resolveWorkstation({ hostname: 'PC-001', uid: UID, serial: 'SN1' });
  assert.equal(r.action, 'create');
  assert.equal(r.workstationId, null);
});

test('the same PC reporting again updates its record', () => {
  const r = resolveWorkstation({
    existingByUid: { id: 5, hostname: 'PC-001', serial: 'SN1' },
    hostname: 'PC-001', uid: UID, serial: 'SN1',
  });
  assert.equal(r.action, 'update');
  assert.equal(r.workstationId, 5);
  assert.equal(r.renamedFrom, null);
});

test('a rename keeps the record and reports the old name', () => {
  const r = resolveWorkstation({
    existingByUid: { id: 5, hostname: 'PC-001', serial: 'SN1' },
    hostname: 'BUH-01', uid: UID, serial: 'SN1',
  });
  assert.equal(r.action, 'update');
  assert.equal(r.workstationId, 5);
  assert.equal(r.renamedFrom, 'PC-001');
});

// The desktop-specific hazard: a non-sysprepped image shares one MachineGuid.
test('a clone off the same image gets its own record and a clone_of pointer', () => {
  const r = resolveWorkstation({
    existingByUid: { id: 5, hostname: 'PC-001', serial: 'SN1' },
    hostname: 'PC-050', uid: UID, serial: 'SN2',
  });
  assert.equal(r.action, 'clone');
  assert.equal(r.cloneOf, 5);
  assert.equal(r.workstationId, null);
});

test('a blank serial on either side is not treated as a clone (cannot tell)', () => {
  const r1 = resolveWorkstation({ existingByUid: { id: 5, hostname: 'PC-001', serial: '' }, hostname: 'PC-050', uid: UID, serial: 'SN2' });
  assert.equal(r1.action, 'update');
  const r2 = resolveWorkstation({ existingByUid: { id: 5, hostname: 'PC-001', serial: 'SN1' }, hostname: 'PC-050', uid: UID, serial: '' });
  assert.equal(r2.action, 'update');
});

test('serial comparison ignores case', () => {
  const r = resolveWorkstation({ existingByUid: { id: 5, hostname: 'PC-001', serial: 'abc123' }, hostname: 'PC-001', uid: UID, serial: 'ABC123' });
  assert.equal(r.action, 'update');
});

test('no uid falls back to hostname', () => {
  const r = resolveWorkstation({ existingByHost: { id: 9, hostname: 'PC-001' }, hostname: 'PC-001', uid: '', serial: 'SN1' });
  assert.equal(r.action, 'update');
  assert.equal(r.workstationId, 9);
});

test('no uid and an unknown hostname is new', () => {
  const r = resolveWorkstation({ hostname: 'PC-999', uid: '', serial: '' });
  assert.equal(r.action, 'create');
});

test('missing input never throws', () => {
  assert.equal(resolveWorkstation({}).action, 'create');
  assert.equal(resolveWorkstation({ hostname: null, uid: null, serial: null }).action, 'create');
});
