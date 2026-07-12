const { test } = require('node:test');
const assert = require('node:assert');
const { firstNum, thresholdTransition } = require('../src/lib/thresholds');

test('firstNum walks the inheritance chain to the first finite value', () => {
  assert.strictEqual(firstNum(null, undefined, '', 80, 90), 80);
  assert.strictEqual(firstNum(undefined, '95'), 95);
  assert.strictEqual(firstNum(null, undefined), null);
  assert.strictEqual(firstNum(0, 90), 0); // 0 is a valid override, not "empty"
});

test('thresholdTransition triggers only when crossing up from below', () => {
  assert.strictEqual(thresholdTransition(false, 95, 90, 70), 'triggered');
  assert.strictEqual(thresholdTransition(false, 85, 90, 70), null);
});

test('thresholdTransition has hysteresis: recovers only below the recover line', () => {
  assert.strictEqual(thresholdTransition(true, 85, 90, 70), null);      // still elevated
  assert.strictEqual(thresholdTransition(true, 65, 90, 70), 'recovered');
});

test('thresholdTransition does not re-trigger while already active', () => {
  assert.strictEqual(thresholdTransition(true, 99, 90, 70), null);
});
