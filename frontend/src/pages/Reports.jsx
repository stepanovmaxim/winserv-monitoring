import { useState, useEffect } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Reports() {
  const { t } = useLang();
  const [days, setDays] = useState(30);
  const [data, setData] = useState({ servers: [] });
  const [loading, setLoading] = useState(true);

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
    </div>
  );
}
