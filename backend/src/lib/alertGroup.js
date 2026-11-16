'use strict';

// Repeating alerts folded into one. A brute-force attempt that lasted over a
// day sent the same Telegram message every hour (85.235.148.7 on TS01); the
// operator learns nothing from the 20th copy and starts ignoring the channel.
//
// Grouping is strictly opt-in: the caller passes a key naming the one condition
// that is repeating. State changes (offline/online, service stopped/recovered)
// never pass a key, so they can never be swallowed into an older message.
// Pure and unit-tested.

const pad = (n) => String(n).padStart(2, '0');

// Should this occurrence join the open group, or start a new (loud) one?
// A group stays open for windowHours from its FIRST alert, so a condition that
// never stops still produces a fresh notification once per window.
function joinsGroup({ firstAt, windowHours = 24, now = Date.now() }) {
  const first = firstAt ? new Date(firstAt).getTime() : NaN;
  if (!Number.isFinite(first)) return false;
  const age = now - first;
  return age >= 0 && age < windowHours * 3600000;
}

// Line appended to the edited message: how often, and since when (UTC).
function repeatSuffix({ count, firstAt, now = Date.now() }) {
  const f = new Date(firstAt), n = new Date(now);
  const hm = (d) => `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  const dm = (d) => `${pad(d.getUTCDate())}.${pad(d.getUTCMonth() + 1)}`;
  const sameDay = f.toISOString().slice(0, 10) === n.toISOString().slice(0, 10);
  const since = sameDay ? hm(f) : `${dm(f)} ${hm(f)}`;
  return `🔁 ×${count} since ${since} UTC, last ${hm(n)}`;
}

module.exports = { joinsGroup, repeatSuffix };
