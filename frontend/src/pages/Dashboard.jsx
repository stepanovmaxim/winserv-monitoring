import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [stats, setStats] = useState({ total: 0, online: 0, offline: 0, warning: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getServers().then(data => {
      setServers(data);
      setStats({
        total: data.length,
        online: data.filter(s => s.status === 'online').length,
        offline: data.filter(s => s.status === 'offline').length,
        warning: data.filter(s => s.status === 'warning').length,
      });
    }).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header"><h1>Dashboard</h1></div>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="metric-value">{stats.total}</div>
          <div className="metric-label">Total Servers</div>
        </div>
        <div className="card">
          <div className="metric-value" style={{ color: 'var(--success)' }}>{stats.online}</div>
          <div className="metric-label">Online</div>
        </div>
        <div className="card">
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{stats.offline}</div>
          <div className="metric-label">Offline</div>
        </div>
        <div className="card">
          <div className="metric-value" style={{ color: 'var(--warning)' }}>{stats.warning}</div>
          <div className="metric-label">Warnings</div>
        </div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Server Overview</h3>
        {servers.length === 0 ? (
          <div className="empty"><div className="empty-icon">🖥</div><p>No servers registered</p></div>
        ) : (
          <table>
            <thead><tr><th>Status</th><th>Hostname</th><th>Group</th><th>CPU</th><th>Memory</th><th>Disk</th><th>Last Seen</th></tr></thead>
            <tbody>
              {servers.map(s => (
                <tr key={s.id}>
                  <td><span className="status"><span className={`status-dot ${s.status}`} />{s.status}</span></td>
                  <td><Link to={`/servers/${s.id}`}>{s.hostname}</Link></td>
                  <td>{s.group_name || '-'}</td>
                  <td>{s.last_cpu != null ? `${Number(s.last_cpu).toFixed(0)}%` : '-'}</td>
                  <td>{s.last_mem_used != null ? `${Number(s.last_mem_used).toFixed(0)} / ${Number(s.last_mem_total).toFixed(0)} MB` : '-'}</td>
                  <td>{s.last_disk_used != null ? `${Number(s.last_disk_used).toFixed(0)} / ${Number(s.last_disk_total).toFixed(0)} GB` : '-'}</td>
                  <td>{s.last_seen || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
