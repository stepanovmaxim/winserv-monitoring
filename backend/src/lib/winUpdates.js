'use strict';

// Windows Update: what the agent found pending, and what an install run did.
// The agent's helper script reports raw values; everything is bounded and
// normalised here before it is stored or shown. Pure and unit-tested.

const SCOPES = ['security', 'all', 'selected'];
// First agent build that understands wu_scan / install_updates.
const MIN_AGENT = '2.56';

const str = (v, n) => String(v ?? '').trim().slice(0, n);

function versionAtLeast(v, min) {
  const a = String(v || '').split('.').map(n => parseInt(n) || 0);
  const b = String(min).split('.').map(n => parseInt(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return true;
}

function normalizeUpdate(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw.id, 64).toLowerCase();
  const title = str(raw.title, 300);
  if (!/^[0-9a-f-]{8,64}$/.test(id) || !title) return null;
  const size = Number(raw.size_mb);
  return {
    id,
    title,
    kb: /^KB\d+$/i.test(str(raw.kb, 20)) ? str(raw.kb, 20).toUpperCase() : '',
    severity: str(raw.severity, 20),
    categories: str(raw.categories, 200),
    size_mb: Number.isFinite(size) && size >= 0 ? Math.round(size * 10) / 10 : null,
    downloaded: !!raw.downloaded,
    security: !!raw.security,
    preview: !!raw.preview,
    upgrade: !!raw.upgrade,
  };
}

// The same rule the helper applies on the host, used to preview what a scope
// will install. Previews and feature upgrades are never part of a bulk scope.
function inScope(u, scope, ids = []) {
  if (scope === 'selected') return ids.includes(u.id);
  if (u.preview || u.upgrade) return false;
  return scope === 'all' ? true : !!u.security;
}

// Validate an install request from the panel. Returns { error } or the job.
function buildJob({ scope, ids, reboot, run_at }, now = Date.now()) {
  if (!SCOPES.includes(scope)) return { error: 'invalid scope' };
  const list = [...new Set((Array.isArray(ids) ? ids : []).map(i => str(i, 64).toLowerCase()).filter(i => /^[0-9a-f-]{8,64}$/.test(i)))].slice(0, 200);
  if (scope === 'selected' && list.length === 0) return { error: 'no updates selected' };
  let at = now;
  if (run_at) {
    at = new Date(run_at).getTime();
    if (!Number.isFinite(at)) return { error: 'invalid run_at' };
    if (at > now + 60 * 86400000) return { error: 'run_at is more than 60 days ahead' };
    if (at < now) at = now;
  }
  return { scope, ids: scope === 'selected' ? list : [], reboot: !!reboot, runAt: new Date(at) };
}

// What the agent is told to do. Kept small: it travels in the command param.
function commandParam(job) {
  return JSON.stringify({ job: job.id, scope: job.scope, ids: job.ids || [], reboot: !!job.reboot });
}

// Outcome of an install run as reported by the helper.
function summarizeResult(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 200).map(i => ({
    title: str(i && i.title, 300),
    kb: str(i && i.kb, 20),
    result: ['installed', 'failed', 'skipped'].includes(i && i.result) ? i.result : 'failed',
    detail: str(i && i.detail, 120),
  }));
  const count = (k) => items.filter(i => i.result === k).length;
  const installed = count('installed'), failed = count('failed'), skipped = count('skipped');
  const error = str(r.error, 300);
  const ok = !!r.ok && !error && failed === 0;
  return {
    ok, installed, failed, skipped, error, items,
    reboot_required: !!r.reboot_required,
    will_reboot: !!r.will_reboot,
  };
}

// One line for the journal / Telegram.
function resultText(label, s) {
  if (s.error) return `<b>Windows updates failed</b> on ${label}: ${s.error}`;
  if (s.installed + s.failed + s.skipped === 0) return `<b>Windows updates</b> on ${label}: nothing to install`;
  const parts = [`${s.installed} installed`];
  if (s.failed) parts.push(`${s.failed} failed`);
  if (s.skipped) parts.push(`${s.skipped} skipped`);
  const reboot = s.will_reboot ? ' — rebooting now' : s.reboot_required ? ' — <b>reboot required</b>' : '';
  return `<b>Windows updates ${s.failed ? 'finished with errors' : 'installed'}</b> on ${label}: ${parts.join(', ')}${reboot}`;
}

// A job that never started or never reported back must not linger: a queued
// install reaching a host days late would run outside its window.
const QUEUE_TIMEOUT_MS = 2 * 3600000;
const RUN_TIMEOUT_MS = 8 * 3600000;
function jobTimedOut(job, now = Date.now()) {
  const t = (v) => (v ? new Date(v).getTime() : 0);
  if (job.status === 'queued') return now - t(job.queued_at) > QUEUE_TIMEOUT_MS ? 'host did not pick up the command within 2 hours' : null;
  if (job.status === 'running') return now - t(job.started_at) > RUN_TIMEOUT_MS ? 'no result within 8 hours' : null;
  return null;
}

module.exports = { SCOPES, MIN_AGENT, versionAtLeast, normalizeUpdate, inScope, buildJob, commandParam, summarizeResult, resultText, jobTimedOut };
