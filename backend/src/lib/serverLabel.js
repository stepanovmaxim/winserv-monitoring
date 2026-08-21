'use strict';

// What a server is CALLED, as opposed to what identifies it.
//
// hostname is the identity: it is what the agent reports and what registration
// matches on, so changing it re-points or duplicates the record. Renaming a
// server in the panel used to overwrite exactly that field, which is how
// "AVTOSTEK HOST" ended up as the stored identity of a machine that actually
// reports WIN-VAE9FF8KAQK - and why its record was orphaned the moment
// registration started taking the reported name seriously.
//
// display_name is free text for humans. It is what alerts and the panel show,
// and nothing matches on it, so it can be changed at will.
function serverLabel(server) {
  if (!server) return '';
  const d = server.display_name;
  if (d !== null && d !== undefined && String(d).trim() !== '') return String(d).trim();
  return String(server.hostname === null || server.hostname === undefined ? '' : server.hostname);
}

module.exports = { serverLabel };
