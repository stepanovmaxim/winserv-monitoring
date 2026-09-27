const express = require('express');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');
const { customerFilter, canSeeCustomer } = require('../services/scopeService');
const { monthRange, uptimePct, patchStatus, buildRecommendations } = require('../lib/customerReport');
const { scoreServer } = require('../lib/securityScore');
const { EVENTS_DAYS } = require('../services/retentionService');

const router = express.Router();

// Uptime % per server, derived from hourly rollups (kept 365d). Each hour is
// expected to hold ~60 minute-samples; presence vs expectation = uptime.
// "expected" is measured from when we first have data for a server (or the
// window start, whichever is later), so a freshly-collected fleet isn't
// reported as 0% — the number becomes a true N-day SLA as history accrues.
router.get('/uptime', requireAuth, requireApproved, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const scoped = await customerFilter(req.user, 's.customer_id', 2);
  const rows = await db.queryAll(
    `SELECT s.id, s.hostname, c.name AS customer_name,
        COALESCE(SUM(mh.sample_count), 0)::int AS samples,
        MIN(mh.bucket) AS first_bucket
     FROM servers s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN metrics_hourly mh ON mh.server_id = s.id AND mh.bucket >= NOW() - ($1 || ' days')::INTERVAL
     ${scoped.sql ? 'WHERE' + scoped.sql.replace(/^ AND/, '') : ''}
     GROUP BY s.id, s.hostname, c.name
     ORDER BY s.hostname`,
    [String(days), ...scoped.params]
  );

  const now = Date.now();
  const windowStart = now - days * 86400000;
  const servers = rows.map(r => {
    const start = r.first_bucket ? Math.max(windowStart, new Date(r.first_bucket).getTime()) : now;
    const expectedMin = Math.max(1, (now - start) / 60000);
    const pct = Math.min(100, Math.round((r.samples / expectedMin) * 1000) / 10);
    return { id: r.id, hostname: r.hostname, customer_name: r.customer_name, samples: r.samples, uptime_pct: r.first_bucket ? pct : 0 };
  });

  res.json({ days, servers });
});

