// Pure threshold helpers, unit-tested in test/thresholds.test.js.

// First value that parses to a finite integer — walks the threshold
// inheritance chain (server → group → customer → global).
function firstNum(...vals) {
  for (const v of vals) {
    const n = parseInt(v);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

// Hysteresis: trigger once above triggerAt, only recover once below recoverAt.
// Returns 'triggered' | 'recovered' | null.
function thresholdTransition(wasAbove, value, triggerAt, recoverAt) {
  if (!wasAbove && value > triggerAt) return 'triggered';
  if (wasAbove && value < recoverAt) return 'recovered';
  return null;
}

module.exports = { firstNum, thresholdTransition };
