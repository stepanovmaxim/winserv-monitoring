// Pure disk helpers, unit-tested in test/disk.test.js.

// Mount-point / reparse volumes report free > total (impossible) and dragged
// the aggregate negative. Keep only real fixed disks.
function filterValidDisks(disks) {
  if (!Array.isArray(disks)) return [];
  return disks.filter(d => {
    const t = Number(d.total_gb), f = Number(d.free_gb);
    return t > 0 && f >= 0 && f <= t + 0.5;
  });
}

// Recompute the aggregate from the valid disks; null if there are none.
function diskAggregate(validDisks) {
  if (!Array.isArray(validDisks) || !validDisks.length) return null;
  const total_gb = validDisks.reduce((a, d) => a + Number(d.total_gb), 0);
  const free_gb = validDisks.reduce((a, d) => a + Number(d.free_gb), 0);
  return { total_gb, free_gb, used_gb: total_gb - free_gb };
}

// Used/total as a percentage, always clamped to a sane 0..100.
function diskPct(used, total) {
  if (!(Number(total) > 0)) return null;
  return Math.max(0, Math.min(100, (Number(used) / Number(total)) * 100));
}

module.exports = { filterValidDisks, diskAggregate, diskPct };
