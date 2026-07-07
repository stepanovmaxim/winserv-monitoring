// Health monitoring ignores these auto-start services (trigger-start / updaters
// that legitimately idle-stop). Editable from Settings; NULL in the DB means the
// list was never configured → use these defaults. An explicit empty value means
// "monitor everything".
const DEFAULT_IGNORE = [
  'sppsvc',
  'googleupdate', 'googleupdater', 'gupdate',
  'edgeupdate', 'microsoftedgeelevation',
  'mozillamaintenance', 'braveelevation',
  'clr_optimization',
  'remoteregistry', 'scardsvr', 'trustedinstaller',
  'mapsbroker', 'tzautoupdate', 'cbdhsvc', 'cdpsvc', 'wbiosrvc',
];

// null/undefined -> defaults; anything else (incl. '') -> parsed user list.
function parseIgnore(raw) {
  if (raw == null) return DEFAULT_IGNORE;
  return String(raw).split(/[\n,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
}

function isIgnoredService(name, list) {
  const n = String(name || '').toLowerCase();
  return list.some(p => n.startsWith(p));
}

module.exports = { DEFAULT_IGNORE, parseIgnore, isIgnoredService };
