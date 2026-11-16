'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { versionAtLeast, normalizeUpdate, inScope, buildJob, commandParam, summarizeResult, resultText, jobTimedOut } = require('../src/lib/winUpdates');

const ID = 'cbb79ee1-8b96-41c3-8690-2c7dfca8235a';
const raw = { id: ID.toUpperCase(), title: '2026-11 Cumulative Update (KB5068787)', kb: 'kb5068787', severity: 'Critical',
  categories: 'Security Updates', size_mb: 712.44, downloaded: false, security: true, preview: false, upgrade: false };

test('version comparison is numeric, not textual', () => {
  assert.strictEqual(versionAtLeast('2.56', '2.56'), true);
  assert.strictEqual(versionAtLeast('2.100', '2.56'), true);
  assert.strictEqual(versionAtLeast('2.6', '2.56'), false);
  assert.strictEqual(versionAtLeast('2.55', '2.56'), false);
  assert.strictEqual(versionAtLeast('', '2.56'), false);
});

test('normalizes an update and rejects junk', () => {
  const u = normalizeUpdate(raw);
  assert.strictEqual(u.id, ID);
  assert.strictEqual(u.kb, 'KB5068787');
  assert.strictEqual(u.size_mb, 712.4);
  assert.strictEqual(normalizeUpdate({ ...raw, id: 'x; DROP' }), null);
  assert.strictEqual(normalizeUpdate({ ...raw, title: '' }), null);
  assert.strictEqual(normalizeUpdate(null), null);
  assert.strictEqual(normalizeUpdate({ ...raw, kb: 'see article' }).kb, '');
});

test('bulk scopes never include previews or feature upgrades', () => {
  const sec = normalizeUpdate(raw);
  const plain = { ...sec, id: 'a1b2c3d4', security: false };
  const preview = { ...sec, id: 'b1b2c3d4', preview: true };
  const upgrade = { ...sec, id: 'c1b2c3d4', upgrade: true };
  assert.deepStrictEqual([sec, plain, preview, upgrade].map(u => inScope(u, 'security')), [true, false, false, false]);
  assert.deepStrictEqual([sec, plain, preview, upgrade].map(u => inScope(u, 'all')), [true, true, false, false]);
  assert.strictEqual(inScope(preview, 'selected', ['b1b2c3d4']), true); // only when picked by hand
});

test('builds a job and refuses bad requests', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.deepStrictEqual(buildJob({ scope: 'x' }, now), { error: 'invalid scope' });
  assert.deepStrictEqual(buildJob({ scope: 'selected', ids: [] }, now), { error: 'no updates selected' });
  assert.deepStrictEqual(buildJob({ scope: 'all', run_at: 'soon' }, now), { error: 'invalid run_at' });
  assert.ok(buildJob({ scope: 'all', run_at: '2027-06-01T00:00:00Z' }, now).error);
  const j = buildJob({ scope: 'selected', ids: [ID.toUpperCase(), ID, 'bad id'], reboot: 1, run_at: '2026-11-17T01:00:00Z' }, now);
  assert.deepStrictEqual(j.ids, [ID]);
  assert.strictEqual(j.reboot, true);
  assert.strictEqual(j.runAt.toISOString(), '2026-11-17T01:00:00.000Z');
  // a time in the past means "now", and a bulk scope carries no ids
  const k = buildJob({ scope: 'security', ids: [ID], run_at: '2026-11-01T00:00:00Z' }, now);
  assert.strictEqual(k.runAt.getTime(), now);
  assert.deepStrictEqual(k.ids, []);
  assert.strictEqual(commandParam({ id: 7, ...k }), '{"job":7,"scope":"security","ids":[],"reboot":false}');
});

test('summarizes an install result', () => {
  const s = summarizeResult({ ok: true, reboot_required: true, will_reboot: false, items: [
    { title: 'A', kb: 'KB1', result: 'installed' }, { title: 'B', kb: 'KB2', result: 'failed', detail: '0x80070005' },
    { title: 'C', result: 'skipped', detail: 'needs user input' }, { title: 'D', result: 'weird' } ] });
  assert.deepStrictEqual([s.installed, s.failed, s.skipped, s.ok], [1, 2, 1, false]);
  assert.strictEqual(resultText('FS01', s), '<b>Windows updates finished with errors</b> on FS01: 1 installed, 2 failed, 1 skipped — <b>reboot required</b>');
  const good = summarizeResult({ ok: true, will_reboot: true, reboot_required: true, items: [{ title: 'A', result: 'installed' }] });
  assert.strictEqual(good.ok, true);
  assert.strictEqual(resultText('FS01', good), '<b>Windows updates installed</b> on FS01: 1 installed — rebooting now');
  assert.strictEqual(resultText('FS01', summarizeResult({ ok: true, items: [] })), '<b>Windows updates</b> on FS01: nothing to install');
  const bad = summarizeResult({ ok: false, error: 'Exception from HRESULT: 0x8024402C' });
  assert.strictEqual(bad.ok, false);
  assert.match(resultText('FS01', bad), /failed<\/b> on FS01: Exception/);
  assert.strictEqual(summarizeResult(null).ok, false);
});

test('stale jobs time out', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  assert.strictEqual(jobTimedOut({ status: 'queued', queued_at: '2026-11-16T10:30:00Z' }, now), null);
  assert.match(jobTimedOut({ status: 'queued', queued_at: '2026-11-16T09:59:00Z' }, now), /2 hours/);
  assert.strictEqual(jobTimedOut({ status: 'running', started_at: '2026-11-16T05:00:00Z' }, now), null);
  assert.match(jobTimedOut({ status: 'running', started_at: '2026-11-16T03:00:00Z' }, now), /8 hours/);
  assert.strictEqual(jobTimedOut({ status: 'scheduled' }, now), null);
});
