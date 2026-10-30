import { useEffect, useState } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

// Physical disk health (SMART) for one server. Renders nothing for a VM or a
// host whose agent has not reported disks yet.
const LEVEL = [
  { cls: 'badge-viewer', key: 'smart.ok' },
  { cls: 'badge-warning', key: 'smart.warn' },
  { cls: 'badge-error', key: 'smart.fail' },
];

function hoursText(t, h) {
  if (h == null) return '—';
  const days = h / 24;
  return days >= 365 ? t('smart.years', { n: (days / 365).toFixed(1) }) : t('smart.days', { n: Math.round(days) });
}

export function smartReasons(t, d) {
  return (d.reasons || '').split(',').filter(Boolean).map(code => {
    if (code === 'wear') return t('smart.r.wear', { n: d.wear });
    if (code === 'hot') return t('smart.r.hot', { n: d.temperature });
    if (code === 'opstatus') return t('smart.r.opstatus', { s: d.op_status });
    return t('smart.r.' + code);
  }).join('; ');
}

export default function SmartDisks({ serverId }) {
  const { t } = useLang();
  const [disks, setDisks] = useState(null);

  useEffect(() => {
    api.getSmart(serverId).then(setDisks).catch(() => setDisks([]));
  }, [serverId]);

  if (!disks || disks.length === 0) return null;
  const hasRaid = disks.some(d => d.raid);

  return (
    <div className="card" style={{ marginBottom: 24 }}>
      <h3 style={{ marginBottom: 12 }}>💽 {t('smart.title')}</h3>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>{t('smart.disk')}</th>
              <th>{t('smart.type')}</th>
              <th>{t('smart.state')}</th>
              <th>{t('smart.temp')}</th>
              <th>{t('smart.wear')}</th>
              <th>{t('smart.poh')}</th>
              <th>{t('smart.errors')}</th>
            </tr>
          </thead>
          <tbody>
            {disks.map(d => {
              const lv = LEVEL[d.level] || LEVEL[0];
              const reasons = smartReasons(t, d);
              const errs = d.read_errors_unc == null && d.write_errors_unc == null
                ? '—' : `${d.read_errors_unc ?? 0} / ${d.write_errors_unc ?? 0}`;
              const hasErrs = Number(d.read_errors_unc) > 0 || Number(d.write_errors_unc) > 0;
              return (
                <tr key={d.disk_key}>
                  <td>
                    <div style={{ fontWeight: 500 }}>{d.model || '—'}</div>
                    {d.serial && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>S/N {d.serial}</div>}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {[d.media && d.media.toUpperCase(), d.bus && d.bus.toUpperCase()].filter(Boolean).join(' · ') || '—'}
                    {d.size_gb != null && <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.size_gb >= 1000 ? (d.size_gb / 1000).toFixed(1) + ' TB' : d.size_gb + ' GB'}</div>}
                  </td>
                  <td>
                    {d.raid
                      ? <span className="badge" title={t('smart.raidHint')}>{t('smart.raid')}</span>
                      : <span className={`badge ${lv.cls}`}>{t(lv.key)}</span>}
                    {reasons && <div style={{ fontSize: 12, marginTop: 4, color: d.level >= 2 ? 'var(--danger)' : 'var(--warning)' }}>{reasons}</div>}
                  </td>
                  <td style={{ color: (d.reasons || '').includes('hot') ? 'var(--warning)' : undefined }}>
                    {d.temperature != null ? `${d.temperature}°C` : '—'}
                  </td>
                  <td style={{ color: (d.reasons || '').includes('wear') ? 'var(--warning)' : undefined }}>
                    {d.wear != null ? `${d.wear}%` : '—'}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>{hoursText(t, d.power_on_hours)}</td>
                  <td style={{ color: hasErrs ? 'var(--warning)' : undefined }} title={t('smart.errorsHint')}>{errs}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
        {t('smart.updated', { time: new Date(Math.max(...disks.map(d => new Date(d.updated_at).getTime()))).toLocaleString() })}
        {hasRaid && <> · {t('smart.raidHint')}</>}
      </div>
    </div>
  );
}
