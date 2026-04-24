import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ServerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [server, setServer] = useState(null);
  const [metrics, setMetrics] = useState([]);
  const [events, setEvents] = useState([]);
  const [hours, setHours] = useState(24);
  const [tab, setTab] = useState('metrics');
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [showScript, setShowScript] = useState(false);
  const [scriptContent, setScriptContent] = useState('');

  useEffect(() => {
    api.getServer(id).then(setServer);
    api.getMetrics(id, hours).then(setMetrics);
    api.getEvents(id, '', 200).then(setEvents);
    setLoading(false);
  }, [id, hours]);

  async function loadToken() {
    const data = await api.getServerToken(id);
    setToken(data.token);
  }

  async function regenerateToken() {
    const data = await api.regenerateToken(id);
    setToken(data.token);
  }

  async function loadScript() {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/agent/script/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    setScriptContent(text);
    setShowScript(true);
  }

  if (loading) return <div className="loading">Loading...</div>;
  if (!server) return <div className="empty">Server not found</div>;

  const chartData = metrics.map(m => ({
    time: new Date(m.collected_at).toLocaleTimeString(),
    cpu: Math.round(m.cpu_usage),
    mem: m.memory_total_mb > 0 ? Math.round((m.memory_used_mb / m.memory_total_mb) * 100) : 0,
    disk: m.disk_total_gb > 0 ? Math.round((m.disk_used_gb / m.disk_total_gb) * 100) : 0,
  }));

  const latest = metrics[metrics.length - 1] || {};

  return (
    <div>
      <div className="page-header">
        <div>
          <Link to="/servers" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← Servers</Link>
          <h1>{server.hostname}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={1}>Last hour</option>
            <option value={6}>Last 6 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={168}>Last 7 days</option>
          </select>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="metric-label">Status</div>
          <div className="metric-value" style={{ fontSize: 16 }}><span className="status"><span className={`status-dot ${server.status}`} />{server.status}</span></div>
        </div>
        <div className="card">
          <div className="metric-label">CPU</div>
          <div className="metric-value">{latest.cpu_usage != null ? `${Number(latest.cpu_usage).toFixed(1)}%` : '-'}</div>
          <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${latest.cpu_usage || 0}%`, background: latest.cpu_usage > 90 ? 'var(--danger)' : 'var(--primary)' }} /></div>
        </div>
        <div className="card">
          <div className="metric-label">Memory</div>
          <div className="metric-value">{latest.memory_used_mb != null ? `${Number(latest.memory_used_mb).toFixed(0)} / ${Number(latest.memory_total_mb).toFixed(0)} MB` : '-'}</div>
          {latest.memory_total_mb > 0 && (
            <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${(latest.memory_used_mb / latest.memory_total_mb) * 100}%`, background: (latest.memory_used_mb / latest.memory_total_mb) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
          )}
        </div>
        <div className="card">
          <div className="metric-label">Disk</div>
          <div className="metric-value">{latest.disk_used_gb != null ? `${Number(latest.disk_used_gb).toFixed(0)} / ${Number(latest.disk_total_gb).toFixed(0)} GB` : '-'}</div>
          {latest.disk_total_gb > 0 && (
            <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${(latest.disk_used_gb / latest.disk_total_gb) * 100}%`, background: (latest.disk_used_gb / latest.disk_total_gb) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
          )}
        </div>
      </div>

      <div className="tabs">
        <button className={`tab ${tab === 'metrics' ? 'active' : ''}`} onClick={() => setTab('metrics')}>Metrics</button>
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>System Events</button>
        <button className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Info</button>
        {user?.role === 'admin' && <button className={`tab ${tab === 'agent' ? 'active' : ''}`} onClick={() => { setTab('agent'); loadToken(); }}>Agent</button>}
      </div>

      {tab === 'metrics' && (
        <div>
          {chartData.length === 0 ? (
            <div className="empty"><p>No metrics data yet</p></div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 16 }}>CPU Usage %</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" /><YAxis domain={[0, 100]} /><Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} /><Line type="monotone" dataKey="cpu" stroke="var(--primary)" dot={false} /></LineChart>
                </ResponsiveContainer>
              </div>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 16 }}>Memory Usage %</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" /><YAxis domain={[0, 100]} /><Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} /><Line type="monotone" dataKey="mem" stroke="var(--warning)" dot={false} /></LineChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <h3 style={{ marginBottom: 16 }}>Disk Usage %</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" /><YAxis domain={[0, 100]} /><Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} /><Line type="monotone" dataKey="disk" stroke="var(--success)" dot={false} /></LineChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'events' && (
        <div className="card">
          {events.length === 0 ? (
            <div className="empty"><p>No events recorded</p></div>
          ) : (
            <table>
              <thead><tr><th>Level</th><th>Source</th><th>Event ID</th><th>Message</th><th>Time</th></tr></thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i}>
                    <td><span className={`badge badge-${e.level.toLowerCase()}`}>{e.level}</span></td>
                    <td>{e.event_source}</td>
                    <td>{e.event_id}</td>
                    <td className="event-message" title={e.message}>{e.message}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(e.recorded_at || e.created_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'info' && (
        <div className="card">
          <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 24px' }}>
            <dt style={{ color: 'var(--text-muted)' }}>Hostname:</dt><dd>{server.hostname}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>IP Address:</dt><dd>{server.ip_address || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>OS:</dt><dd>{server.os_info || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Group:</dt><dd>{server.group_name || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Status:</dt><dd><span className="status"><span className={`status-dot ${server.status}`} />{server.status}</span></dd>
            <dt style={{ color: 'var(--text-muted)' }}>Last Seen:</dt><dd>{server.last_seen || 'Never'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Registered:</dt><dd>{new Date(server.created_at).toLocaleString()}</dd>
          </dl>
        </div>
      )}

      {tab === 'agent' && (
        <div className="card">
          <h3>Agent Configuration</h3>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Agent Token</label>
            <div className="script-container" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, wordBreak: 'break-all' }}>{token || 'Loading...'}</code>
            </div>
          </div>
          <div className="form-actions">
            {token && <button className="secondary" onClick={regenerateToken}>Regenerate Token</button>}
            <button onClick={loadScript}>Show Agent Script</button>
          </div>

          {showScript && (
            <div className="script-container" style={{ marginTop: 16, maxHeight: 600, overflow: 'auto' }}>
              <pre>{scriptContent}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