// Monthly service report for one customer: availability, incidents, security,
// patches, disks and workstations over a calendar month, plus recommendations.
// Some sections are period data (uptime, alerts, logons, blocks, threats); the
// rest is the state on the day the report is generated (patch level, antivirus,
// security score, disks, workstations) and is labelled as such in the UI.
router.get('/customer/:id', requireAuth, requireApproved, async (req, res) => {
  const customerId = parseInt(req.params.id);
  if (!customerId) return res.status(400).json({ error: 'Bad customer id' });
  if (!(await canSeeCustomer(req.user, customerId))) return res.status(403).json({ error: 'No access' });
  const customer = await db.queryOne('SELECT id, name FROM customers WHERE id = $1', [customerId]);
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const now = new Date();
  const { start, end, label } = monthRange(req.query.month, now);
  const P = [start.toISOString(), end.toISOString()];

  const srv = await db.queryAll(
    `SELECT id, hostname, display_name, os_info, platform, status, agent_version, last_seen, audit_json
     FROM servers WHERE customer_id = $1 ORDER BY COALESCE(display_name, hostname)`,
    [customerId]
  );
  const ids = srv.map(s => s.id);
  const nameOf = (s) => s.display_name || s.hostname;
  const byId = new Map(srv.map(s => [s.id, s]));

  const [up, offline, sevRows, kindRows, topAlerts, fails, topIps, blocks, threats, av, hw, disks, ws] = await Promise.all([
    db.queryAll(`SELECT server_id, COALESCE(SUM(sample_count),0)::int AS samples, MIN(bucket) AS first
                 FROM metrics_hourly WHERE server_id = ANY($1) AND bucket >= $2 AND bucket < $3 GROUP BY server_id`, [ids, ...P]),
    db.queryAll(`SELECT server_id, COUNT(*)::int AS n FROM alerts
                 WHERE server_id = ANY($1) AND kind = 'offline' AND created_at >= $2 AND created_at < $3 GROUP BY server_id`, [ids, ...P]),
    db.queryAll(`SELECT severity, COUNT(*)::int AS n FROM alerts
                 WHERE (customer_id = $1 OR server_id = ANY($2)) AND created_at >= $3 AND created_at < $4 GROUP BY severity`, [customerId, ids, ...P]),
    db.queryAll(`SELECT kind, COUNT(*)::int AS n FROM alerts
                 WHERE (customer_id = $1 OR server_id = ANY($2)) AND created_at >= $3 AND created_at < $4 GROUP BY kind ORDER BY n DESC`, [customerId, ids, ...P]),
    db.queryAll(`SELECT a.created_at, a.severity, a.kind, a.message, a.server_id FROM alerts a
                 WHERE (a.customer_id = $1 OR a.server_id = ANY($2)) AND a.created_at >= $3 AND a.created_at < $4
                   AND a.severity IN ('critical','warning')
                 ORDER BY (a.severity = 'critical') DESC, a.created_at DESC LIMIT 15`, [customerId, ids, ...P]),
    db.queryOne(`SELECT COUNT(*)::int AS fails, COUNT(DISTINCT ip)::int AS ips FROM security_events
                 WHERE server_id = ANY($1) AND event = 'fail' AND created_at >= $2 AND created_at < $3`, [ids, ...P]),
    db.queryAll(`SELECT ip, COUNT(*)::int AS n, COUNT(DISTINCT account)::int AS accounts FROM security_events
                 WHERE server_id = ANY($1) AND event = 'fail' AND ip <> '' AND ip <> '-' AND created_at >= $2 AND created_at < $3
                 GROUP BY ip ORDER BY n DESC LIMIT 5`, [ids, ...P]),
    db.queryOne(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE auto = 1)::int AS auto FROM ip_blocks
                 WHERE server_id = ANY($1) AND created_at >= $2 AND created_at < $3`, [ids, ...P]),
    db.queryAll(`SELECT server_id, name, resource, action_success, detected_at FROM threat_detections
                 WHERE server_id = ANY($1) AND detected_at >= $2 AND detected_at < $3 ORDER BY detected_at DESC LIMIT 20`, [ids, ...P]),
    db.queryAll(`SELECT * FROM defender_status WHERE server_id = ANY($1)`, [ids]),
    db.queryAll(`SELECT server_id, last_patch_date FROM server_hardware WHERE server_id = ANY($1)`, [ids]),
    db.queryAll(`SELECT * FROM disk_forecasts WHERE server_id = ANY($1) ORDER BY server_id, drive`, [ids]),
    db.queryAll(`SELECT os_caption, last_patch_date, collected_at FROM workstations WHERE customer_id = $1`, [customerId]),
  ]);

  const upBy = new Map(up.map(r => [r.server_id, r]));
  const offBy = new Map(offline.map(r => [r.server_id, r.n]));
  const hwBy = new Map(hw.map(r => [r.server_id, r]));

  const servers = srv.map(s => {
    const u = upBy.get(s.id);
    let audit = null;
    try { audit = s.audit_json ? JSON.parse(s.audit_json) : null; } catch {}
    return {
      id: s.id,
      name: nameOf(s),
      os: s.os_info || '',
      platform: s.platform || 'windows',
      status: s.status,
      uptime: u ? uptimePct({ samples: u.samples, firstSample: u.first, start, end, now }) : null,
      offline: offBy.get(s.id) || 0,
      patch: s.platform === 'linux' ? null : patchStatus(hwBy.get(s.id)?.last_patch_date, now),
      score: s.platform === 'linux' ? null : scoreServer(audit).score,
    };
  });

  const antivirus = av.map(a => ({
    host: nameOf(byId.get(a.server_id) || {}),
    available: a.available, av_enabled: a.av_enabled, realtime_enabled: a.realtime_enabled,
    signature_age_days: a.signature_age_days, third_party: a.third_party || '',
  }));
  const diskList = disks.map(d => ({
    host: nameOf(byId.get(d.server_id) || {}), drive: d.drive, used: d.used_gb, total: d.total_gb, free: d.free_gb,
    status: d.status, days: d.days_to_full, rate: d.rate_gb_day, r2: d.r2,
  }));
  const threatList = threats.map(t => ({ host: nameOf(byId.get(t.server_id) || {}), name: t.name, resource: t.resource, action_success: t.action_success, detected_at: t.detected_at }));

  const osCount = new Map();
  let wsBehind = 0, wsStale = 0;
  for (const w of ws) {
    const os = (w.os_caption || '—').replace(/^Microsoft\s+|^Майкрософт\s+/i, '');
    osCount.set(os, (osCount.get(os) || 0) + 1);
    const p = patchStatus(w.last_patch_date, now);
    if (p.status === 'behind' || p.status === 'critical') wsBehind++;
    if (!w.collected_at || now - new Date(w.collected_at) > 14 * 86400000) wsStale++;
  }
  const workstations = {
    total: ws.length,
    byOs: [...osCount.entries()].map(([os, n]) => ({ os, n })).sort((a, b) => b.n - a.n),
    patchBehind: wsBehind,
    stale: wsStale,
  };

  const bySeverity = { critical: 0, warning: 0, info: 0 };
  for (const r of sevRows) bySeverity[r.severity] = r.n;
  const uptimes = servers.map(s => s.uptime).filter(v => v != null);

  const report = {
    customer,
    period: { label, start, end },
    generated_at: now,
    // Raw logon events are kept EVENTS_DAYS; an older month is only partly covered.
    securityPartial: start.getTime() < now.getTime() - EVENTS_DAYS * 86400000,
    summary: {
      servers: servers.length,
      avgUptime: uptimes.length ? Math.round(uptimes.reduce((a, b) => a + b, 0) / uptimes.length * 10) / 10 : null,
      critical: bySeverity.critical,
      warnings: bySeverity.warning,
      blocks: blocks?.total || 0,
      threats: threatList.length,
      patchBehind: servers.filter(s => s.patch && (s.patch.status === 'behind' || s.patch.status === 'critical')).length,
      workstations: workstations.total,
    },
    servers,
    alerts: {
      bySeverity,
      byKind: kindRows,
      top: topAlerts.map(a => ({ ...a, host: a.server_id ? nameOf(byId.get(a.server_id) || {}) : '' })),
    },
    security: { fails: fails?.fails || 0, ips: fails?.ips || 0, topIps, blocks: { total: blocks?.total || 0, auto: blocks?.auto || 0 } },
    threats: threatList,
    antivirus,
    disks: diskList,
    workstations,
  };
  report.recommendations = buildRecommendations(report);
  res.json(report);
});

module.exports = router;
