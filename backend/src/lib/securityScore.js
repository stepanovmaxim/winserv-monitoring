// Turns the agent's hardening facts into a score plus a list of what to fix.
// Pure and unit-tested (test/securityScore.test.js).
//
// Weights reflect what actually gets exploited in this kind of estate rather
// than a generic benchmark: SMBv1 and an off firewall are how things spread,
// RDP without NLA is how brute-force gets a foothold, and unknown facts never
// cost points — an old SKU that cannot report a setting must not look insecure.

const CHECKS = [
  {
    key: 'smb1', weight: 25, severity: 'critical',
    title: 'SMBv1 enabled',
    hint: 'Disable SMBv1 — it is how worms move laterally. Remove the feature or Set-SmbServerConfiguration -EnableSMB1Protocol $false.',
    fails: (a) => a.smb1_enabled === true,
  },
  {
    key: 'firewall', weight: 20, severity: 'critical',
    title: 'Firewall profile disabled',
    hint: 'Turn the firewall back on for every profile.',
    fails: (a) => typeof a.firewall_off === 'string' && a.firewall_off.length > 0,
    detail: (a) => `off: ${a.firewall_off}`,
  },
  {
    key: 'rdp_nla', weight: 20, severity: 'critical',
    title: 'RDP without Network Level Authentication',
    hint: 'Enable NLA so an unauthenticated client cannot reach the logon screen.',
    fails: (a) => a.rdp_enabled === true && a.rdp_nla === false,
  },
  {
    key: 'guest', weight: 15, severity: 'warning',
    title: 'Guest account enabled',
    hint: 'Disable the Guest account.',
    fails: (a) => a.guest_enabled === true,
  },
  {
    key: 'lsass', weight: 10, severity: 'warning',
    title: 'LSASS not running protected',
    hint: 'Set RunAsPPL=1 to stop credential dumping from LSASS memory.',
    fails: (a) => a.lsass_protected === false,
  },
  {
    key: 'admins', weight: 10, severity: 'warning',
    title: 'Many local administrators',
    hint: 'Review who holds local admin; every extra account is another way in.',
    fails: (a) => Number.isFinite(a.local_admins) && a.local_admins > 5,
    detail: (a) => `${a.local_admins} members`,
  },
];

function scoreServer(auditRaw) {
  const a = auditRaw && typeof auditRaw === 'object' ? auditRaw : null;
  if (!a || Object.keys(a).length === 0) return { score: null, findings: [], known: 0 };

  const findings = [];
  let lost = 0;
  let known = 0;

  for (const c of CHECKS) {
    let failed;
    try { failed = c.fails(a); } catch { failed = false; }
    // A check whose inputs are missing is "unknown", not a failure.
    if (failed === true) {
      known++;
      lost += c.weight;
      findings.push({
        key: c.key, title: c.title, hint: c.hint, severity: c.severity, weight: c.weight,
        detail: c.detail ? c.detail(a) : '',
      });
    } else if (failed === false) {
      known++;
    }
  }

  return { score: Math.max(0, 100 - lost), findings, known };
}

module.exports = { scoreServer, CHECKS };
