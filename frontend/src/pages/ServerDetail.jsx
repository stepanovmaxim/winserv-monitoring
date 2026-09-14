import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { api } from '../api';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function ServerDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { t } = useLang();
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
  const [processes, setProcesses] = useState(null);
  const [procSort, setProcSort] = useState('cpu');

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

  function loadProcesses() {
    api.getProcesses(id).then(setProcesses).catch(() => setProcesses([]));
  }

  async function blockIp(ip) {
    if (!ip || ip === '-') return;
    if (!confirm(t('sd.blockConfirm', { ip, host: server.hostname }))) return;
    await api.queueCommand(Number(id), 'block_ip', ip);
    alert(t('sd.blockQueued'));
  }

  async function doReboot() {
    if (!confirm(t('sd.rebootConfirm', { host: server.hostname }))) return;
    await api.queueCommand(Number(id), 'reboot', '');
    loadCommands();
  }

  async function doRestartService() {
    if (!svc.trim()) return;
    if (!confirm(t('sd.restartConfirm', { svc, host: server.hostname }))) return;
    await api.queueCommand(Number(id), 'restart_service', svc.trim());
    setSvc('');
    loadCommands();
  }

  async function doForceUpdate() {
    if (!confirm(t('sd.forceConfirm', { host: server.hostname }))) return;
    await api.queueCommand(Number(id), 'force_update', '');
    loadCommands();
  }

  async function doKillProcess() {
    const pv = prompt(t('sd.killPrompt', { host: server.hostname }));
    if (!pv || !pv.trim()) return;
    await api.queueCommand(Number(id), 'kill_process', pv.trim());
    alert(t('sd.killQueued'));
    loadCommands();
  }

  async function doIsolate() {
    const raw = prompt(t('sd.isoPrompt', { host: server.hostname }), '60');
    if (raw == null) return;
    const mins = parseInt(raw);
    if (!mins || mins < 1) return alert(t('sd.isoMinErr'));
    if (!confirm(t('sd.isoConfirm', { host: server.hostname, n: mins }))) return;
    await api.queueCommand(Number(id), 'isolate_host', String(mins));
    alert(t('sd.isoQueued', { n: mins }));
    loadCommands();
  }

  async function doUnisolate() {
    await api.queueCommand(Number(id), 'unisolate_host', '');
    alert(t('sd.unisoQueued'));
    loadCommands();
  }

  async function doScan(kind) {
    await api.queueCommand(Number(id), 'defender_scan', kind);
    alert(t('sd.scanQueued', { kind }));
    loadCommands();
  }

  async function doUninstall() {
    if (!confirm(t('sd.uninstallConfirm', { host: server.hostname }))) return;
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

  if (loading) return <div className="loading">{t('common.loading')}</div>;
  if (!server) return <div className="empty">{t('sd.notfound')}</div>;

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
          <Link to="/servers" style={{ fontSize: 13, color: 'var(--text-muted)' }}>← {t('sd.back')}</Link>
          <h1>{server.display_name || server.hostname}</h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={1}>{t('sd.last1h')}</option>
            <option value={6}>{t('sd.last6h')}</option>
            <option value={24}>{t('sd.last24h')}</option>
            <option value={168}>{t('sd.last7d')}</option>
            <option value={720}>{t('sd.last30d')}</option>
          </select>
        </div>
      </div>

      <div className="grid grid-4" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="metric-label">{t('sd.status')}</div>
          <div className="metric-value" style={{ fontSize: 16 }}><span className="status"><span className={`status-dot ${server.status}`} />{server.status}</span></div>
        </div>
        <div className="card">
          <div className="metric-label">CPU</div>
          <div className="metric-value">{latestData.cpu_usage != null ? `${Number(latestData.cpu_usage).toFixed(1)}%` : '-'}</div>
          <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${Number(latestData.cpu_usage) || 0}%`, background: Number(latestData.cpu_usage) > 90 ? 'var(--danger)' : 'var(--primary)' }} /></div>
        </div>
        <div className="card">
          <div className="metric-label">{t('sd.memory')}</div>
          <div className="metric-value">{latestData.memory_used_mb != null ? `${Number(latestData.memory_used_mb).toFixed(0)} / ${Number(latestData.memory_total_mb).toFixed(0)} MB` : '-'}</div>
          {latestData.memory_total_mb > 0 && (
            <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${(Number(latestData.memory_used_mb) / Number(latestData.memory_total_mb)) * 100}%`, background: (Number(latestData.memory_used_mb) / Number(latestData.memory_total_mb)) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
          )}
        </div>
        <div className="card">
          <div className="metric-label">{t('sd.diskTotal')}</div>
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
              <div className="metric-label">{t('sd.diskLabel', { d: d.drive })}</div>
              <div className="metric-value" style={{ fontSize: 18 }}>{t('sd.free', { n: Number(d.free_gb).toFixed(0) })}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{Number(d.used_gb).toFixed(0)} / {Number(d.total_gb).toFixed(0)} GB</div>
              <div className="metric-bar"><div className="metric-bar-fill" style={{ width: `${d.total_gb > 0 ? (d.used_gb / d.total_gb) * 100 : 0}%`, background: d.total_gb > 0 && (d.used_gb / d.total_gb) > 0.9 ? 'var(--danger)' : 'var(--primary)' }} /></div>
              {d.read_bytes_sec != null && (
                <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 12px', fontSize: 12, color: 'var(--text-muted)' }}>
                  <span>{t('sd.read')}</span><span style={{ color: 'var(--text)' }}>{(Number(d.read_bytes_sec) / 1048576).toFixed(1)} MB/s</span>
                  <span>{t('sd.write')}</span><span style={{ color: 'var(--text)' }}>{(Number(d.write_bytes_sec) / 1048576).toFixed(1)} MB/s</span>
                  <span>{t('sd.busy')}</span><span style={{ color: Number(d.disk_time_pct) > 80 ? 'var(--danger)' : 'var(--text)' }}>{Number(d.disk_time_pct).toFixed(0)}%</span>
                  <span>{t('sd.queue')}</span><span style={{ color: 'var(--text)' }}>{Number(d.queue_length).toFixed(1)}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === 'metrics' ? 'active' : ''}`} onClick={() => setTab('metrics')}>{t('sd.tabMetrics')}</button>
        <button className={`tab ${tab === 'events' ? 'active' : ''}`} onClick={() => setTab('events')}>{t('sd.tabEvents')}</button>
        <button className={`tab ${tab === 'info' ? 'active' : ''}`} onClick={() => setTab('info')}>{t('sd.tabInfo')}</button>
        <button className={`tab ${tab === 'health' ? 'active' : ''}`} onClick={() => { setTab('health'); loadHealth(); }}>{t('sd.tabHealth')}</button>
        <button className={`tab ${tab === 'inventory' ? 'active' : ''}`} onClick={() => { setTab('inventory'); loadInventory(); }}>{t('sd.tabInventory')}</button>
        <button className={`tab ${tab === 'processes' ? 'active' : ''}`} onClick={() => { setTab('processes'); loadProcesses(); }}>{t('sd.tabProcesses')}</button>
        {user?.role === 'admin' && <button className={`tab ${tab === 'agent' ? 'active' : ''}`} onClick={() => { setTab('agent'); loadToken(); }}>{t('sd.tabAgent')}</button>}
        {user?.role === 'admin' && <button className={`tab ${tab === 'control' ? 'active' : ''}`} onClick={() => { setTab('control'); loadCommands(); }}>{t('sd.tabControl')}</button>}
        {user?.role === 'admin' && <button className={`tab ${tab === 'security' ? 'active' : ''}`} onClick={() => { setTab('security'); loadSecurity(); }}>{t('sd.tabSecurity')}</button>}
      </div>

      {tab === 'metrics' && (
        <div>
          {chartData.length === 0 ? (
            <div className="empty"><p>{t('sd.noMetrics')}</p></div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 16 }}>{t('sd.cpuChart')}</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" /><YAxis domain={[0, 100]} /><Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} /><Line type="monotone" dataKey="cpu" stroke="var(--primary)" dot={false} /></LineChart>
                </ResponsiveContainer>
              </div>
              <div className="card" style={{ marginBottom: 16 }}>
                <h3 style={{ marginBottom: 16 }}>{t('sd.memChart')}</h3>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}><CartesianGrid stroke="var(--border)" strokeDasharray="3 3" /><XAxis dataKey="time" /><YAxis domain={[0, 100]} /><Tooltip contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }} /><Line type="monotone" dataKey="mem" stroke="var(--warning)" dot={false} /></LineChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <h3 style={{ marginBottom: 16 }}>{t('sd.diskChart')}</h3>
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
            <div className="empty"><p>{t('sd.noEvents')}</p></div>
          ) : (
            <table>
              <thead><tr><th>{t('events.level')}</th><th>{t('events.source')}</th><th>{t('events.id')}</th><th>{t('events.message')}</th><th>{t('common.time')}</th></tr></thead>
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
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.reportsAs')}</dt><dd title={t('sd.reportsAsTitle')}>{server.hostname}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.ip')}</dt><dd>{server.ip_address || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.os')}</dt><dd>{server.os_info || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.customer')}</dt><dd>{server.customer_name || '—'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.group')}</dt><dd>{server.group_name || '-'}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.status')}:</dt><dd><span className="status"><span className={`status-dot ${server.status}`} />{server.status}</span></dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.lastSeen')}</dt><dd>{server.last_seen || t('common.never')}</dd>
            <dt style={{ color: 'var(--text-muted)' }}>{t('sd.registered')}</dt><dd>{new Date(server.created_at).toLocaleString()}</dd>
          </dl>
        </div>
      )}

      {tab === 'health' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{t('sd.health')}</h3>
            {server.pending_reboot ? <span className="badge badge-warning">{t('sd.rebootPending')}</span> : <span className="badge badge-viewer">{t('sd.noReboot')}</span>}
            {server.health_at && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sd.updated', { t: new Date(server.health_at).toLocaleString() })}</span>}
          </div>
          {!server.health_at ? (
            <div className="empty"><p>{t('sd.noHealth')}</p></div>
          ) : health.length === 0 ? (
            <div className="empty"><p>{t('sd.allHealthy')}</p></div>
          ) : (
            <table>
              <thead><tr><th>{t('sd.hType')}</th><th>{t('sd.hItem')}</th><th>{t('sd.hDetail')}</th></tr></thead>
              <tbody>
                {health.map(h => (
                  <tr key={h.id}>
                    <td>
                      <span className={`badge ${h.kind === 'service_stopped' ? 'badge-error' : h.kind === 'cert_expiring' ? 'badge-warning' : 'badge-error'}`}>
                        {h.kind === 'service_stopped' ? t('sd.svcDown') : h.kind === 'cert_expiring' ? t('sd.certExp') : t('sd.taskFailed')}
                      </span>
                    </td>
                    <td>{h.name || '-'}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {h.kind === 'cert_expiring' && h.expires_at ? t('sd.expires', { d: new Date(h.expires_at).toLocaleDateString() }) : (h.detail || '-')}
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
            <h3 style={{ margin: 0 }}>{t('sd.inventory')}</h3>
            {server.inventory_at && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sd.updated', { t: new Date(server.inventory_at).toLocaleString() })}</span>}
          </div>
          {!inventory ? (
            <div className="empty"><p>{t('common.loading')}</p></div>
          ) : !server.inventory_at ? (
            <div className="empty"><p>{t('sd.noInventory')}</p></div>
          ) : (
            <>
              {inventory.hardware && (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 24 }}>
                  {[
                    [t('sd.iManuf'), inventory.hardware.manufacturer],
                    [t('sd.iModel'), inventory.hardware.model],
                    [t('sd.iSerial'), inventory.hardware.serial],
                    [t('sd.iOs'), `${inventory.hardware.os_caption || ''} ${inventory.hardware.os_build ? '(build ' + inventory.hardware.os_build + ')' : ''}`.trim()],
                    ['CPU', inventory.hardware.cpu],
                    [t('sd.iCores'), `${inventory.hardware.cpu_cores || '?'} / ${inventory.hardware.cpu_logical || '?'}`],
                    [t('sd.iRam'), inventory.hardware.ram_gb ? `${inventory.hardware.ram_gb} GB` : '-'],
                    [t('sd.iDisks'), (inventory.hardware.disks || []).map(d => `${d.model || 'disk'} ${d.size_gb ? d.size_gb + ' GB' : ''}`.trim()).join('; ') || '-'],
                  ].map(([k, v]) => (
                    <div key={k} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4, color: 'var(--text-muted)' }}>{k}</div>
                      <div style={{ fontSize: 14, marginTop: 3, wordBreak: 'break-word' }}>{v || '-'}</div>
                    </div>
                  ))}
                </div>
              )}

              {inventory.hardware && (() => {
                const lp = inventory.hardware.last_patch_date;
                const days = lp ? Math.floor((Date.now() - new Date(lp).getTime()) / 86400000) : null;
                const col = days == null ? 'var(--text-muted)' : days > 60 ? 'var(--danger)' : days > 35 ? 'var(--warning)' : 'var(--success, #22c55e)';
                const hf = inventory.hardware.hotfixes || [];
                return (
                  <div style={{ marginBottom: 24 }}>
                    <h4 style={{ margin: '0 0 10px' }}>{t('sd.patches')}</h4>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', marginBottom: 10 }}>
                      <span style={{ fontSize: 15 }}>{t('sd.lastInstalled')}</span>
                      <strong style={{ color: col }}>{lp ? new Date(lp).toLocaleDateString() : t('sd.unknown')}</strong>
                      {days != null && <span style={{ color: col, fontSize: 13 }}>{t('sd.daysAgo', { n: days, behind: days > 35 ? t('sd.behind') : '' })}</span>}
                    </div>
                    {hf.length > 0 && (
                      <details>
                        <summary style={{ cursor: 'pointer', color: 'var(--text-muted)', fontSize: 13 }}>{t('sd.hotfixes', { n: hf.length })}</summary>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                          {hf.map((h, i) => (
                            <span key={i} style={{ fontSize: 12, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px' }} title={h.installed_on || ''}>
                              {h.id}{h.installed_on ? ` · ${h.installed_on}` : ''}
                            </span>
                          ))}
                        </div>
                      </details>
                    )}
                  </div>
                );
              })()}

              <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
                <h4 style={{ margin: 0 }}>{t('sd.installedSw', { n: inventory.software.length })}</h4>
                <input placeholder={t('sd.filter')} value={swFilter} onChange={e => setSwFilter(e.target.value)} style={{ width: 200, marginLeft: 'auto' }} />
              </div>
              {inventory.software.length === 0 ? (
                <div className="empty"><p>{t('sd.noSw')}</p></div>
              ) : (
                <div style={{ maxHeight: 480, overflowY: 'auto' }}>
                  <table>
                    <thead><tr><th>{t('sd.swName')}</th><th>{t('sd.swVer')}</th><th>{t('sd.swPub')}</th></tr></thead>
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

      {tab === 'processes' && (
        <div className="card">
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0 }}>{t('sd.topProc')}</h3>
            {server.processes_at && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sd.updated', { t: new Date(server.processes_at).toLocaleString() })}</span>}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              <button className={procSort === 'cpu' ? '' : 'secondary'} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setProcSort('cpu')}>{t('sd.byCpu')}</button>
              <button className={procSort === 'mem' ? '' : 'secondary'} style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setProcSort('mem')}>{t('sd.byRam')}</button>
              <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={loadProcesses}>↻</button>
            </div>
          </div>
          {!processes ? (
            <div className="empty"><p>{t('common.loading')}</p></div>
          ) : !server.processes_at ? (
            <div className="empty"><p>{t('sd.noProcData')}</p></div>
          ) : processes.length === 0 ? (
            <div className="empty"><p>{t('sd.noProc')}</p></div>
          ) : (
            <table>
              <thead><tr><th>{t('sd.pProc')}</th><th>{t('sd.pPid')}</th><th>{t('sd.pCpu')}</th><th>{t('sd.pRam')}</th></tr></thead>
              <tbody>
                {[...processes].sort((a, b) => procSort === 'cpu' ? b.cpu_pct - a.cpu_pct : b.mem_mb - a.mem_mb).map((p, i) => (
                  <tr key={i}>
                    <td><strong>{p.name}</strong></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{p.pid || '-'}</td>
                    <td style={{ color: p.cpu_pct >= 50 ? 'var(--danger)' : p.cpu_pct >= 20 ? 'var(--warning)' : 'inherit' }}>{p.cpu_pct?.toFixed(1)}</td>
                    <td>{p.mem_mb?.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {tab === 'agent' && (
        <div className="card">
          <h3>{t('sd.agentConfig')}</h3>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>{t('sd.agentToken')}</label>
            <div className="script-container" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <code style={{ flex: 1, wordBreak: 'break-all' }}>{token || t('common.loading')}</code>
            </div>
          </div>
          <div className="form-actions">
            {token && <button className="secondary" onClick={regenerateToken}>{t('sd.regenToken')}</button>}
            <button onClick={loadScript}>{t('sd.showScript')}</button>
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
          <h3>{t('sd.remoteControl')}</h3>
          <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>
            {t('sd.controlNote')}
          </p>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}>
            <div style={{ flex: '1 1 220px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('sd.svcName')}</label>
              <input value={svc} onChange={e => setSvc(e.target.value)} placeholder="e.g. MSSQLSERVER, Spooler, W3SVC" />
            </div>
            <button onClick={doRestartService}>{t('sd.restartSvc')}</button>
            <button className="secondary" onClick={doForceUpdate}>{t('sd.forceUpdate')}</button>
            <button className="danger" onClick={doReboot}>{t('sd.reboot')}</button>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 16 }}>
            <div style={{ fontSize: 13, marginBottom: 8 }}><b>{t('sd.incident')}</b> <span style={{ color: 'var(--text-muted)' }}>— agent v2.24+</span></div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="secondary" onClick={() => doScan('quick')}>{t('sd.quickScan')}</button>
              <button className="secondary" onClick={() => doScan('full')}>{t('sd.fullScan')}</button>
              <button className="secondary" onClick={doKillProcess}>{t('sd.killProc')}</button>
              <button className="danger" onClick={doIsolate}>{t('sd.isolate')}</button>
              <button className="secondary" onClick={doUnisolate}>{t('sd.liftIso')}</button>
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
              {t('sd.isoNote')}
            </div>
          </div>
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginTop: 4 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>{t('sd.stopMon')}</div>
            <button className="danger" onClick={doUninstall}>{t('sd.uninstall')}</button>
          </div>

          <h3 style={{ margin: '16px 0 8px' }}>{t('sd.recentCmds')}</h3>
          {commands.length === 0 ? (
            <div className="empty"><p>{t('sd.noCmds')}</p></div>
          ) : (
            <table>
              <thead><tr><th>{t('common.time')}</th><th>{t('sd.cCmd')}</th><th>{t('common.status')}</th><th>{t('sd.cResult')}</th><th>{t('audit.by')}</th></tr></thead>
              <tbody>
                {commands.map(c => (
                  <tr key={c.id}>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(c.created_at).toLocaleString()}</td>
                    <td>{c.ctype === 'reboot' ? t('sd.cmdReboot') : c.ctype === 'block_ip' ? t('sd.cmdBlock', { ip: c.param }) : c.ctype === 'uninstall_agent' ? t('sd.cmdUninstall') : c.ctype === 'force_update' ? t('sd.cmdForce') : t('sd.cmdRestart', { svc: c.param })}</td>
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
          <h3 style={{ marginBottom: 8 }}>{t('sd.recentLogons')}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
            {t('sd.logonsNote')}
          </p>
          {secEvents.length === 0 ? (
            <div className="empty"><p>{t('sd.noSecEvents')}</p></div>
          ) : (
            <table>
              <thead><tr><th>{t('sd.sResult')}</th><th>{t('sd.sAccount')}</th><th>{t('sd.sSourceIp')}</th><th>{t('sd.sType')}</th><th>{t('common.time')}</th><th></th></tr></thead>
              <tbody>
                {secEvents.map(e => (
                  <tr key={e.id}>
                    <td><span className={`badge ${e.event === 'fail' ? 'badge-error' : 'badge-viewer'}`}>{e.event === 'fail' ? t('sd.fail') : t('sd.ok')}</span></td>
                    <td>{e.account || '-'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{e.ip || '-'}</td>
                    <td style={{ fontSize: 12 }}>{e.logon_type === '10' ? 'RDP' : e.logon_type}</td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(e.recorded_at || e.created_at).toLocaleString()}</td>
                    <td>{e.event === 'fail' && e.ip && e.ip !== '-' && <button className="danger" style={{ padding: '2px 10px', fontSize: 12 }} onClick={() => blockIp(e.ip)}>{t('sd.block')}</button>}</td>
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
