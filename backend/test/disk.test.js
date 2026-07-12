const { test } = require('node:test');
const assert = require('node:assert');
const { filterValidDisks, diskAggregate, diskPct } = require('../src/lib/disk');

test('filterValidDisks drops mount-point volumes that report free > total', () => {
  const disks = [
    { drive: 'C:', total_gb: 100, free_gb: 40 },
    { drive: 'D:', total_gb: 10, free_gb: 161.8 }, // reparse volume — impossible
  ];
  const valid = filterValidDisks(disks);
  assert.strictEqual(valid.length, 1);
  assert.strictEqual(valid[0].drive, 'C:');
});

test('filterValidDisks keeps a disk that is essentially full (free≈0)', () => {
  const valid = filterValidDisks([{ drive: 'C:', total_gb: 100, free_gb: 0 }]);
  assert.strictEqual(valid.length, 1);
});

test('filterValidDisks returns [] for non-array input', () => {
  assert.deepStrictEqual(filterValidDisks(undefined), []);
  assert.deepStrictEqual(filterValidDisks(null), []);
});

test('diskAggregate recomputes sane totals from valid disks', () => {
  const agg = diskAggregate([
    { total_gb: 100, free_gb: 40 },
    { total_gb: 200, free_gb: 50 },
  ]);
  assert.strictEqual(agg.total_gb, 300);
  assert.strictEqual(agg.free_gb, 90);
  assert.strictEqual(agg.used_gb, 210);
});

test('diskAggregate is null when there are no valid disks', () => {
  assert.strictEqual(diskAggregate([]), null);
});

test('diskPct clamps to 0..100 and never goes negative (the original bug)', () => {
  assert.strictEqual(diskPct(210, 300), 70);
  assert.strictEqual(diskPct(-151.8, 10), 0);   // would have shown -1518%
  assert.strictEqual(diskPct(120, 100), 100);
  assert.strictEqual(diskPct(5, 0), null);      // no total → unknown
});
