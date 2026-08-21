'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { serverLabel } = require('../src/lib/serverLabel');

test('the display name wins when set', () => {
  assert.equal(serverLabel({ hostname: 'WIN-VAE9FF8KAQK', display_name: 'AVTOSTEK HOST' }), 'AVTOSTEK HOST');
});

test('falls back to the identity hostname', () => {
  assert.equal(serverLabel({ hostname: 'DB01.inroel.ru', display_name: null }), 'DB01.inroel.ru');
  assert.equal(serverLabel({ hostname: 'DB01.inroel.ru' }), 'DB01.inroel.ru');
});

test('blank or whitespace display names do not hide the hostname', () => {
  assert.equal(serverLabel({ hostname: 'HV1', display_name: '' }), 'HV1');
  assert.equal(serverLabel({ hostname: 'HV1', display_name: '   ' }), 'HV1');
});

test('never throws on missing input', () => {
  assert.equal(serverLabel(null), '');
  assert.equal(serverLabel(undefined), '');
  assert.equal(serverLabel({}), '');
});
