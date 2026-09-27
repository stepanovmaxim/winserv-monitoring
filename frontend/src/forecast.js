// Shared rendering of disk fill forecasts (computed hourly on the backend and
// returned as server.forecasts). One place so the list badge, the disk cards and
// the fleet report always agree.

export const MIN_R2 = 0.6; // same confidence floor the backend alerts on

export function parseForecasts(v) {
  if (Array.isArray(v)) return v;
  try { const a = JSON.parse(v || '[]'); return Array.isArray(a) ? a : []; } catch { return []; }
}

export function fcColor(days) {
  if (days == null) return 'var(--text-muted)';
  if (days <= 3) return 'var(--danger)';
  if (days <= 14) return 'var(--warning)';
  return 'var(--text)';
}

// The soonest-filling reliable volume within `horizon` days, or null.
export function soonestFill(server, horizon = 30) {
  let best = null;
  for (const f of parseForecasts(server.forecasts)) {
    if (f.status !== 'growing' || f.days == null || (f.r2 ?? 0) < MIN_R2) continue;
    if (!best || f.days < best.days) best = f;
  }
  return best && best.days <= horizon ? best : null;
}

// One-line human summary for a volume's forecast: { text, color } or null.
export function forecastLine(t, f) {
  if (!f) return null;
  if (f.status === 'insufficient') return { text: t('fc.insufficient'), color: 'var(--text-muted)' };
  if (f.status !== 'growing') return { text: t('fc.stable'), color: 'var(--text-muted)' };
  if (f.days == null) return { text: t('fc.growingSlow', { r: f.rate }), color: 'var(--text-muted)' };
  const low = (f.r2 ?? 0) < MIN_R2;
  return {
    text: t('fc.fillsIn', { d: Math.round(f.days), r: f.rate }) + (low ? ' · ' + t('fc.lowConf') : ''),
    color: low ? 'var(--text-muted)' : fcColor(f.days),
  };
}
