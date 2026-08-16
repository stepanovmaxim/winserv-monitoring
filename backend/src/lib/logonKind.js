'use strict';

// Windows Security-log 4625 LogonType -> the service the failed logon was
// actually against, so a brute-force alert names the real vector instead of
// always claiming "RDP". Exchange is the case that exposed this: OWA/ActiveSync/
// SMTP basic auth logs type 8, MAPI/EWS/SMB logs type 3 - never type 10 (RDP).
// Types per Microsoft's logon-type table.
function logonKind(logonType, platform) {
  if (platform === 'linux') return 'SSH';
  const t = String(logonType === null || logonType === undefined ? '' : logonType).trim();
  switch (t) {
    case '10': return 'RDP';            // RemoteInteractive (Terminal Services / RDP)
    case '8':  return 'OWA/basic-auth'; // NetworkCleartext: OWA, ActiveSync, SMTP AUTH, IIS basic
    case '3':  return 'network';        // Network: SMB, Exchange MAPI/EWS, service auth
    case '2':  return 'console';        // Interactive (local console)
    case '7':  return 'unlock';         // Unlock (usually an RDP or console session)
    case '11': return 'cached';         // CachedInteractive
    default:   return 'logon';          // unknown / other
  }
}

module.exports = { logonKind };
