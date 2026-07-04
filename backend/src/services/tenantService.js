const db = require('../db');

// Domain-joined machines inherit their customer from the domain→customer map
// (set once per domain in the panel). Non-domain machines are assigned manually,
// so this is a no-op for them. Never overrides an existing assignment.
async function assignCustomerByDomain(serverId, hostname) {
  if (!hostname || !hostname.includes('.')) return;
  const server = await db.queryOne('SELECT customer_id FROM servers WHERE id = $1', [serverId]);
  if (!server || server.customer_id) return;
  const domain = hostname.substring(hostname.indexOf('.') + 1).toLowerCase();
  const map = await db.queryOne('SELECT customer_id FROM domain_customers WHERE domain = $1', [domain]);
  if (map && map.customer_id) {
    await db.query(
      'UPDATE servers SET customer_id = $1 WHERE id = $2 AND customer_id IS NULL',
      [map.customer_id, serverId]
    );
  }
}

module.exports = { assignCustomerByDomain };
