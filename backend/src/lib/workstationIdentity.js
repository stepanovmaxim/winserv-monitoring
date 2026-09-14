'use strict';

// Which workstation record an incoming report belongs to, and whether it looks
// like a clone.
//
// Identity is the Windows MachineGuid (uid), for the reasons servers learned the
// hard way: a hostname is renamed and re-imaged far too freely to be a key. But
// desktops add a twist servers rarely have - they are mass-deployed from one
// image, and an image captured without sysprep carries its MachineGuid onto
// every machine cloned from it. So the uid alone is not enough to tell "the same
// PC, renamed" from "a different PC off the same image".
//
// The BIOS serial breaks the tie: it is per-physical-machine and a clone keeps
// its own. So:
//   - uid matches, serial matches (or either side is blank)  -> same machine,
//     a hostname change is just a rename
//   - uid matches but the serials plainly differ             -> a clone; give it
//     its own record and point clone_of at the machine it was imaged from
//   - no uid match -> fall back to hostname, else it is new
//
// Pure and unit-tested. `existingByUid` is the row already holding this uid (or
// null); `existingByHost` is a row with this hostname when there is no uid match.
function resolveWorkstation({ existingByUid, existingByHost, hostname, uid, serial }) {
  const name = norm(hostname);
  const id = norm(uid);
  const sn = norm(serial);

  if (id && existingByUid) {
    const existingSn = norm(existingByUid.serial);
    const serialsDiffer = sn && existingSn && sn.toLowerCase() !== existingSn.toLowerCase();
    if (serialsDiffer) {
      // Same image, different hardware: a clone. New record, remember its origin.
      return { workstationId: null, action: 'clone', cloneOf: existingByUid.id, renamedFrom: null };
    }
    const renamed = name && existingByUid.hostname && existingByUid.hostname.toLowerCase() !== name.toLowerCase();
    return { workstationId: existingByUid.id, action: 'update', cloneOf: null, renamedFrom: renamed ? existingByUid.hostname : null };
  }

  if (existingByHost) {
    // Known only by name (an older report with no uid, now adopting one).
    return { workstationId: existingByHost.id, action: 'update', cloneOf: null, renamedFrom: null };
  }

  return { workstationId: null, action: 'create', cloneOf: null, renamedFrom: null };
}

function norm(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

module.exports = { resolveWorkstation };
