'use strict';

// Pure pieces of the monthly customer report: which month, how available each
// server was in it, how far behind on patches, and what to recommend. Kept out
// of the route so the arithmetic is unit-tested.

// "2026-08" -> { start, end } as UTC Dates covering that calendar month.
// No/invalid input -> the previous full month relative to `now`: a report is
// normally produced early in the month for the month that just ended.
function monthRange(month, now = new Date()) {
  let y, m;
  const mt = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (mt && +mt[2] >= 1 && +mt[2] <= 12) {
    y = +mt[1]; m = +mt[2] - 1;
  } else {
    y = now.getUTCFullYear(); m = now.getUTCMonth() - 1;
    if (m < 0) { m = 11; y -= 1; }
  }
  const start = new Date(Date.UTC(y, m, 1));
  const end = new Date(Date.UTC(y, m + 1, 1));
  return { start, end, label: `${y}-${String(m + 1).padStart(2, '0')}` };
}

// Availability over the part of the period we could have seen: from the later
// of the period start and the first sample, to the earlier of the period end
// and now. Agents report once a minute, so presence = samples / minutes.
// Null when there is no data at all in the period (unknown, not 0%).
function uptimePct({ samples, firstSample, start, end, now = new Date() }) {
  if (!samples || !firstSample) return null;
  const from = Math.max(start.getTime(), new Date(firstSample).getTime());
  const to = Math.min(end.getTime(), now.getTime());
  const minutes = (to - from) / 60000;
  if (minutes <= 0) return null;
  return Math.min(100, Math.round((samples / minutes) * 1000) / 10);
}

// Days since the last installed update, and a verdict.
function patchStatus(lastPatchDate, now = new Date()) {
  if (!lastPatchDate) return { days: null, status: 'unknown' };
  const t = new Date(lastPatchDate).getTime();
  if (!Number.isFinite(t)) return { days: null, status: 'unknown' };
  const days = Math.max(0, Math.floor((now.getTime() - t) / 86400000));
  return { days, status: days > 60 ? 'critical' : days > 35 ? 'behind' : 'ok' };
}

// Plain-language follow-ups derived from the report data. Returned as codes +
// params so the panel renders them in the reader's language.
function buildRecommendations(r) {
  const out = [];
  const servers = r.servers || [];

  for (const s of servers) {
    if (s.uptime != null && s.uptime < 99) out.push({ code: 'uptime', severity: s.uptime < 95 ? 'critical' : 'warning', host: s.name, value: s.uptime });
  }
  for (const s of servers) {
    if (s.patch && (s.patch.status === 'critical' || s.patch.status === 'behind')) {
      out.push({ code: 'patch', severity: s.patch.status === 'critical' ? 'critical' : 'warning', host: s.name, value: s.patch.days });
    }
  }
  for (const d of r.disks || []) {
    if (d.status === 'growing' && d.days != null && d.days <= 30 && (d.r2 ?? 0) >= 0.6) {
      out.push({ code: 'disk', severity: d.days <= 7 ? 'critical' : 'warning', host: d.host, drive: d.drive, value: Math.round(d.days) });
    } else if (d.total > 0 && d.used / d.total >= 0.9) {
      out.push({ code: 'diskfull', severity: 'warning', host: d.host, drive: d.drive, value: Math.round(d.used / d.total * 100) });
    }
  }
  for (const a of r.antivirus || []) {
    if (a.third_party) continue;
    if (!a.available || !a.av_enabled || !a.realtime_enabled) out.push({ code: 'av', severity: 'critical', host: a.host });
    else if (a.signature_age_days != null && a.signature_age_days > 3) out.push({ code: 'avsig', severity: 'warning', host: a.host, value: a.signature_age_days });
  }
  for (const s of servers) {
    if (s.score != null && s.score < 70) out.push({ code: 'score', severity: 'warning', host: s.name, value: s.score });
  }
  if ((r.threats || []).some(t => !t.action_success)) out.push({ code: 'threat', severity: 'critical' });
  const ws = r.workstations || {};
  if (ws.patchBehind > 0) out.push({ code: 'wspatch', severity: 'warning', value: ws.patchBehind });
  if (ws.stale > 0) out.push({ code: 'wsstale', severity: 'info', value: ws.stale });

  const rank = { critical: 0, warning: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

module.exports = { monthRange, uptimePct, patchStatus, buildRecommendations };
