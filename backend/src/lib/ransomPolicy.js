// When a drop in shadow copies is worth alerting on. Pure, tested in
// test/ransomPolicy.test.js.
//
// Learned in production: a backup product creates a VSS snapshot, uses it and
// deletes it every night. That is a 1 -> 0 transition on a perfectly healthy
// server, and the first version of this rule reported it as
// "SHADOW COPIES DELETED ... the usual step right before encryption".
// Most servers here idle at 0 copies, so churn of one or two is meaningless.
//
// Ransomware wipes EVERYTHING at once and the copies never come back, so we
// require a real drop AND confirmation on a following report.

const DEFAULT_MIN_DROP = 3;
const DEFAULT_CONFIRMATIONS = 2;

function shouldAlertShadowDrop({
  prev,
  now,
  zeroStreak = 0,
  minDrop = DEFAULT_MIN_DROP,
  confirmations = DEFAULT_CONFIRMATIONS,
} = {}) {
  // An unreadable count (WMI unavailable) must never look like a deletion.
  if (prev === null || prev === undefined || now === null || now === undefined) {
    return { alert: false, reason: 'unknown' };
  }
  if (now > 0) return { alert: false, reason: 'copies-present' };

  const drop = Number(prev) - Number(now);
  if (drop < Math.max(1, minDrop)) return { alert: false, reason: 'normal-churn' };
  if (zeroStreak < Math.max(1, confirmations)) return { alert: false, reason: 'unconfirmed' };

  return { alert: true, reason: 'mass-deletion', drop };
}

module.exports = { shouldAlertShadowDrop, DEFAULT_MIN_DROP, DEFAULT_CONFIRMATIONS };
