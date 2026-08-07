const { test } = require('node:test');
const assert = require('node:assert');
const { scoreServer } = require('../src/lib/securityScore');

test('a hardened host scores 100 with no findings', () => {
  const r = scoreServer({
    smb1_enabled: false, firewall_off: '', rdp_enabled: true, rdp_nla: true,
    guest_enabled: false, lsass_protected: true, local_admins: 2,
  });
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.findings.length, 0);
});

test('SAFETY: facts the agent could not read never cost points', () => {
  // An older SKU that cannot report a setting must not look insecure.
  const r = scoreServer({ rdp_enabled: true, rdp_nla: true });
  assert.strictEqual(r.score, 100);
  assert.strictEqual(r.findings.length, 0);
});

test('no audit at all yields null rather than zero', () => {
  assert.strictEqual(scoreServer(null).score, null);
  assert.strictEqual(scoreServer({}).score, null);
});

test('SMBv1 and a disabled firewall are the heaviest hits', () => {
  const r = scoreServer({ smb1_enabled: true, firewall_off: 'Public' });
  assert.strictEqual(r.score, 100 - 25 - 20);
  assert.deepStrictEqual(r.findings.map(f => f.key).sort(), ['firewall', 'smb1']);
  assert.ok(r.findings.find(f => f.key === 'firewall').detail.includes('Public'));
});

test('RDP without NLA only counts when RDP is actually enabled', () => {
  assert.strictEqual(scoreServer({ rdp_enabled: false, rdp_nla: false }).score, 100);
  assert.strictEqual(scoreServer({ rdp_enabled: true, rdp_nla: false }).score, 80);
});

test('local admin count only trips above the threshold', () => {
  assert.strictEqual(scoreServer({ local_admins: 5 }).score, 100);
  assert.strictEqual(scoreServer({ local_admins: 9 }).score, 90);
  assert.ok(scoreServer({ local_admins: 9 }).findings[0].detail.includes('9'));
});

test('a thoroughly neglected host bottoms out at 0, never negative', () => {
  const r = scoreServer({
    smb1_enabled: true, firewall_off: 'Domain,Private,Public', rdp_enabled: true, rdp_nla: false,
    guest_enabled: true, lsass_protected: false, local_admins: 20,
  });
  assert.strictEqual(r.score, 0);
  assert.strictEqual(r.findings.length, 6);
});

test('every finding carries an actionable hint', () => {
  const r = scoreServer({ smb1_enabled: true, guest_enabled: true });
  assert.ok(r.findings.every(f => f.hint && f.hint.length > 10));
});
