'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { normalizeHostname } = require('../src/lib/hostname');

// The case that produced this: a workgroup Hyper-V host registered as "HV2."
test('a trailing dot from a domainless machine is stripped', () => {
  assert.equal(normalizeHostname('HV2.'), 'HV2');
  assert.equal(normalizeHostname('HV1.'), 'HV1');
});

test('domain-joined names are untouched', () => {
  assert.equal(normalizeHostname('DB01.inroel.ru'), 'DB01.inroel.ru');
  assert.equal(normalizeHostname('SMGEXCH01.semargl.pro'), 'SMGEXCH01.semargl.pro');
});

test('whitespace and repeated dots are handled', () => {
  assert.equal(normalizeHostname('  HV2.  '), 'HV2');
  assert.equal(normalizeHostname('HV2..'), 'HV2');
  assert.equal(normalizeHostname('a.b.c.'), 'a.b.c');
});

test('empty and missing input never throw', () => {
  assert.equal(normalizeHostname(''), '');
  assert.equal(normalizeHostname(null), '');
  assert.equal(normalizeHostname(undefined), '');
});

// Both forms must land on the same record, otherwise an agent that changes the
// name it reports registers a second time and orphans the first host's history.
test('the dotted and clean forms normalise to the same key', () => {
  assert.equal(normalizeHostname('HV2.'), normalizeHostname('HV2'));
});
