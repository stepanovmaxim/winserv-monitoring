'use strict';

// Which hosts may take a new agent build automatically.
//
// Auto-update is not the hazard; handing an unproven build to the whole fleet at
// once is. A build exercised only on Server 2019 silenced four Server 2012 R2
// machines that had held 100% coverage for a week, and a silenced host cannot
// self-heal: it stops polling, so the fix can no longer reach it. Recovery was
// an SMB push per machine.
//
// The first attempt at a guard was a list of "verified" Windows releases. That
// was the wrong shape - it never let the held hosts move again, so they sat on
// an old build indefinitely and stopped receiving fixes at all.
//
// Instead a build proves itself per OS family before it spreads. Exactly one
// host of a family takes it first; the rest of that family follow only once a
// host of theirs is actually reporting on it. Applied to the incident, that
// would have cost one 2012 R2 machine instead of four, and every family still
// converges on its own. If a canary dies the family stays put, which is the
// intended outcome - and deliberate upgrades over the deployer are unaffected.

// Family is the release, not the edition: 2012 and 2012 R2 share a PowerShell
// and .NET generation, which is what actually decides whether a build runs.
function osFamily(osInfo) {
  const s = String(osInfo === null || osInfo === undefined ? '' : osInfo);
  const m = s.match(/\b(2003|2008|2012|2016|2019|2022|2025)\b/);
  if (m) return m[1];
  if (/Windows\s*1[01]\b/i.test(s)) return 'client';
  return 'unknown';
}

// hosts: [{ id, os_info, agent_version, last_seen }] for the whole fleet.
// A family is proven when one of its members is running `latest` AND has
// reported recently - installing the build is not evidence that it works, only
// reporting afterwards is.
function familyProven({ hosts, family, latest, selfId, now = Date.now(), freshMs = 10 * 60 * 1000 }) {
  return (hosts || []).some(h => {
    if (!h || h.id === selfId) return false;
    if (String(h.agent_version || '') !== String(latest)) return false;
    if (osFamily(h.os_info) !== family) return false;
    const seen = h.last_seen ? new Date(h.last_seen).getTime() : 0;
    return seen > 0 && (now - seen) <= freshMs;
  });
}

// The canary is deterministic - the lowest id in the family - so concurrent
// requests cannot each decide they are the one.
function canaryId({ hosts, family }) {
  const ids = (hosts || [])
    .filter(h => h && osFamily(h.os_info) === family)
    .map(h => h.id)
    .filter(id => id !== null && id !== undefined);
  if (!ids.length) return null;
  return ids.reduce((a, b) => (b < a ? b : a));
}

// Returns the version the agent should be told to run. Holding means echoing
// the agent its own version, so it finds nothing to fetch and keeps reporting on
// its normal cadence instead of downloading inside its scheduled task.
function resolveAgentLatest({ autoUpdate, osInfo, reported, latest, isLinux = false, hosts = [], selfId = null, now = Date.now() }) {
  const running = String(reported || '').trim();
  const hold = running || latest;
  if (!autoUpdate) return hold;
  if (isLinux) return latest;

  const family = osFamily(osInfo);
  // Fail closed on an OS we cannot place: guessing wrong takes a host off the
  // network entirely, and a deployer push is always available.
  if (family === 'unknown') return hold;

  if (familyProven({ hosts, family, latest, selfId, now })) return latest;
  if (selfId !== null && canaryId({ hosts, family }) === selfId) return latest;
  return hold;
}

module.exports = { osFamily, familyProven, canaryId, resolveAgentLatest };
