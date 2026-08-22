'use strict';

// Which server record an incoming report belongs to.
//
// Host identity used to BE the hostname string, and that string is both editable
// in the panel and rewritable by the agent. Three separate outages came from it
// in one day: a host matched to a different customer's record because they
// shared a private IP, a machine duplicated itself when its reported name
// changed case, and a record was orphaned when an operator renamed it. The
// hostname is an attribute; it should never have been the key.
//
// Order of authority:
//   1. token   - a per-machine credential, the strongest signal
//   2. agent_uid - the machine's Windows MachineGuid: survives a rename, an
//      agent reinstall and a lost config, and is what makes the other two
//      failure modes impossible
//   3. hostname - only for agents that have not yet reported a uid
//
// Strictly additive: a report with no uid resolves exactly as it did before, so
// the fleet keeps working while it backfills.
function chooseIdentity({ tokenServer, uidServer, hostServer, hostname, uid }) {
  const name = String(hostname === null || hostname === undefined ? '' : hostname).trim();
  const id = String(uid === null || uid === undefined ? '' : uid).trim();

  if (tokenServer) {
    return {
      serverId: tokenServer.id,
      matchedBy: 'token',
      // Backfill on the first report from an agent that now sends one.
      setUid: id && !tokenServer.agent_uid ? id : null,
      renamedFrom: null,
    };
  }

  if (id && uidServer) {
    // Same machine, whatever it calls itself now. A changed name is just an
    // attribute update - no new record, no lost history.
    const changed = name && uidServer.hostname && uidServer.hostname.toLowerCase() !== name.toLowerCase();
    return {
      serverId: uidServer.id,
      matchedBy: 'uid',
      setUid: null,
      renamedFrom: changed ? uidServer.hostname : null,
    };
  }

  if (hostServer) {
    return {
      serverId: hostServer.id,
      matchedBy: 'hostname',
      setUid: id && !hostServer.agent_uid ? id : null,
      renamedFrom: null,
    };
  }

  return { serverId: null, matchedBy: 'new', setUid: id || null, renamedFrom: null };
}

module.exports = { chooseIdentity };
