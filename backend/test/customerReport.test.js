'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { monthRange, uptimePct, patchStatus, buildRecommendations } = require('../src/lib/customerReport');

test('monthRange: explicit month covers the whole calendar month', () => {
  const r = monthRange('2026-08');
  assert.equal(r.start.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(r.end.toISOString(), '2026-09-01T00:00:00.000Z');
  assert.equal(r.label, '2026-08');
});

test('monthRange: December rolls into the next year', () => {
  const r = monthRange('2026-12');
  assert.equal(r.end.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('monthRange: default is the previous full month, across a year boundary too', () => {
  assert.equal(monthRange(undefined, new Date('2026-09-27T10:00:00Z')).label, '2026-08');
  assert.equal(monthRange('', new Date('2026-01-05T10:00:00Z')).label, '2025-12');
  assert.equal(monthRange('2026-13', new Date('2026-09-27T10:00:00Z')).label, '2026-08', 'invalid month -> default');
  assert.equal(monthRange('junk', new Date('2026-09-27T10:00:00Z')).label, '2026-08');
});

test('uptimePct: full month of minute samples is 100%', () => {
  const { start, end } = monthRange('2026-08');
  const minutes = (end - start) / 60000;
  assert.equal(uptimePct({ samples: minutes, firstSample: start, start, end, now: new Date('2026-09-10') }), 100);
});

test('uptimePct: a half-missing month is ~50%', () => {
  const { start, end } = monthRange('2026-08');
  const minutes = (end - start) / 60000;
  assert.equal(uptimePct({ samples: minutes / 2, firstSample: start, start, end, now: new Date('2026-09-10') }), 50);
});

test('uptimePct: a server added mid-month is measured from its first sample', () => {
  const { start, end } = monthRange('2026-08');
  const first = new Date('2026-08-21T00:00:00Z');
  const minutes = (end - first) / 60000;
  assert.equal(uptimePct({ samples: minutes, firstSample: first, start, end, now: new Date('2026-09-10') }), 100);
});

test('uptimePct: the current month is measured only up to now', () => {
  const { start, end } = monthRange('2026-09');
  const now = new Date('2026-09-11T00:00:00Z');
  const minutes = (now - start) / 60000;
  assert.equal(uptimePct({ samples: minutes, firstSample: start, start, end, now }), 100);
});

test('uptimePct: no data is unknown, not zero', () => {
  const { start, end } = monthRange('2026-08');
  assert.equal(uptimePct({ samples: 0, firstSample: null, start, end }), null);
});

test('patchStatus: thresholds at 35 and 60 days', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  assert.deepEqual(patchStatus('2026-09-20', now), { days: 7, status: 'ok' });
  assert.deepEqual(patchStatus('2026-08-10', now), { days: 48, status: 'behind' });
  assert.deepEqual(patchStatus('2026-07-01', now), { days: 88, status: 'critical' });
  assert.deepEqual(patchStatus(null, now), { days: null, status: 'unknown' });
  assert.deepEqual(patchStatus('garbage', now), { days: null, status: 'unknown' });
});

test('recommendations: each problem produces a code, worst first', () => {
  const recs = buildRecommendations({
    servers: [
      { name: 'DB01', uptime: 99.9, patch: { days: 5, status: 'ok' }, score: 90 },
      { name: 'FS01', uptime: 93, patch: { days: 70, status: 'critical' }, score: 60 },
    ],
    disks: [
      { host: 'DB01', drive: 'D:', status: 'growing', days: 5, r2: 0.9, used: 50, total: 100 },
      { host: 'FS01', drive: 'C:', status: 'stable', days: null, used: 95, total: 100 },
      { host: 'X', drive: 'E:', status: 'growing', days: 5, r2: 0.2, used: 10, total: 100 }, // noisy: no rec
    ],
    antivirus: [
      { host: 'FS01', available: 1, av_enabled: 0, realtime_enabled: 0 },
      { host: 'DB01', available: 1, av_enabled: 1, realtime_enabled: 1, signature_age_days: 9 },
      { host: 'TP', third_party: 'Kaspersky' },
    ],
    threats: [{ action_success: 0 }],
    workstations: { patchBehind: 4, stale: 2 },
  });
  const codes = recs.map(r => r.code);
  assert.ok(codes.includes('uptime') && codes.includes('patch') && codes.includes('disk'));
  assert.ok(codes.includes('diskfull') && codes.includes('av') && codes.includes('avsig'));
  assert.ok(codes.includes('score') && codes.includes('threat') && codes.includes('wspatch') && codes.includes('wsstale'));
  assert.equal(recs.filter(r => r.code === 'disk').length, 1, 'noisy forecast must not produce a recommendation');
  assert.ok(!recs.some(r => r.host === 'TP'), 'third-party AV is not flagged');
  const firstNonCritical = recs.findIndex(r => r.severity !== 'critical');
  assert.ok(recs.slice(firstNonCritical).every(r => r.severity !== 'critical'), 'critical items come first');
});

test('recommendations: a healthy customer gets none', () => {
  const recs = buildRecommendations({
    servers: [{ name: 'DB01', uptime: 100, patch: { days: 3, status: 'ok' }, score: 95 }],
    disks: [{ host: 'DB01', drive: 'C:', status: 'stable', used: 40, total: 100 }],
    antivirus: [{ host: 'DB01', available: 1, av_enabled: 1, realtime_enabled: 1, signature_age_days: 0 }],
    threats: [], workstations: { patchBehind: 0, stale: 0 },
  });
  assert.deepEqual(recs, []);
});
