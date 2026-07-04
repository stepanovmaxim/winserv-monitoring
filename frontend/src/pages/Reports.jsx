import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Reports() {
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

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Uptime Report</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
          </select>
          <button className="secondary" onClick={exportCsv}>Export CSV</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          Uptime is derived from the hourly metric rollups. It measures availability since data collection
          began, and becomes a true {days}-day figure as history accumulates.
        </p>
      </div>

      <div className="card">
        {data.servers.length === 0 ? (
          <div className="empty"><p>No data yet</p></div>
        ) : (
          <table>
            <thead><tr><th>Server</th><th>Customer</th><th>Uptime</th><th>Samples</th></tr></thead>
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
