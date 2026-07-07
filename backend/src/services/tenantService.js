const db = require('../db');

// Domain-joined machines get a customer automatically. If the domain is already
// mapped, inherit it. If it's a brand-new domain, auto-onboard: create a customer
// named after the domain, map it, and pull in every machine of that domain. The
// admin renames the customer to the real client name later. Non-domain machines
// are assigned manually. Never overrides an existing assignment.
async function assignCustomerByDomain(serverId, hostname) {
  if (!hostname || !hostname.includes('.')) return;
  const server = await db.queryOne('SELECT customer_id FROM servers WHERE id = $1', [serverId]);
  if (!server || server.customer_id) return;
  const domain = hostname.substring(hostname.indexOf('.') + 1).toLowerCase();

  let map = await db.queryOne('SELECT customer_id FROM domain_customers WHERE domain = $1', [domain]);

  if (!map) {
    // New domain — auto-create a customer and claim the domain. The domain_customers
    // PK guards against a race when several machines of the domain register at once;
    // if we lose the race, drop our orphan customer and use the winner's mapping.
    try {
      const cust = await db.query(
        'INSERT INTO customers (name, description) VALUES ($1, $2) RETURNING id',
        [domain, 'Auto-created from domain ' + domain]
      );
      const claim = await db.query(
        `INSERT INTO domain_customers (domain, customer_id) VALUES ($1, $2)
         ON CONFLICT (domain) DO NOTHING RETURNING customer_id`,
        [domain, cust.rows[0].id]
      );
      if (claim.rowCount === 0) {
        await db.query('DELETE FROM customers WHERE id = $1', [cust.rows[0].id]);
      } else {
        console.log(`[Tenant] Auto-onboarded domain ${domain} as customer #${cust.rows[0].id}`);
      }
      map = await db.queryOne('SELECT customer_id FROM domain_customers WHERE domain = $1', [domain]);
    } catch (err) {
      console.error('[Tenant] auto-onboard', err.message);
      return;
    }
  }

  if (map && map.customer_id) {
    // Assign every still-unowned machine of this domain, not just the caller.
    await db.query(
      `UPDATE servers SET customer_id = $1
       WHERE customer_id IS NULL AND lower(substring(hostname from position('.' in hostname) + 1)) = $2`,
      [map.customer_id, domain]
    );
  }
}

module.exports = { assignCustomerByDomain };
