// Pure access rules for per-customer scoping. Unit-tested in test/accessPolicy.test.js.
//
// scope === null  -> unrestricted (global admin / operator): sees everything.
// scope === [ids] -> restricted: sees only those customers.
//
// Fails closed: a resource with no customer (customer_id NULL) is visible only
// to unrestricted users, because an unassigned server belongs to no tenant and
// must not leak into a customer admin's view.

function isUnrestricted(scope) {
  return scope === null || scope === undefined;
}

function canAccessCustomer(scope, customerId) {
  if (isUnrestricted(scope)) return true;
  if (!Array.isArray(scope) || scope.length === 0) return false;
  if (customerId === null || customerId === undefined) return false;
  return scope.map(Number).includes(Number(customerId));
}

// Narrow a requested customer filter to what the user may actually see.
// Returns the list of customer ids to query, or null for "no restriction".
function effectiveCustomerIds(scope, requested) {
  if (isUnrestricted(scope)) return requested == null ? null : [Number(requested)];
  const allowed = (scope || []).map(Number);
  if (requested == null) return allowed;
  const r = Number(requested);
  return allowed.includes(r) ? [r] : [];
}

module.exports = { isUnrestricted, canAccessCustomer, effectiveCustomerIds };
