'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { joinsGroup, repeatSuffix } = require('../src/lib/alertGroup');

const T = Date.parse('2026-11-04T09:23:00Z');

test('a repeat inside the window joins the open group', () => {
  assert.strictEqual(joinsGroup({ firstAt: '2026-11-04T07:13:00Z', now: T }), true);
  assert.strictEqual(joinsGroup({ firstAt: '2026-11-03T09:24:00Z', now: T }), true);
});

test('the window is measured from the first alert, so a new loud one follows', () => {
  assert.strictEqual(joinsGroup({ firstAt: '2026-11-03T09:23:00Z', now: T }), false);
  assert.strictEqual(joinsGroup({ firstAt: '2026-11-01T00:00:00Z', now: T, windowHours: 168 }), true);
});

test('no open group, a bad date or a future date never joins', () => {
  assert.strictEqual(joinsGroup({ firstAt: null, now: T }), false);
  assert.strictEqual(joinsGroup({ firstAt: 'x', now: T }), false);
  assert.strictEqual(joinsGroup({ firstAt: '2026-11-05T00:00:00Z', now: T }), false);
});

test('suffix shows the count and since when', () => {
  assert.strictEqual(repeatSuffix({ count: 4, firstAt: '2026-11-04T07:13:00Z', now: T }), '🔁 ×4 since 07:13 UTC, last 09:23');
  assert.strictEqual(repeatSuffix({ count: 20, firstAt: '2026-11-03T12:05:00Z', now: T }), '🔁 ×20 since 03.11 12:05 UTC, last 09:23');
});
