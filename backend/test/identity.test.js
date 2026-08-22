'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { chooseIdentity } = require('../src/lib/identity');

const UID = '75f1af8a-6bf5-4d23-b9b4-42cc554981ac';

test('a token wins over everything', () => {
  const r = chooseIdentity({
    tokenServer: { id: 7, agent_uid: UID }, uidServer: { id: 9 }, hostServer: { id: 11 },
    hostname: 'HV2', uid: UID,
  });
  assert.equal(r.serverId, 7);
  assert.equal(r.matchedBy, 'token');
});

test('a token match backfills the uid the first time one is reported', () => {
  const r = chooseIdentity({ tokenServer: { id: 7, agent_uid: null }, hostname: 'HV2', uid: UID });
  assert.equal(r.setUid, UID);
});

test('no backfill when the record already has a uid', () => {
  const r = chooseIdentity({ tokenServer: { id: 7, agent_uid: UID }, hostname: 'HV2', uid: UID });
  assert.equal(r.setUid, null);
});

// The three failures that motivated this.
test('a case change no longer creates a duplicate', () => {
  const r = chooseIdentity({
    uidServer: { id: 29, hostname: 'HV2' }, hostServer: null, hostname: 'hv2', uid: UID,
  });
  assert.equal(r.serverId, 29);
  assert.equal(r.matchedBy, 'uid');
  assert.equal(r.renamedFrom, null, 'HV2 vs hv2 is not a rename');
});

test('a real rename keeps the record and reports the old name', () => {
  const r = chooseIdentity({
    uidServer: { id: 27, hostname: 'WIN-VAE9FF8KAQK' }, hostname: 'AVTOSTEK-HV', uid: UID,
  });
  assert.equal(r.serverId, 27);
  assert.equal(r.renamedFrom, 'WIN-VAE9FF8KAQK');
});

test('an unknown machine is new even when a hostname collides is not possible here', () => {
  const r = chooseIdentity({ hostname: 'HV1', uid: UID });
  assert.equal(r.serverId, null);
  assert.equal(r.matchedBy, 'new');
  assert.equal(r.setUid, UID);
});

// Backwards compatibility: agents that do not send a uid yet.
test('without a uid it falls back to hostname exactly as before', () => {
  const r = chooseIdentity({ hostServer: { id: 3, agent_uid: null }, hostname: 'DB01.inroel.ru', uid: '' });
  assert.equal(r.serverId, 3);
  assert.equal(r.matchedBy, 'hostname');
  assert.equal(r.setUid, null);
});

test('a uid is ignored when no record carries it, falling back to hostname', () => {
  const r = chooseIdentity({ uidServer: null, hostServer: { id: 3, agent_uid: null }, hostname: 'DB01', uid: UID });
  assert.equal(r.serverId, 3);
  assert.equal(r.setUid, UID, 'and the record adopts the uid');
});

test('missing and malformed input never throw', () => {
  assert.equal(chooseIdentity({}).serverId, null);
  assert.equal(chooseIdentity({ hostname: null, uid: null }).serverId, null);
  assert.equal(chooseIdentity({ hostname: '  ', uid: '  ' }).setUid, null);
});
