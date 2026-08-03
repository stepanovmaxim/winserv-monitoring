const db = require('../db');
const { ADMIN_EMAIL } = require('../auth');
const { isUnrestricted, canAccessCustomer, effectiveCustomerIds } = require('../lib/accessPolicy');

// Resolve a user's customer scope from the DB (not from the JWT), so changing an
// assignment takes effect on the next request instead of after a re-login.
// Returns null for unrestricted, or an array of allowed customer ids.
async function getScope(user) {
  if (!user || !user.id) return [];                                  // fail closed
  if (user.email && ADMIN_EMAIL && user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) return null; // primary admin is never locked out
  const rows = await db.queryAll('SELECT customer_id FROM user_customers WHERE user_id = $1', [user.id]);
  if (!rows.length) return null;                                     // no assignment = full access (legacy behaviour)
  return rows.map(r => Number(r.customer_id));
}

// SQL fragment restricting a column to the user's scope.
// Returns { sql, params } where sql is '' when the user is unrestricted.
async function customerFilter(user, column = 's.customer_id', startIndex = 1) {
  const scope = await getScope(user);
  if (isUnrestricted(scope)) return { sql: '', params: [], scope };
  if (!scope.length) return { sql: ' AND FALSE', params: [], scope };
  return { sql: ` AND ${column} = ANY($${startIndex})`, params: [scope], scope };
}

async function canSeeCustomer(user, customerId) {
  return canAccessCustomer(await getScope(user), customerId);
}

// Guard for any per-server endpoint: resolves the server's customer and checks it.
async function canSeeServer(user, serverId) {
  const scope = await getScope(user);
  if (isUnrestricted(scope)) return true;
  const s = await db.queryOne('SELECT customer_id FROM servers WHERE id = $1', [serverId]);
  if (!s) return false;
  return canAccessCustomer(scope, s.customer_id);
}

// Express guard for routes shaped like /:serverId or /:id (server id).
function requireServerAccess(param = 'serverId') {
  return async (req, res, next) => {
    try {
      if (await canSeeServer(req.user, req.params[param])) return next();
      return res.status(403).json({ error: 'No access to this server' });
    } catch (err) {
      return res.status(403).json({ error: 'No access to this server' });
    }
  };
}

module.exports = {
  getScope, customerFilter, canSeeCustomer, canSeeServer, requireServerAccess,
  isUnrestricted, effectiveCustomerIds,
};
