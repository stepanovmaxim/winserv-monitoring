const db = require('../db');

// True if the server sits inside any active maintenance window covering it —
// global, its customer, its group, or the server itself.
async function isMuted(server) {
  if (!server) return false;
  const row = await db.queryOne(
    `SELECT 1 FROM maintenance_windows
     WHERE NOW() BETWEEN starts_at AND ends_at
       AND (scope_type = 'global'
         OR (scope_type = 'server'   AND scope_id = $1)
         OR (scope_type = 'group'    AND scope_id = $2)
         OR (scope_type = 'customer' AND scope_id = $3))
     LIMIT 1`,
    [server.id, server.group_id || 0, server.customer_id || 0]
  );
  return !!row;
}

module.exports = { isMuted };
