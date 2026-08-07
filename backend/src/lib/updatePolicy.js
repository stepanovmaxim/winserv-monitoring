'use strict';

// Which hosts may take a new agent build automatically.
//
// Auto-update is not the hazard; shipping an unverified build to the whole
// fleet at once is. A build exercised only on Server 2019 silenced four Server
// 2012 R2 machines that had held 100% coverage for a week, and a silenced host
// cannot self-heal: it stops polling, so the fix can no longer reach it. The
// only recovery is an SMB push from the deployer, one machine at a time.
//
// So upgrades roll automatically on the releases the build can actually be
// exercised against, and every other host holds the version it is already
// running until an operator pushes deliberately and watches the result. This is
// fail-closed on purpose: an OS we cannot identify is treated as unverified,
// because guessing wrong takes a host off the network entirely.
const VERIFIED_WINDOWS = /(2016|2019|2022|2025|Windows\s*1[01])/i;

function canAutoUpgrade(osInfo) {
  if (osInfo === null || osInfo === undefined) return false;
  const s = String(osInfo).trim();
  if (!s) return false;
  return VERIFIED_WINDOWS.test(s);
}

// Returns the version the agent should be told to run. Holding means echoing
// the agent its own version, so it finds nothing to fetch and keeps reporting
// on its normal cadence rather than downloading inside its scheduled task.
function resolveAgentLatest({ autoUpdate, osInfo, reported, latest, isLinux = false }) {
  const running = String(reported || '').trim();
  const hold = running || latest;
  if (!autoUpdate) return hold;
  if (isLinux) return latest;
  if (!canAutoUpgrade(osInfo)) return hold;
  return latest;
}

module.exports = { canAutoUpgrade, resolveAgentLatest };
