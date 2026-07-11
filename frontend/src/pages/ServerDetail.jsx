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
  const [latest, setLatest] = useState(null);
  const [rollupMode, setRollupMode] = useState(false);
  const [events, setEvents] = useState([]);
  const [hours, setHours] = useState(24);
  const [tab, setTab] = useState('metrics');
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState('');
  const [showScript, setShowScript] = useState(false);
  const [scriptContent, setScriptContent] = useState('');
  const [commands, setCommands] = useState([]);
  const [svc, setSvc] = useState('');
  const [secEvents, setSecEvents] = useState([]);
  const [health, setHealth] = useState([]);
  const [inventory, setInventory] = useState(null);
  const [swFilter, setSwFilter] = useState('');

  useEffect(() => {
    api.getServer(id).then(setServer);
    api.getEvents(id, '', 200).then(setEvents);
    api.getMetricsLatest(id).then(setLatest);
    setLoading(false);
  }, [id]);

  // Charts: raw minute data for short ranges, hourly rollups beyond a week.
  useEffect(() => {
    const useRollup = hours > 168;
    setRollupMode(useRollup);
    const load = useRollup ? api.getMetricsRollup(id, hours) : api.getMetrics(id, hours);
    load.then(setMetrics).catch(() => setMetrics([]));
  }, [id, hours]);

  async function loadToken() {
    const data = await api.getServerToken(id);
    setToken(data.token);
  }

  function loadCommands() {
    api.getCommands(id).then(setCommands);
  }

  function loadSecurity() {
    api.getServerSecurity(id).then(setSecEvents);
  }

  function loadHealth() {
    api.getServerHealth(id).then(setHealth);
  }

  function loadInventory() {
    api.getInventory(id).then(setInventory).catch(() => setInventory({ hardware: null, software: [] }));
  }

  async function blockIp(ip) {
    if (!ip || ip === '-') return;
    if (!confirm(`Block ${ip} on ${server.hostname}?`)) return;
    await api.queueCommand(Number(id), 'block_ip', ip);
    alert(`Queued. Applies within ~1 min (agent v2.5+).`);
  }

  async function doReboot() {
    if (!confirm(`Reboot ${server.hostname}? The agent will reboot it within ~1 minute.`)) return;
    await api.queueCommand(Number(id), 'reboot', '');
    loadCommands();
  }

  async function doRestartService() {
    if (!svc.trim()) return;
    if (!confirm(`Restart service "${svc}" on ${server.hostname}?`)) return;
    await api.queueCommand(Number(id), 'restart_service', svc.trim());
    setSvc('');
    loadCommands();
  }

  async function doForceUpdate() {
    if (!confirm(`Force the agent on ${server.hostname} to re-download and update now?`)) return;
    await api.queueCommand(Number(id), 'force_update', '');
    loadCommands();
  }

  async function doUninstall() {
    if (!confirm(`Uninstall the agent from ${server.hostname}? It stops reporting and the scheduled task + files are removed. To re-add it, redeploy the agent.`)) return;
    await api.queueCommand(Number(id), 'uninstall_agent', '');
    loadCommands();
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

  const chartData = metrics.map(m => rollupMode ? ({
    time: new Date(m.collected_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit' }),
    cpu: m.cpu_avg != null ? Math.round(Number(m.cpu_avg)) : 0,
    mem: m.mem_pct_avg != null ? Math.round(Number(m.mem_pct_avg)) : 0,
    disk: m.disk_pct_avg != null ? Math.round(Number(m.disk_pct_avg)) : 0,
  }) : ({
    time: new Date(m.collected_at).toLocaleTimeString(),
    cpu: m.cpu_usage != null ? Math.round(Number(m.cpu_usage)) : 0,
    mem: m.memory_total_mb > 0 ? Math.round((Number(m.memory_used_mb) / Number(m.memory_total_mb)) * 100) : 0,
    disk: m.disk_total_gb > 0 ? Math.round((Number(m.disk_used_gb) / Number(m.disk_total_gb)) * 100) : 0,
  }));

  const latestData = latest || {};
  const latestDisks = Array.isArray(latestData.disks_json) ? latestData.disks_json : [];

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
            <option value={720}>Last 30 days</option>
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
          <div className="metric-value">{latestData.cpu_usage != null ? `${Number(latestData.cpu_usage).toFixed(1)}%` : '-'}</div>
          <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${Number(latestData.cpu_usage) || 0}%`, background: Number(latestData.cpu_usage) > 90 ? 'var(--danger)' : 'var(--primary)' }} /></div>
        </div>
        <div className="card">
          <div className="metric-label">Memory</div>
          <div className="metric-value">{latestData.memory_used_mb != null ? `${Number(latestData.memory_used_mb).toFixed(0)} / ${Number(latestData.memory_total_mb).toFixed(0)} MB` : '-'}</div>
          {latestData.memory_total_mb > 0 && (
            <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${(Number(latestData.memory_used_mb) / Number(latestData.memory_total_mb)) * 100}%`, background: (Number(latestData.memory_used_mb) / Number(latestData.memory_total_mb)) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
          )}
        </div>
        <div className="card">
          <div className="metric-label">Disk Total</div>
          <div className="metric-value" style={{ fontSize: 22 }}>{latestData.disk_used_gb != null ? `${Number(latestData.disk_used_gb).toFixed(0)} / ${Number(latestData.disk_total_gb).toFixed(0)} GB` : '-'}</div>
          {latestData.disk_total_gb > 0 && (
            <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${(Number(latestData.disk_used_gb) / Number(latestData.disk_total_gb)) * 100}%`, background: (Number(latestData.disk_used_gb) / Number(latestData.disk_total_gb)) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
          )}
        </div>
      </div>

      {latestDisks.length > 0 && (
        <div className="grid grid-3" style={{ marginBottom: 24 }}>
          {latestDisks.map((d, i) => (
            <div className="card" key={i}>
              <div className="metric-label">Disk {d.drive}</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{Number(d.free_gb).toFixed(0)} GB free</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{Number(d.used_gb).toFixed(0)} / {Number(d.total_gb).toFixed(0)} GB</div>
              <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${d.total_gb > 0 ? (d.used_gb / d.total_gb) * 100 : 0}%`, background: d.total_gb > 0 && (d.used_gb / d.total_gb) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
              {d.read_bytes_sec != null && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>Read:</span><span style={{ color: 'var(--text)' }}>{(Number(d.read_bytes_sec) / 1048576).toFixed(1)} MB/s</span>
                  <span>Write:</span><span style={{ color: 'var(--text)' }}>{(Number(d.write_bytes_sec) / 1048576).toFixed(1)} MB/s</span>
                  <span>Busy:</span><span style={{ color: Number(d.disk_time_pct) > 80 ? 'var(--danger)' : 'var(--text)' }}>{Number(d.disk_time_pct).toFixed(0)}%</span>
                  <span>Queue:</span><span style={{ color: 'var(--text)' }}>{Number(d.queue_length).toFixed(1)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === 'metrics' ? 'active' : ''}`} onClick={() => setTab('metrics')}>Metrics</button>
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>System Events</button>
        <button className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>Info</button>
        <button className={`tab ${tab === 'health' ? 'active' : ''}`} onClick={() => { setTab('health'); loadHealth(); }}>Health</button>
        <button className={`tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => { setTab('inventory'); loadInventory(); }}>Inventory</button>
        {user?.role === 'admin' && <button className={`tab ${tab === 'agent' ? 'active' : ''}`} onClick={() => { setTab('agent'); loadToken(); }}>Agent</button>}
        {user?.role === 'admin' && <button className={`tab ${tab === 'control' ? 'active' : ''}`} onClick={() => { setTab('control'); loadCommands(); }}>Control</button>}
        {user?.role === 'admin' && <button className={`tab ${tab === 'security' ? 'active' : ''}`} onClick={() => { setTab('security'); loadSecurity(); }}>Security</button>}
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
            <dt style={{ color: 'var(--text-muted)' }}>Customer:</dt><dd>{server.customer_name || '—'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Group:</dt><dd>{server.group_name || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Status:</dt><dd><span className="status"><span className={`status-dot ${server.status}`} />{server.status}</span></dd>
            <dt style={{ color: 'var(--text-muted)' }}>Last Seen:</dt><dd>{server.last_seen || 'Never'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>Registered:</dt><dd>{new Date(server.created_at).toLocaleString()}</dd>
          </dl>
        </div>
      )}

      {tab === 'health' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Health</h3>
            {server.pending_reboot ? <span className="badge badge-warning">Reboot pending</span> : <span className="badge badge-viewer">No reboot pending</span>}
            {server.health_at && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>updated {new Date(server.health_at).toLocaleString()}</span>}
          </div>
          {!server.health_at ? (
            <div className="empty"><p>No health data yet — requires agent v2.6+ on this host.</p></div>
          ) : health.length === 0 ? (
            <div className="empty"><p>✓ All healthy — no stopped services, expiring certs, or failed tasks.</p></div>
          ) : (
            <table>
              <thead><tr><th>Type</th><th>Item</th><th>Detail</th></tr></thead>
              <tbody>
                {health.map(h => (
                  <tr key={h.id}>
                    <td>
                      <span className={`badge ${h.kind === 'service_stopped' ? 'badge-error' : h.kind === 'cert_expiring' ? 'badge-warning' : 'badge-error'}`}>
                        {h.kind === 'service_stopped' ? 'Service down' : h.kind === 'cert_expiring' ? 'Cert expiring' : 'Task failed'}
                      </span>
                    </td>
                    <td>{h.name || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {h.kind === 'cert_expiring' && h.expires_at ? `expires ${new Date(h.expires_at).toLocaleDateString()}` : (h.detail || '-')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'inventory' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>Inventory</h3>
            {server.inventory_at && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>updated {new Date(server.inventory_at).toLocaleString()}</span>}
          </div>
          {!inventory ? (
            <div className="empty"><p>Loading…</p></div>
          ) : !server.inventory_at ? (
            <div className="empty"><p>No inventory yet — requires agent v2.12+ on this host (collected once a day).</p></div>
          ) : (
            <>
              {inventory.hardware && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
                  {[
                    ['Manufacturer', inventory.hardware.manufacturer],
                    ['Model', inventory.hardware.model],
                    ['Serial', inventory.hardware.serial],
                    ['OS', `${inventory.hardware.os_caption || ''} ${inventory.hardware.os_build ? '(build ' + inventory.hardware.os_build + ')' : ''}`.trim()],
                    ['CPU', inventory.hardware.cpu],
                    ['Cores / threads', `${inventory.hardware.cpu_cores || '?'} / ${inventory.hardware.cpu_logical || '?'}`],
                    ['RAM', inventory.hardware.ram_gb ? `${inventory.hardware.ram_gb} GB` : '-'],
                    ['Disks', (inventory.hardware.disks || []).map(d => `${d.model || 'disk'} ${d.size_gb ? d.size_gb + ' GB' : ''}`.trim()).join('; ') || '-'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{k}</div>
                      <div style={{ fontSize: 14, marginTop: 3, wordBreak: 'break-word' }}>{v || '-'}</div>
                    </div>
                  ))}
                </div>
              )}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0 }}>Installed software ({inventory.software.length})</h4>
                <input placeholder="Filter…" value={swFilter} onChange={e => setSwFilter(e.target.value)} style={{ width: 200, marginLeft: 'auto' }} />
              </div>
              {inventory.software.length === 0 ? (
                <div className="empty"><p>No software list collected.</p></div>
              ) : (
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>Name</th><th>Version</th><th>Publisher</th></tr></thead>
                    <tbody>
                      {inventory.software
                        .filter(s => !swFilter || (s.name + ' ' + (s.publisher || '')).toLowerCase().includes(swFilter.toLowerCase()))
                        .map((s, i) => (
                          <tr key={i}>
                            <td>{s.name}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.version || '-'}</td>
                            <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.publisher || '-'}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
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

      {tab === 'control' && (
        <div className="card">
          <h3>Remote control</h3>
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>
            Commands are queued and executed by the agent on its next check-in (within ~1 minute).
            Requires agent v2.3+ on the host.
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Service name</label>
              <input value={svc} onChange={e => setSvc(e.target.value)} placeholder="e.g. MSSQLSERVER, Spooler, W3SVC" />
            </div>
            <button onClick={doRestartService}>Restart service</button>
            <button className="secondary" onClick={doForceUpdate}>Force update</button>
            <button className="danger" onClick={doReboot}>Reboot server</button>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Stop monitoring this server — removes the agent (scheduled task + files) from the host.</div>
            <button className="danger" onClick={doUninstall}>Uninstall agent</button>
          </div>

          <h3 style={{ margin: '16px 0 8px' }}>Recent commands</h3>
          {commands.length === 0 ? (
            <div className="empty"><p>No commands yet</p></div>
          ) : (
            <table>
              <thead><tr><th>Time</th><th>Command</th><th>Status</th><th>Result</th><th>By</th></tr></thead>
              <tbody>
                {commands.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleString()}</td>
                    <td>{c.ctype === 'reboot' ? 'reboot' : c.ctype === 'block_ip' ? `block ${c.param}` : c.ctype === 'uninstall_agent' ? 'uninstall agent' : c.ctype === 'force_update' ? 'force update' : `restart ${c.param}`}</td>
                    <td><span className={`badge ${c.status === 'done' ? 'badge-viewer' : c.status === 'failed' ? 'badge-error' : 'badge-warning'}`}>{c.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.result || '-'}</td>
                    <td style={{ fontSize: 12 }}>{c.requested_by || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'security' && (
        <div className="card">
          <h3 style={{ marginBottom: 8 }}>Recent logons</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            Failed (4625) and RDP (4624) logons from the Security log. Requires agent v2.5+.
          </p>
          {secEvents.length === 0 ? (
            <div className="empty"><p>No security events recorded</p></div>
          ) : (
            <table>
              <thead><tr><th>Result</th><th>Account</th><th>Source IP</th><th>Type</th><th>Time</th><th></th></tr></thead>
              <tbody>
                {secEvents.map(e => (
                  <tr key={e.id}>
                    <td><span className={`badge ${e.event === 'fail' ? 'badge-error' : 'badge-viewer'}`}>{e.event === 'fail' ? 'FAIL' : 'OK'}</span></td>
                    <td>{e.account || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.ip || '-'}</td>
                    <td style={{ fontSize: 12 }}>{e.logon_type === '10' ? 'RDP' : e.logon_type}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(e.recorded_at || e.created_at).toLocaleString()}</td>
                    <td>{e.event === 'fail' && e.ip && e.ip !== '-' && <button className="danger" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => blockIp(e.ip)}>Block</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
