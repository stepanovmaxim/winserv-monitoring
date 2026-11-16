const db = require('../db');

const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();

// Insert one journal row and resolve with its id. Rejects on a database error.
async function insertAlert({ severity = 'warning', kind = '', title = '', message = '', server_id = null, check_id = null, customer_id = null, group_key = null } = {}) {
  const body = strip(message) || strip(title);
  const r = await db.query(
    `INSERT INTO alerts (severity, kind, title, message, server_id, check_id, customer_id, group_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [
      ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning',
      String(kind || '').slice(0, 40),
      strip(title).slice(0, 200),
      body.slice(0, 600),
      server_id || null,
      check_id || null,
      customer_id || null,
      group_key ? String(group_key).slice(0, 200) : null,
    ]
  );
  return r.rows[0].id;
}

// Central alert journal. Fire-and-forget: recording a fired alert must never
// break the actual notification path, so failures are swallowed. Only alerts
// that were really dispatched (not muted) should be logged here, so the journal
// matches what operators received.
function logAlert(alert) {
  insertAlert(alert).catch((err) => console.error('[AlertLog]', err.message));
}

module.exports = { logAlert, insertAlert, strip };
