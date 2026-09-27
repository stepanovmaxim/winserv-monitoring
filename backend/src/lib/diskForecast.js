'use strict';

// When will this volume fill up? A least-squares line through the used-space
// history, extrapolated to the free space left.
//
// A plain fit over the whole window lies after any step change, so the series
// is cut at the last one and only the part after it is fitted:
//   - a cleanup (used drops sharply): the fit would average the old and new
//     levels and report a slower growth than the disk really has;
//   - a resize (total changes): the free space before and after are unrelated.
//
// Pure and unit-tested. points: [{ t: epoch ms, used: GB, total: GB }].
const DAY_MS = 86400000;

const DEFAULTS = {
  minPoints: 24,      // ~a day of hourly samples before we say anything
  minSpanDays: 1,
  maxDays: 365,       // beyond a year the extrapolation is not meaningful
  dropGb: 1,          // a used-space drop larger than this (or dropPct) = cleanup
  dropPct: 0.02,
  resizePct: 0.01,    // total changed by more than this = volume resized
  stableRate: 0.05,   // GB/day below which the disk counts as not growing
};

function forecastDisk(points, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const pts = (Array.isArray(points) ? points : [])
    .map(p => ({ t: Number(p.t), used: Number(p.used), total: Number(p.total) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.used) && Number.isFinite(p.total) && p.total > 0 && p.used >= 0)
    .sort((a, b) => a.t - b.t);

  // Start the series after the last cleanup or resize.
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    const prev = pts[i - 1], cur = pts[i];
    const resized = Math.abs(cur.total - prev.total) > Math.max(0.5, prev.total * o.resizePct);
    const cleaned = prev.used - cur.used > Math.max(o.dropGb, prev.total * o.dropPct);
    if (resized || cleaned) start = i;
  }
  const seg = pts.slice(start);
  if (!seg.length) return { status: 'insufficient', points: 0 };

  const last = seg[seg.length - 1];
  const base = {
    totalGb: round(last.total, 1),
    usedGb: round(last.used, 1),
    freeGb: round(Math.max(0, last.total - last.used), 1),
    points: seg.length,
    since: seg[0].t,
    spanDays: round((last.t - seg[0].t) / DAY_MS, 1),
  };
  if (seg.length < o.minPoints || (last.t - seg[0].t) / DAY_MS < o.minSpanDays) {
    return { status: 'insufficient', ...base };
  }

  const { slope, r2 } = linearFit(seg.map(p => (p.t - seg[0].t) / DAY_MS), seg.map(p => p.used));
  const rate = round(slope, 2);

  if (slope < o.stableRate) {
    return { status: 'stable', rateGbPerDay: rate, r2: round(r2, 2), daysToFull: null, ...base };
  }
  const free = Math.max(0, last.total - last.used);
  const days = free / slope;
  return {
    status: 'growing',
    rateGbPerDay: rate,
    r2: round(r2, 2),
    daysToFull: days > o.maxDays ? null : round(days, 1),
    ...base,
  };
}

// Ordinary least squares: slope of y over x and the coefficient of
// determination. A flat series has no variance to explain; r2 is 0 then.
function linearFit(xs, ys) {
  const n = xs.length;
  let sx = 0, sy = 0;
  for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
  const mx = sx / n, my = sy / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const r2 = sxx > 0 && syy > 0 ? (sxy * sxy) / (sxx * syy) : 0;
  return { slope, r2 };
}

// Should this forecast raise an alert, and how loud? Only a confident, growing
// forecast inside the warning horizon qualifies; a noisy fit (low r2) never
// pages anyone.
function forecastAlertLevel(f, opts = {}) {
  const warnDays = opts.warnDays ?? 14;
  const critDays = opts.critDays ?? 3;
  const minR2 = opts.minR2 ?? 0.6;
  if (!f || f.status !== 'growing' || f.daysToFull == null) return null;
  if ((f.r2 ?? 0) < minR2) return null;
  if (f.daysToFull <= critDays) return 'critical';
  if (f.daysToFull <= warnDays) return 'warning';
  return null;
}

// Alert state machine for one volume, run every hour. Levels: 0 none, 1 warning,
// 2 critical. Rising a level notifies once; staying at a level is silent.
// Clearing needs a clear margin (hysteresis) so a disk hovering around the
// 14-day line does not flap warning/ok every hour. A series reset after a
// cleanup reads as "insufficient", which counts as resolved.
function nextForecastState(prevLevel, f, opts = {}) {
  const warnDays = opts.warnDays ?? 14;
  const clearDays = opts.clearDays ?? Math.round(warnDays * 1.5);
  const prev = Number(prevLevel) || 0;
  const lvlName = forecastAlertLevel(f, opts);
  const lvl = lvlName === 'critical' ? 2 : lvlName === 'warning' ? 1 : 0;

  if (lvl > prev) return { level: lvl, notify: lvl === 2 ? 'critical' : 'warning' };
  if (lvl === prev) return { level: prev, notify: null };
  if (lvl > 0) return { level: lvl, notify: null }; // critical -> warning: quiet downgrade

  const clearlyOk = !f || f.status !== 'growing' || f.daysToFull == null || f.daysToFull > clearDays;
  if (clearlyOk) return { level: 0, notify: 'recovered' };
  return { level: prev, notify: null };
}

function round(v, d) {
  const k = Math.pow(10, d);
  return Math.round(v * k) / k;
}

module.exports = { forecastDisk, forecastAlertLevel, nextForecastState, linearFit, DEFAULTS };
