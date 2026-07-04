const db = require('../db');

// Collapse minute-level metrics into hourly buckets so long-range charts stay
// fast and history can outlive the 30-day raw retention. Re-aggregates the last
// few hours each run to absorb late-arriving samples.
async function rollupMetrics() {
  try {
    const r = await db.query(`
      INSERT INTO metrics_hourly (server_id, bucket, cpu_avg, cpu_max, mem_pct_avg, disk_pct_avg, sample_count)
      SELECT
        server_id,
        date_trunc('hour', collected_at) AS bucket,
        AVG(cpu_usage),
        MAX(cpu_usage),
        AVG(CASE WHEN memory_total_mb > 0 THEN memory_used_mb / memory_total_mb * 100 END),
        AVG(CASE WHEN disk_total_gb > 0 THEN disk_used_gb / disk_total_gb * 100 END),
        COUNT(*)
      FROM metrics
      WHERE collected_at >= date_trunc('hour', NOW()) - INTERVAL '3 hours'
      GROUP BY server_id, date_trunc('hour', collected_at)
      ON CONFLICT (server_id, bucket) DO UPDATE SET
        cpu_avg = EXCLUDED.cpu_avg,
        cpu_max = EXCLUDED.cpu_max,
        mem_pct_avg = EXCLUDED.mem_pct_avg,
        disk_pct_avg = EXCLUDED.disk_pct_avg,
        sample_count = EXCLUDED.sample_count
    `);
    console.log(`[Rollup] Upserted ${r.rowCount} hourly buckets`);
  } catch (err) {
    console.error('[Rollup]', err.message);
  }
}

module.exports = { rollupMetrics };
