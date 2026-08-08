'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { osFamily, familyProven, canaryId, resolveAgentLatest } = require('../src/lib/updatePolicy');

// The exact os_info strings the fleet reports, including the Russian-locale
// spelling and the mangled encoding the Server 2008 host sends.
const W2019_RU = 'Майкрософт Windows Server 2019 Standard';
const W2019_EN = 'Microsoft Windows Server 2019 Standard';
const W2012R2 = 'Microsoft Windows Server 2012 R2 Standard';
const W2008 = 'Microsoft� Windows Server� 2008 Standard';
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
const fresh = new Date(NOW - 30 * 1000).toISOString();
const stale = new Date(NOW - 45 * 60 * 1000).toISOString();

test('family is the release, across locales and mangled encodings', () => {
  assert.equal(osFamily(W2019_RU), '2019');
  assert.equal(osFamily(W2019_EN), '2019');
  assert.equal(osFamily(W2012R2), '2012');
  assert.equal(osFamily(W2008), '2008');
  assert.equal(osFamily('Microsoft Windows Server 2003 R2'), '2003');
  assert.equal(osFamily('Windows 11 Pro'), 'client');
  assert.equal(osFamily(''), 'unknown');
  assert.equal(osFamily(null), 'unknown');
});

test('the canary is deterministic, so concurrent polls cannot both elect themselves', () => {
  const hosts = [
    { id: 7, os_info: W2012R2 }, { id: 3, os_info: W2012R2 },
    { id: 5, os_info: W2019_RU }, { id: 9, os_info: W2012R2 },
  ];
  assert.equal(canaryId({ hosts, family: '2012' }), 3);
  assert.equal(canaryId({ hosts, family: '2019' }), 5);
  assert.equal(canaryId({ hosts, family: '2008' }), null);
});

test('a family is proven only by a host REPORTING on the build, not by having it', () => {
  const base = { hosts: [{ id: 2, os_info: W2012R2, agent_version: '2.31', last_seen: fresh }], family: '2012', latest: '2.31', selfId: 1, now: NOW };
  assert.equal(familyProven(base), true);
  // installed but gone quiet - exactly the failure this guard exists for
  const quiet = { ...base, hosts: [{ id: 2, os_info: W2012R2, agent_version: '2.31', last_seen: stale }] };
  assert.equal(familyProven(quiet), false);
  // a host cannot prove itself
  const alone = { ...base, hosts: [{ id: 1, os_info: W2012R2, agent_version: '2.31', last_seen: fresh }] };
  assert.equal(familyProven(alone), false);
  // another family's success proves nothing
  const other = { ...base, hosts: [{ id: 2, os_info: W2019_RU, agent_version: '2.31', last_seen: fresh }] };
  assert.equal(familyProven(other), false);
});

test('the incident: only ONE 2012 R2 host takes an unproven build', () => {
  const hosts = [
    { id: 11, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
    { id: 12, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
    { id: 13, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
    { id: 14, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
  ];
  const told = hosts.map(h => resolveAgentLatest({
    autoUpdate: true, osInfo: h.os_info, reported: h.agent_version,
    latest: '2.31', hosts, selfId: h.id, now: NOW,
  }));
  assert.deepEqual(told, ['2.31', '2.30', '2.30', '2.30']);
});

test('once the canary reports on the build, the rest of its family follows', () => {
  const hosts = [
    { id: 11, os_info: W2012R2, agent_version: '2.31', last_seen: fresh },
    { id: 12, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
    { id: 13, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
  ];
  for (const id of [12, 13]) {
    assert.equal(resolveAgentLatest({
      autoUpdate: true, osInfo: W2012R2, reported: '2.30',
      latest: '2.31', hosts, selfId: id, now: NOW,
    }), '2.31');
  }
});

test('a canary that goes silent stops its family, and does not stop others', () => {
  const hosts = [
    { id: 11, os_info: W2012R2, agent_version: '2.31', last_seen: stale },
    { id: 12, os_info: W2012R2, agent_version: '2.30', last_seen: fresh },
    { id: 20, os_info: W2019_RU, agent_version: '2.31', last_seen: fresh },
    { id: 21, os_info: W2019_RU, agent_version: '2.30', last_seen: fresh },
  ];
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: W2012R2, reported: '2.30', latest: '2.31', hosts, selfId: 12, now: NOW }), '2.30');
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: W2019_RU, reported: '2.30', latest: '2.31', hosts, selfId: 21, now: NOW }), '2.31');
});

test('a lone host of its family is its own canary - it must not be stranded', () => {
  const hosts = [
    { id: 30, os_info: W2008, agent_version: '2.30', last_seen: fresh },
    { id: 31, os_info: W2019_RU, agent_version: '2.31', last_seen: fresh },
  ];
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: W2008, reported: '2.30', latest: '2.31', hosts, selfId: 30, now: NOW }), '2.31');
});

test('an unidentifiable OS is held, never guessed as current', () => {
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: '', reported: '2.30', latest: '2.31', hosts: [], selfId: 1, now: NOW }), '2.30');
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: null, reported: '2.30', latest: '2.31', hosts: [], selfId: 1, now: NOW }), '2.30');
});

test('the global pause still overrides everything', () => {
  const hosts = [{ id: 1, os_info: W2019_RU, agent_version: '2.31', last_seen: fresh }, { id: 2, os_info: W2019_RU, agent_version: '2.30', last_seen: fresh }];
  assert.equal(resolveAgentLatest({ autoUpdate: false, osInfo: W2019_RU, reported: '2.30', latest: '2.31', hosts, selfId: 2, now: NOW }), '2.30');
});

test('a held host that reported no version falls back to latest rather than empty', () => {
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: '', reported: '', latest: '2.31', hosts: [], selfId: 1, now: NOW }), '2.31');
});

test('Linux agents are not gated by the Windows family logic', () => {
  assert.equal(resolveAgentLatest({ autoUpdate: true, osInfo: 'Ubuntu 22.04.4 LTS', reported: '1.2', latest: '1.3', isLinux: true, hosts: [], selfId: 1, now: NOW }), '1.3');
});
