// Safety core for auto-banning: decides whether an IP may ever be blocked.
// The overriding rule is "never ban our own / local networks" — a false positive
// that firewalls off an office, VPN, or admin is far worse than missing a ban.
// Pure and fully unit-tested (test/ipGuard.test.js).

// --- parse an IPv4/IPv6 address to { version, value: BigInt } or null ---
function ipToBig(ip) {
  if (typeof ip !== 'string') return null;
  let s = ip.trim();
  if (!s) return null;
  // Strip a zone id (fe80::1%eth0) and brackets.
  s = s.replace(/^\[|\]$/g, '');
  const pct = s.indexOf('%');
  if (pct !== -1) s = s.slice(0, pct);

  if (s.includes(':')) return ipv6ToBig(s);
  return ipv4ToBig(s);
}

function ipv4ToBig(s) {
  const parts = s.split('.');
  if (parts.length !== 4) return null;
  let v = 0n;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    v = (v << 8n) | BigInt(n);
  }
  return { version: 4, value: v };
}

function ipv6ToBig(s) {
  // Allow an embedded IPv4 tail (e.g. ::ffff:1.2.3.4).
  let tail = 0n, tailGroups = 0;
  const lastColon = s.lastIndexOf(':');
  if (s.slice(lastColon + 1).includes('.')) {
    const v4 = ipv4ToBig(s.slice(lastColon + 1));
    if (!v4) return null;
    tail = v4.value;
    tailGroups = 2;
    s = s.slice(0, lastColon + 1) + '0';
  }

  const dbl = s.split('::');
  if (dbl.length > 2) return null;
  const head = dbl[0] ? dbl[0].split(':') : [];
  const rest = dbl.length === 2 ? (dbl[1] ? dbl[1].split(':') : []) : null;

  const toGroups = (arr) => {
    const out = [];
    for (const g of arr) {
      if (g === '') return null;
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(BigInt(parseInt(g, 16)));
    }
    return out;
  };

  const headG = toGroups(head);
  if (headG === null) return null;
  let groups;
  if (rest === null) {
    // No '::' — must be exactly 8 groups (accounting for an embedded v4).
    groups = headG;
    if (groups.length + tailGroups !== 8) return null;
  } else {
    const restG = toGroups(rest);
    if (restG === null) return null;
    const missing = 8 - tailGroups - headG.length - restG.length;
    if (missing < 0) return null;
    groups = [...headG, ...Array(missing).fill(0n), ...restG];
  }

  let v = 0n;
  for (const g of groups) v = (v << 16n) | g;
  if (tailGroups) v = (v << 32n) | tail;
  return { version: 6, value: v };
}

// --- CIDR membership ---
function inCidr(ip, cidr) {
  const slash = cidr.indexOf('/');
  if (slash === -1) {
    const a = ipToBig(ip), b = ipToBig(cidr);
    return !!(a && b && a.version === b.version && a.value === b.value);
  }
  const base = ipToBig(cidr.slice(0, slash));
  const bits = Number(cidr.slice(slash + 1));
  const a = ipToBig(ip);
  if (!base || !a || a.version !== base.version) return false;
  const width = base.version === 4 ? 32 : 128;
  if (!Number.isInteger(bits) || bits < 0 || bits > width) return false;
  if (bits === 0) return true;
  const shift = BigInt(width - bits);
  return (a.value >> shift) === (base.value >> shift);
}

// Networks that must never be firewalled off by an automatic (or accidental
// manual) ban: private, loopback, link-local, CGNAT, multicast, reserved.
const NEVER_BAN = [
  '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16',
  '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10',
  '0.0.0.0/8', '192.0.0.0/24', '198.18.0.0/15', '224.0.0.0/4', '240.0.0.0/4',
  '255.255.255.255/32',
  '::1/128', '::/128', 'fe80::/10', 'fc00::/7', 'ff00::/8',
];

function isPrivateOrReserved(ip) {
  if (!ipToBig(ip)) return false; // not a valid IP — caller treats as unbannable
  return NEVER_BAN.some(c => inCidr(ip, c));
}

function parseAllowlist(raw) {
  if (!raw) return [];
  return String(raw)
    .split(/[\n,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

function inAllowlist(ip, allowlistCidrs) {
  return allowlistCidrs.some(c => {
    try { return inCidr(ip, c); } catch { return false; }
  });
}

// The single gate the ban path calls. Bannable only if it is a valid, public,
// non-reserved IP that is not on the operator's allowlist.
function isBannable(ip, allowlistCidrs = []) {
  if (!ipToBig(ip)) return false;
  if (isPrivateOrReserved(ip)) return false;
  if (inAllowlist(ip, allowlistCidrs)) return false;
  return true;
}

module.exports = { ipToBig, inCidr, isPrivateOrReserved, isBannable, parseAllowlist, inAllowlist, NEVER_BAN };
