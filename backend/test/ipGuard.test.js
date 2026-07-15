const { test } = require('node:test');
const assert = require('node:assert');
const { ipToBig, inCidr, isPrivateOrReserved, isBannable, parseAllowlist } = require('../src/lib/ipGuard');

test('ipToBig parses IPv4 and rejects garbage', () => {
  assert.strictEqual(ipToBig('192.168.1.1').value, (192n << 24n) | (168n << 16n) | (1n << 8n) | 1n);
  assert.strictEqual(ipToBig('256.0.0.1'), null);
  assert.strictEqual(ipToBig('1.2.3'), null);
  assert.strictEqual(ipToBig('hello'), null);
  assert.strictEqual(ipToBig(''), null);
  assert.strictEqual(ipToBig(undefined), null);
});

test('ipToBig parses IPv6 incl. :: compression and v4-mapped', () => {
  assert.ok(ipToBig('::1'));
  assert.ok(ipToBig('fe80::1'));
  assert.ok(ipToBig('2a00:1450:4001:81b::200e'));
  assert.strictEqual(ipToBig('::ffff:192.168.0.1').version, 6);
  assert.strictEqual(ipToBig('fig::z'), null);
});

test('inCidr matches IPv4 ranges correctly', () => {
  assert.strictEqual(inCidr('10.1.2.3', '10.0.0.0/8'), true);
  assert.strictEqual(inCidr('11.0.0.1', '10.0.0.0/8'), false);
  assert.strictEqual(inCidr('172.16.5.5', '172.16.0.0/12'), true);
  assert.strictEqual(inCidr('172.32.0.1', '172.16.0.0/12'), false); // just outside /12
  assert.strictEqual(inCidr('192.168.9.9', '192.168.0.0/16'), true);
  assert.strictEqual(inCidr('8.8.8.8', '8.8.8.8/32'), true);
  assert.strictEqual(inCidr('8.8.8.9', '8.8.8.8/32'), false);
});

test('inCidr matches IPv6 ranges and never cross-matches versions', () => {
  assert.strictEqual(inCidr('fe80::abcd', 'fe80::/10'), true);
  assert.strictEqual(inCidr('2a00::1', 'fe80::/10'), false);
  assert.strictEqual(inCidr('fd00::1', 'fc00::/7'), true);
  assert.strictEqual(inCidr('10.0.0.1', '::/0'), false);     // v4 addr vs v6 cidr
  assert.strictEqual(inCidr('::1', '10.0.0.0/8'), false);    // v6 addr vs v4 cidr
});

test('isPrivateOrReserved covers every RFC1918 + reserved range', () => {
  for (const ip of ['10.255.255.255', '172.16.0.1', '172.31.255.255', '192.168.1.1',
                    '127.0.0.1', '169.254.1.1', '100.64.0.1', '224.0.0.1', '0.0.0.0',
                    '::1', 'fe80::1', 'fd12:3456::1']) {
    assert.strictEqual(isPrivateOrReserved(ip), true, `${ip} must be reserved`);
  }
});

test('isPrivateOrReserved is false for real public IPs', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '45.148.10.147', '203.0.113.5', '2a00:1450:4001::200e']) {
    assert.strictEqual(isPrivateOrReserved(ip), false, `${ip} must be public`);
  }
});

test('SAFETY: private and local IPs are never bannable', () => {
  for (const ip of ['192.168.0.10', '10.0.0.5', '172.20.1.1', '127.0.0.1', '169.254.0.1', '::1', 'fe80::5']) {
    assert.strictEqual(isBannable(ip), false, `${ip} must NOT be bannable`);
  }
});

test('SAFETY: allowlisted public IPs/ranges are never bannable', () => {
  const allow = parseAllowlist('45.10.20.0/24, 203.0.113.7, 2a00:1450::/32');
  assert.strictEqual(isBannable('45.10.20.99', allow), false); // office range
  assert.strictEqual(isBannable('203.0.113.7', allow), false); // single admin IP
  assert.strictEqual(isBannable('2a00:1450:4001::1', allow), false);
  assert.strictEqual(isBannable('45.10.21.1', allow), true);   // just outside the /24 → bannable
});

test('a hostile public IP is bannable', () => {
  assert.strictEqual(isBannable('45.148.10.147'), true);
  assert.strictEqual(isBannable('125.209.88.139', parseAllowlist('8.8.8.0/24')), true);
});

test('invalid / empty input is never bannable (fail closed)', () => {
  assert.strictEqual(isBannable('-'), false);
  assert.strictEqual(isBannable(''), false);
  assert.strictEqual(isBannable('not-an-ip'), false);
});

test('parseAllowlist splits on commas/whitespace/newlines', () => {
  assert.deepStrictEqual(parseAllowlist('1.2.3.0/24\n5.6.7.8, 9.9.9.9'), ['1.2.3.0/24', '5.6.7.8', '9.9.9.9']);
  assert.deepStrictEqual(parseAllowlist(''), []);
  assert.deepStrictEqual(parseAllowlist(null), []);
});
