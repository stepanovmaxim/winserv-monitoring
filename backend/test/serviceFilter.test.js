const { test } = require('node:test');
const assert = require('node:assert');
const { parseIgnore, isIgnoredService, DEFAULT_IGNORE } = require('../src/services/serviceFilter');

test('parseIgnore splits on newlines and commas, lowercased and trimmed', () => {
  const list = parseIgnore('sppsvc\nGoogleUpdate, RemoteRegistry');
  assert.ok(list.includes('sppsvc'));
  assert.ok(list.includes('googleupdate'));
  assert.ok(list.includes('remoteregistry'));
});

test('parseIgnore falls back to defaults when unset (null/undefined)', () => {
  assert.deepStrictEqual(parseIgnore(undefined), DEFAULT_IGNORE.map(s => s.toLowerCase()));
  assert.deepStrictEqual(parseIgnore(null), DEFAULT_IGNORE.map(s => s.toLowerCase()));
});

test('parseIgnore treats an empty string as "monitor everything"', () => {
  assert.deepStrictEqual(parseIgnore(''), []);
});

test('isIgnoredService matches by case-insensitive prefix', () => {
  const list = parseIgnore('sppsvc\ngoogleupdate');
  assert.strictEqual(isIgnoredService('sppsvc', list), true);
  assert.strictEqual(isIgnoredService('GoogleUpdaterService', list), true); // prefix
  assert.strictEqual(isIgnoredService('MSSQLSERVER', list), false);
});
