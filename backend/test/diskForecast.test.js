'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { forecastDisk, forecastAlertLevel, nextForecastState } = require('../src/lib/diskForecast');

const H = 3600000;
const T0 = Date.UTC(2026, 8, 1);

// Hourly series: used(i) for i in [0, hours).
function series(hours, usedAt, total = 100) {
  const out = [];
  for (let i = 0; i < hours; i++) out.push({ t: T0 + i * H, used: usedAt(i), total: typeof total === 'function' ? total(i) : total });
  return out;
}

test('steady growth: rate and days-to-full are right', () => {
  // 1 GB/day from 50 GB over 10 days -> ends at ~60 used, ~40 free -> ~40 days.
  const f = forecastDisk(series(240, i => 50 + i / 24));
  assert.equal(f.status, 'growing');
  assert.ok(Math.abs(f.rateGbPerDay - 1) < 0.01, 'rate ' + f.rateGbPerDay);
  assert.ok(Math.abs(f.daysToFull - 40) < 0.5, 'days ' + f.daysToFull);
  assert.ok(f.r2 > 0.99);
});

test('a flat disk is stable, with no fill date', () => {
  const f = forecastDisk(series(240, () => 70));
  assert.equal(f.status, 'stable');
  assert.equal(f.daysToFull, null);
});

test('a shrinking disk is stable, not "fills in negative days"', () => {
  const f = forecastDisk(series(240, i => 80 - i / 48));
  assert.equal(f.status, 'stable');
  assert.equal(f.daysToFull, null);
});

// The case a naive fit gets wrong: growth, a cleanup, then slower growth.
test('a cleanup restarts the series; only post-cleanup growth counts', () => {
  const f = forecastDisk(series(240, i => (i < 120 ? 50 + i / 12 : 40 + (i - 120) / 24)));
  assert.equal(f.status, 'growing');
  assert.ok(Math.abs(f.rateGbPerDay - 1) < 0.02, 'rate after cleanup ' + f.rateGbPerDay);
  assert.equal(f.points, 120);
});

test('a volume resize restarts the series', () => {
  const f = forecastDisk(series(240, i => 50 + i / 24, i => (i < 100 ? 100 : 200)));
  assert.equal(f.totalGb, 200);
  assert.equal(f.points, 140);
});

test('too few points or too short a span says nothing', () => {
  assert.equal(forecastDisk(series(5, i => 50 + i)).status, 'insufficient');
  // 60 points but all within one hour
  const burst = Array.from({ length: 60 }, (_, i) => ({ t: T0 + i * 60000, used: 50 + i, total: 100 }));
  assert.equal(forecastDisk(burst).status, 'insufficient');
});

test('an already-full disk is 0 days away', () => {
  const f = forecastDisk(series(240, i => 90 + i / 24, 100));
  assert.equal(f.status, 'growing');
  assert.equal(f.daysToFull, 0);
});

test('growth too slow to matter within a year has no fill date', () => {
  const f = forecastDisk(series(240, i => 10 + i * (0.06 / 24), 1000));
  assert.equal(f.status, 'growing');
  assert.equal(f.daysToFull, null);
});

test('noisy growth is still roughly right', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  const f = forecastDisk(series(336, i => 40 + i / 24 * 2 + rnd() * 0.8, 200));
  assert.equal(f.status, 'growing');
  assert.ok(Math.abs(f.rateGbPerDay - 2) < 0.1, 'rate ' + f.rateGbPerDay);
});

test('garbage input is ignored, never throws', () => {
  assert.equal(forecastDisk(null).status, 'insufficient');
  assert.equal(forecastDisk([{ t: 'x', used: 1, total: 0 }, {}]).status, 'insufficient');
});

test('alert level: only confident growth inside the horizon', () => {
  assert.equal(forecastAlertLevel({ status: 'growing', daysToFull: 2, r2: 0.9 }), 'critical');
  assert.equal(forecastAlertLevel({ status: 'growing', daysToFull: 10, r2: 0.9 }), 'warning');
  assert.equal(forecastAlertLevel({ status: 'growing', daysToFull: 30, r2: 0.9 }), null);
  assert.equal(forecastAlertLevel({ status: 'growing', daysToFull: 2, r2: 0.3 }), null, 'noisy fit must not page');
  assert.equal(forecastAlertLevel({ status: 'stable', daysToFull: null, r2: 1 }), null);
  assert.equal(forecastAlertLevel({ status: 'growing', daysToFull: null, r2: 1 }), null);
  assert.equal(forecastAlertLevel(null), null);
});

const g = (days, r2 = 0.9) => ({ status: 'growing', daysToFull: days, r2 });

test('state: entering warning / critical notifies once', () => {
  assert.deepEqual(nextForecastState(0, g(10)), { level: 1, notify: 'warning' });
  assert.deepEqual(nextForecastState(1, g(10)), { level: 1, notify: null }, 'no repeat every hour');
  assert.deepEqual(nextForecastState(1, g(2)), { level: 2, notify: 'critical' }, 'escalation notifies');
  assert.deepEqual(nextForecastState(0, g(2)), { level: 2, notify: 'critical' });
});

test('state: critical -> warning is a quiet downgrade', () => {
  assert.deepEqual(nextForecastState(2, g(8)), { level: 1, notify: null });
});

test('state: hysteresis - hovering past 14 days does not flap', () => {
  assert.deepEqual(nextForecastState(1, g(16)), { level: 1, notify: null }, '16 days: still inside the clear margin');
  assert.deepEqual(nextForecastState(1, g(25)), { level: 0, notify: 'recovered' }, 'beyond 21 days: cleared');
});

test('state: a cleanup (stable / insufficient) resolves the alert', () => {
  assert.deepEqual(nextForecastState(2, { status: 'insufficient' }), { level: 0, notify: 'recovered' });
  assert.deepEqual(nextForecastState(1, { status: 'stable', daysToFull: null }), { level: 0, notify: 'recovered' });
});

test('state: a noisy fit never raises an alert from nothing', () => {
  assert.deepEqual(nextForecastState(0, g(2, 0.2)), { level: 0, notify: null });
});
