import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Dashboard() {
  const [servers, setServers] = useState([]);
  const [stats, setStats] = useState({ total: 0, online: 0, offline: 0 });
  const [loading, setLoading] = useState(true);
  const [sortKey, setSortKey] = useState('hostname');
  const [sortDir, setSortDir] = useState('asc');

  useEffect(() => {
    api.getServers().then(data => {
      setServers(data);
      setStats({
        total: data.length,
        online: data.filter(s => s.status === 'online').length,
        offline: data.filter(s => s.status === 'offline').length,
      });
    }).finally(() => setLoading(false));
  }, []);

  function handleSort(key) {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = useMemo(() => {
    return [...servers].sort((a, b) => {
      let va = a[sortKey];
      let vb = b[sortKey];
      if (sortKey === 'group') { va = a.group_name || ''; vb = b.group_name || ''; }
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'string') va = va.toLowerCase();
      if (typeof vb === 'string') vb = vb.toLowerCase();
      if (typeof va === 'number' && typeof vb === 'number') return sortDir === 'asc' ? va - vb : vb - va;
      return sortDir === 'asc' ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
    });
  }, [servers, sortKey, sortDir]);

  function Th({ col, label }) {
    const active = sortKey === col;
    return (
      <th onClick={() => handleSort(col)} style={{ cursor: 'pointer', userSelect: 'none' }}>
        {label} {active ? (sortDir === 'asc' ? '▲' : '▼') : ''}
      </th>
    );
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header"><h1>Dashboard</h1></div>

      <div className="grid grid-3" style={{ marginBottom: 24 }}>
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
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Server Overview</h3>
        {servers.length === 0 ? (
          <div className="empty"><div className="empty-icon">🖥</div><p>No servers registered</p></div>
        ) : (
          <table>
            <thead>
              <tr>
                <Th col="status" label="Status" />
                <Th col="hostname" label="Hostname" />
                <Th col="group" label="Group" />
                <Th col="last_cpu" label="CPU" />
                <Th col="last_mem_used" label="Memory" />
                <Th col="last_disk_used" label="Disk" />
                <Th col="last_seen" label="Last Seen" />
              </tr>
            </thead>
            <tbody>
              {sorted.map(s => (
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
