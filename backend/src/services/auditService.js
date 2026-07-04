const db = require('../db');

// Records who flipped a server action (hide/show file + logoff) and from where.
// The kill-switch can log every user off a server, so an accountable trail matters.
async function logAction({ action_id, server_id, hostname, label, new_state, source, actor }) {
  try {
    await db.query(
      `INSERT INTO action_audit (action_id, server_id, hostname, label, new_state, source, actor)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [action_id || null, server_id || null, hostname || '', label || '', new_state || '', source || '', String(actor || '')]
    );
  } catch (err) {
    console.error('[Audit]', err.message);
  }
}

module.exports = { logAction };
