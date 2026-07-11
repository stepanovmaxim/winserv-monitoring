const db = require('../db');

// How long to keep raw history. Metrics arrive every minute per server, events
// in bursts — both grow unbounded without this. Override via env if needed.
const METRICS_DAYS = parseInt(process.env.METRICS_RETENTION_DAYS) || 30;
const EVENTS_DAYS = parseInt(process.env.EVENTS_RETENTION_DAYS) || 30;
// Hourly rollups are tiny — keep them long so charts have real history.
const ROLLUP_DAYS = parseInt(process.env.ROLLUP_RETENTION_DAYS) || 365;
// Alert journal: keep acknowledged alerts a while for audit, then trim.
const ALERTS_DAYS = parseInt(process.env.ALERTS_RETENTION_DAYS) || 90;

async function purgeOldData() {
  try {
    const m = await db.query(
      `DELETE FROM metrics WHERE collected_at < NOW() - ($1 || ' days')::INTERVAL`,
      [String(METRICS_DAYS)]
    );
    const e = await db.query(
      `DELETE FROM system_events WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [String(EVENTS_DAYS)]
    );
    const r = await db.query(
      `DELETE FROM metrics_hourly WHERE bucket < NOW() - ($1 || ' days')::INTERVAL`,
      [String(ROLLUP_DAYS)]
    );
    const sec = await db.query(
      `DELETE FROM security_events WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [String(EVENTS_DAYS)]
    );
    const al = await db.query(
      `DELETE FROM alerts WHERE created_at < NOW() - ($1 || ' days')::INTERVAL`,
      [String(ALERTS_DAYS)]
    );
    console.log(`[Retention] Purged ${m.rowCount} metrics (>${METRICS_DAYS}d), ${e.rowCount} events (>${EVENTS_DAYS}d), ${sec.rowCount} security (>${EVENTS_DAYS}d), ${al.rowCount} alerts (>${ALERTS_DAYS}d), ${r.rowCount} rollups (>${ROLLUP_DAYS}d)`);
  } catch (err) {
    console.error('[Retention]', err.message);
  }
}

module.exports = { purgeOldData, METRICS_DAYS, EVENTS_DAYS, ROLLUP_DAYS, ALERTS_DAYS };
