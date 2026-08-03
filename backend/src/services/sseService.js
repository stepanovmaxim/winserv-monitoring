// Minimal Server-Sent-Events hub. Holds the set of connected dashboard clients
// and pushes live server/metric updates so the UI reflects changes without polling.
//
// Each client carries the customer scope of the user who opened it, so a customer
// admin only receives live events for their own tenants. Broadcasts that carry no
// customer_id are treated as unscoped and delivered only to unrestricted clients.
const { canAccessCustomer } = require('../lib/accessPolicy');

const clients = new Set();

// scope: null = unrestricted, array = allowed customer ids.
function addClient(res, scope = null) {
  const client = { res, scope };
  clients.add(client);
  res.on('close', () => clients.delete(client));
  return client;
}

function broadcast(type, data) {
  if (clients.size === 0) return;
  const payload = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  const customerId = data ? data.customer_id : undefined;
  for (const c of clients) {
    if (c.scope !== null && !canAccessCustomer(c.scope, customerId)) continue;
    try { c.res.write(payload); } catch { clients.delete(c); }
  }
}

function heartbeat() {
  for (const c of clients) {
    try { c.res.write(': ping\n\n'); } catch { clients.delete(c); }
  }
}

function clientCount() {
  return clients.size;
}

module.exports = { addClient, broadcast, heartbeat, clientCount };
