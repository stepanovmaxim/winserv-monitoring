'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { canAutoUpgrade, resolveAgentLatest } = require('../src/lib/updatePolicy');

// The exact os_info strings the fleet reports, including the Russian-locale
// spelling and the mangled encoding the Server 2008 host sends.
const WIN2019_RU = 'Майкрософт Windows Server 2019 Standard';
const WIN2019_EN = 'Microsoft Windows Server 2019 Standard';
const WIN2012R2 = 'Microsoft Windows Server 2012 R2 Standard';
const WIN2008 = 'Microsoft� Windows Server� 2008 Standard';

test('verified releases may upgrade automatically', () => {
  assert.equal(canAutoUpgrade(WIN2019_RU), true);
  assert.equal(canAutoUpgrade(WIN2019_EN), true);
  assert.equal(canAutoUpgrade('Microsoft Windows Server 2022 Datacenter'), true);
  assert.equal(canAutoUpgrade('Microsoft Windows Server 2016 Standard'), true);
});

test('releases that cannot be exercised are held back', () => {
  assert.equal(canAutoUpgrade(WIN2012R2), false);
  assert.equal(canAutoUpgrade(WIN2008), false);
  assert.equal(canAutoUpgrade('Microsoft Windows Server 2003'), false);
});

test('an unidentifiable OS is treated as unverified, never as current', () => {
  assert.equal(canAutoUpgrade(null), false);
  assert.equal(canAutoUpgrade(undefined), false);
  assert.equal(canAutoUpgrade(''), false);
  assert.equal(canAutoUpgrade('   '), false);
});

test('a held host is told the version it already runs, so it fetches nothing', () => {
  assert.equal(
    resolveAgentLatest({ autoUpdate: true, osInfo: WIN2012R2, reported: '2.24', latest: '2.27' }),
    '2.24'
  );
});

test('the incident itself: 2012 R2 on 2.24 must not be handed the 2019-only build', () => {
  const told = resolveAgentLatest({ autoUpdate: true, osInfo: WIN2012R2, reported: '2.24', latest: '2.26' });
  assert.notEqual(told, '2.26');
  assert.equal(told, '2.24');
});

test('verified hosts still upgrade - the gate must not disable auto-update', () => {
  assert.equal(
    resolveAgentLatest({ autoUpdate: true, osInfo: WIN2019_RU, reported: '2.24', latest: '2.27' }),
    '2.27'
  );
});

test('the global pause still overrides everything', () => {
  assert.equal(
    resolveAgentLatest({ autoUpdate: false, osInfo: WIN2019_RU, reported: '2.25', latest: '2.27' }),
    '2.25'
  );
});

test('a held host that reported no version falls back to latest rather than empty', () => {
  assert.equal(
    resolveAgentLatest({ autoUpdate: true, osInfo: WIN2012R2, reported: '', latest: '2.27' }),
    '2.27'
  );
  assert.equal(
    resolveAgentLatest({ autoUpdate: true, osInfo: WIN2012R2, reported: null, latest: '2.27' }),
    '2.27'
  );
});

test('Linux agents are not gated by the Windows release list', () => {
  assert.equal(
    resolveAgentLatest({ autoUpdate: true, osInfo: 'Ubuntu 22.04.4 LTS', reported: '1.2', latest: '1.3', isLinux: true }),
    '1.3'
  );
});
