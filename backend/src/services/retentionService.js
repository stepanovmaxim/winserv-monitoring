const db = require('../db');

// How long to keep raw history. Metrics arrive every minute per server, events
// in bursts — both grow unbounded without this. Override via env if needed.
const METRICS_DAYS = parseInt(process.env.METRICS_RETENTION_DAYS) || 30;
const EVENTS_DAYS = parseInt(process.env.EVENTS_RETENTION_DAYS) || 30;

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
    console.log(`[Retention] Purged ${m.rowCount} metrics (>${METRICS_DAYS}d) and ${e.rowCount} events (>${EVENTS_DAYS}d)`);
  } catch (err) {
    console.error('[Retention]', err.message);
  }
}

module.exports = { purgeOldData, METRICS_DAYS, EVENTS_DAYS };
