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
// The BIOS serial breaks the tie - it is per-physical-machine - so the true key
// is the PAIR (uid, serial). The caller passes two lookups:
//   - exactByUidSerial: a row whose uid AND serial both match this report
//   - anyByUid:         any row already holding this uid (same or different serial)
//
// Resolution:
//   - exact (uid+serial) match      -> same machine; a hostname change is a rename
//   - uid matches, serial differs    -> a clone off the same image; its own record,
//                                        clone_of points at the machine it came from
//   - no uid match                   -> fall back to hostname, else new
//
// Keying on the pair (not the uid alone) is also what stops a clone multiplying:
// on its next report it matches itself exactly and updates, rather than being
// seen as "a different serial" again and again.
//
// Pure and unit-tested.
function resolveWorkstation({ exactByUidSerial, anyByUid, existingByHost, hostname, uid, serial }) {
  const name = norm(hostname);
  const id = norm(uid);
  const sn = norm(serial);

  if (id && exactByUidSerial) {
    const renamed = name && exactByUidSerial.hostname && exactByUidSerial.hostname.toLowerCase() !== name.toLowerCase();
    return { workstationId: exactByUidSerial.id, action: 'update', cloneOf: null, renamedFrom: renamed ? exactByUidSerial.hostname : null };
  }

  // A uid we have seen, but not with this serial. Only a clone when both serials
  // are actually known - a blank on either side means we cannot tell them apart,
  // so treat it as the same machine and update the row we have.
  if (id && anyByUid) {
    const existingSn = norm(anyByUid.serial);
    if (sn && existingSn) {
      return { workstationId: null, action: 'clone', cloneOf: anyByUid.clone_of || anyByUid.id, renamedFrom: null };
    }
    const renamed = name && anyByUid.hostname && anyByUid.hostname.toLowerCase() !== name.toLowerCase();
    return { workstationId: anyByUid.id, action: 'update', cloneOf: null, renamedFrom: renamed ? anyByUid.hostname : null };
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
