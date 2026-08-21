'use strict';

// A workgroup machine has no DNS domain. The agent's fallback built its name as
// "<computer>.<domain>", and with an empty domain that produced names like
// "HV2." - which is how a newly added Hyper-V host appeared in the panel.
//
// This matters beyond looks: hostname is the key registration matches on. The
// same machine reporting "HV2." once and "HV2" later would register twice and
// lose its history, so incoming names are normalised on the way in. Done
// server-side as well as in the agent because agents already in the field keep
// sending the dotted form until they update.
function normalizeHostname(h) {
  return String(h === null || h === undefined ? '' : h).trim().replace(/\.+$/, '');
}

module.exports = { normalizeHostname };
