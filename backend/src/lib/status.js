// Pure status helpers for the public status page, unit-tested in test/status.test.js.

// Normalise a raw server/check status to a public-facing state.
function normalizeStatus(s) {
  if (s === 'online' || s === 'up') return 'operational';
  if (s === 'warning') return 'degraded';
  if (s === 'offline' || s === 'down' || s === 'critical') return 'down';
  return 'unknown';
}

// Roll a list of components up to one overall state (worst wins).
function overallStatus(components) {
  if (!Array.isArray(components) || !components.length) return 'unknown';
  if (components.some(c => c.status === 'down')) return 'down';
  if (components.some(c => c.status === 'degraded')) return 'degraded';
  return 'operational';
}

module.exports = { normalizeStatus, overallStatus };
