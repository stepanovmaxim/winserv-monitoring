const express = require('express');
const { requireAuth, requireApproved } = require('../middleware/authMiddleware');
const db = require('../db');

const router = express.Router();

// Uptime % per server, derived from hourly rollups (kept 365d). Each hour is
// expected to hold ~60 minute-samples; presence vs expectation = uptime.
// "expected" is measured from when we first have data for a server (or the
// window start, whichever is later), so a freshly-collected fleet isn't
// reported as 0% — the number becomes a true N-day SLA as history accrues.
router.get('/uptime', requireAuth, requireApproved, async (req, res) => {
  const days = Math.min(parseInt(req.query.days) || 30, 365);
  const rows = await db.queryAll(
    `SELECT s.id, s.hostname, c.name AS customer_name,
        COALESCE(SUM(mh.sample_count), 0)::int AS samples,
        MIN(mh.bucket) AS first_bucket
     FROM servers s
     LEFT JOIN customers c ON s.customer_id = c.id
     LEFT JOIN metrics_hourly mh ON mh.server_id = s.id AND mh.bucket >= NOW() - ($1 || ' days')::INTERVAL
     GROUP BY s.id, s.hostname, c.name
     ORDER BY s.hostname`,
    [String(days)]
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

module.exports = router;
