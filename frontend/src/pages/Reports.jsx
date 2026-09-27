import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';
import { parseForecasts, fcColor, MIN_R2 } from '../forecast';

export default function Reports() {
  const { t } = useLang();
  const [days, setDays] = useState(30);
  const [data, setData] = useState({ servers: [] });
  const [loading, setLoading] = useState(true);
  const [fleet, setFleet] = useState([]);
  const [onlySoon, setOnlySoon] = useState(true);

  useEffect(() => { api.getServers().then(setFleet).catch(() => setFleet([])); }, []);

  // Every growing volume across the fleet, soonest to fill first.
  const growing = fleet.flatMap(s => parseForecasts(s.forecasts)
    .filter(f => f.status === 'growing')
    .map(f => ({ ...f, server: s.display_name || s.hostname, serverId: s.id })))
    .filter(f => !onlySoon || (f.days != null && f.days <= 90))
    .sort((a, b) => (a.days ?? Infinity) - (b.days ?? Infinity));

  function load(d) {
    setLoading(true);
    api.getUptimeReport(d).then(setData).finally(() => setLoading(false));
  }

  useEffect(() => { load(days); }, [days]);

  function exportCsv() {
    const header = 'hostname,customer,uptime_pct,samples\n';
    const body = data.servers.map(s =>
      `${s.hostname},${s.customer_name || ''},${s.uptime_pct},${s.samples}`
    ).join('\n');
    const blob = new Blob([header + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `uptime-${days}d.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function color(pct) {
    if (pct >= 99.5) return 'var(--success)';
    if (pct >= 95) return 'var(--warning)';
    return 'var(--danger)';
  }

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('reports.title')}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>{t('reports.last7')}</option>
            <option value={30}>{t('reports.last30')}</option>
            <option value={90}>{t('reports.last90')}</option>
          </select>
          <button className="secondary" onClick={exportCsv}>{t('common.export')}</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('reports.desc', { d: days })}</p>
      </div>

      <div className="card">
        {data.servers.length === 0 ? (
          <div className="empty"><p>{t('reports.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('common.server')}</th><th>{t('common.customer')}</th><th>{t('reports.uptime')}</th><th>{t('reports.samples')}</th></tr></thead>
            <tbody>
              {data.servers.map(s => (
                <tr key={s.id}>
                  <td><strong>{s.hostname}</strong></td>
                  <td>{s.customer_name || '-'}</td>
                  <td style={{ color: color(s.uptime_pct), fontWeight: 600 }}>{s.uptime_pct}%</td>
                  <td style={{ color: 'var(--text-muted)' }}>{s.samples}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card" style={{ marginTop: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h3 style={{ margin: 0 }}>⏳ {t('fc.title')}</h3>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto', fontSize: 13, cursor: 'pointer' }}>
            <input type="checkbox" checked={onlySoon} onChange={e => setOnlySoon(e.target.checked)} style={{ width: 16, height: 16, margin: 0 }} />
            {t('fc.onlySoon')}
          </label>
        </div>
        <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>{t('fc.desc')}</p>
        {growing.length === 0 ? (
          <div className="empty"><p>{t('fc.empty')}</p></div>
        ) : (
          <table>
            <thead><tr>
              <th>{t('common.server')}</th><th>{t('fc.volume')}</th><th>{t('fc.rate')}</th>
              <th>{t('fc.days')}</th><th>{t('fc.free')}</th><th>{t('fc.conf')}</th>
            </tr></thead>
            <tbody>
              {growing.map(f => {
                const low = (f.r2 ?? 0) < MIN_R2;
                return (
                  <tr key={f.serverId + f.drive}>
                    <td><Link to={`/servers/${f.serverId}`}><strong>{f.server}</strong></Link></td>
                    <td>{f.drive}</td>
                    <td>{t('fc.rateN', { r: f.rate })}</td>
                    <td style={{ color: low ? 'var(--text-muted)' : fcColor(f.days), fontWeight: !low && f.days != null && f.days <= 14 ? 600 : undefined }}>
                      {f.days != null ? t('fc.daysN', { d: Math.round(f.days) }) : t('fc.beyond')}
                    </td>
                    <td style={{ color: 'var(--text-muted)' }}>{f.free} / {f.total} GB</td>
                    <td style={{ color: low ? 'var(--warning)' : 'var(--text-muted)' }} title={low ? t('fc.lowConf') : ''}>{Math.round((f.r2 ?? 0) * 100)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
