'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { repairAccount } = require('../src/lib/accountName');
const { shouldAutoBan } = require('../src/lib/banPolicy');

// Exactly as stored for 85.235.148.7 on TS01.
const DAMAGED = 'Ð\u0090Ð´Ð¼Ð¸Ð½Ð¸Ñ\u0081Ñ‚Ñ€Ð°Ñ‚Ð¾Ñ€';

test('restores a name logged as UTF-8 bytes read as Windows-1252', () => {
  assert.strictEqual(repairAccount(DAMAGED), 'Администратор');
});

test('leaves healthy names alone', () => {
  for (const n of ['Администратор', 'АДМИНИСТРАТОР', 'AUDITOR', 'Müller', 'José', 'DmitrievAV', 'user@corp.ru', '']) {
    assert.strictEqual(repairAccount(n), n);
  }
});

test('survives a missing name', () => {
  assert.strictEqual(repairAccount(null), '');
  assert.strictEqual(repairAccount(undefined), '');
});

test('the restored name is caught by the auto-ban list, the damaged one was not', () => {
  const args = { enabled: true, count: 17, threshold: 10, serversHit: 1 };
  assert.deepStrictEqual(shouldAutoBan({ ...args, accounts: [DAMAGED] }), { ban: false, reason: 'single-account' });
  assert.deepStrictEqual(shouldAutoBan({ ...args, accounts: [repairAccount(DAMAGED)] }), { ban: true, reason: 'bad-account' });
});
