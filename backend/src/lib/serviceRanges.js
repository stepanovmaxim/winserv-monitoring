'use strict';

const { inCidr, ipToBig } = require('./ipGuard');

// Address ranges belonging to cloud services our own servers talk to.
//
// Two reasons this matters, one cosmetic and one serious:
//
//  * Labelling. Repeated failed logons from Exchange Online are a mailbox
//    client somewhere with a stale saved password, not an attack on us. They
//    arrive as 4625 type 8 (OWA/ActiveSync/SMTP basic auth) from Microsoft's
//    own address space, and calling that "brute-force" trains people to ignore
//    the alert that matters.
//
//  * Safety. Auto-ban is enabled on this deployment. A rule like "this IP hit
//    two or more servers" is easy to trip when a customer runs two Exchange
//    boxes, and banning Microsoft's ranges would cut mail flow. These ranges
//    are therefore never bannable, exactly like private and reserved space.
//
// Microsoft publishes these and they do change. This is the well-known core of
// the Exchange Online / Microsoft 365 list, not an exhaustive snapshot - an
// operator can add anything else through the auto-ban allowlist, which is
// honoured on the same path.
const SERVICE_RANGES = [
  // Exchange Online / Microsoft 365 client access and mail flow (IPv4)
  { cidr: '13.107.6.152/31', label: 'Microsoft 365' },
  { cidr: '13.107.9.152/31', label: 'Microsoft 365' },
  { cidr: '13.107.18.10/31', label: 'Microsoft 365' },
  { cidr: '13.107.19.10/31', label: 'Microsoft 365' },
  { cidr: '13.107.128.0/22', label: 'Microsoft 365' },
  { cidr: '13.107.140.6/32', label: 'Microsoft 365' },
  { cidr: '23.103.160.0/20', label: 'Exchange Online' },
  { cidr: '40.92.0.0/15', label: 'Exchange Online' },
  { cidr: '40.96.0.0/13', label: 'Exchange Online' },
  { cidr: '40.104.0.0/15', label: 'Exchange Online' },
  { cidr: '40.107.0.0/16', label: 'Exchange Online' },
  { cidr: '52.96.0.0/14', label: 'Exchange Online' },
  { cidr: '52.100.0.0/14', label: 'Exchange Online' },
  { cidr: '52.238.78.88/32', label: 'Exchange Online' },
  { cidr: '104.47.0.0/17', label: 'Exchange Online' },
  { cidr: '131.253.33.215/32', label: 'Microsoft 365' },
  { cidr: '132.245.0.0/16', label: 'Exchange Online' },
  { cidr: '150.171.32.0/22', label: 'Microsoft 365' },
  { cidr: '204.79.197.215/32', label: 'Microsoft 365' },
  // Exchange Online (IPv6)
  { cidr: '2603:1006::/40', label: 'Exchange Online' },
  { cidr: '2603:1016::/36', label: 'Exchange Online' },
  { cidr: '2603:1026::/36', label: 'Exchange Online' },
  { cidr: '2603:1036::/36', label: 'Exchange Online' },
  { cidr: '2603:1046::/36', label: 'Exchange Online' },
  { cidr: '2603:1056::/36', label: 'Exchange Online' },
  { cidr: '2620:1ec:8f0::/46', label: 'Microsoft 365' },
  { cidr: '2620:1ec:900::/46', label: 'Microsoft 365' },
  { cidr: '2a01:111:f400::/48', label: 'Exchange Online' },
  { cidr: '2a01:111:f403::/48', label: 'Exchange Online' },
];

// Returns the service label for an address, or null. Never throws: an
// unparseable address is simply not a known service.
function serviceOwner(ip) {
  if (!ip || !ipToBig(ip)) return null;
  for (const r of SERVICE_RANGES) {
    try {
      if (inCidr(ip, r.cidr)) return r.label;
    } catch { /* a malformed entry must not break the check */ }
  }
  return null;
}

module.exports = { serviceOwner, SERVICE_RANGES };
