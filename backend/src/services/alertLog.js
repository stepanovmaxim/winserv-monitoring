const db = require('../db');

// Central alert journal. Fire-and-forget: recording a fired alert must never
// break the actual notification path, so failures are swallowed. Only alerts
// that were really dispatched (not muted) should be logged here, so the journal
// matches what operators received.
function logAlert({ severity = 'warning', kind = '', title = '', message = '', server_id = null, check_id = null, customer_id = null } = {}) {
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').trim();
  const body = strip(message) || strip(title);
  db.query(
    `INSERT INTO alerts (severity, kind, title, message, server_id, check_id, customer_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      ['info', 'warning', 'critical'].includes(severity) ? severity : 'warning',
      String(kind || '').slice(0, 40),
      strip(title).slice(0, 200),
      body.slice(0, 600),
      server_id || null,
      check_id || null,
      customer_id || null,
    ]
  ).catch((err) => console.error('[AlertLog]', err.message));
}

module.exports = { logAlert };
