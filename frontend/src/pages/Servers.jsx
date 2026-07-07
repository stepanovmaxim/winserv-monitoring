import { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Servers() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [servers, setServers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [latestAgent, setLatestAgent] = useState('');
  const [selectedGroup, setSelectedGroup] = useState(searchParams.get('group_id') || '');
  const [selectedCustomer, setSelectedCustomer] = useState(searchParams.get('customer_id') || '');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editServer, setEditServer] = useState(null);
  const [showToken, setShowToken] = useState(null);
  const [form, setForm] = useState({ hostname: '', description: '', ip_address: '', group_id: '', customer_id: '', os_info: '', notify_cpu: true, notify_memory: true, notify_disk: true });
  const [sortKey, setSortKey] = useState('hostname');
  const [sortDir, setSortDir] = useState('asc');

  function sortVal(s, key) {
    switch (key) {
      case 'status': return s.status || '';
      case 'customer': return (s.customer_name || '').toLowerCase();
      case 'group': return (s.group_name || '').toLowerCase();
      case 'cpu': return s.last_cpu != null ? Number(s.last_cpu) : -1;
      case 'memory': return s.last_mem_total > 0 ? Number(s.last_mem_used) / Number(s.last_mem_total) : -1;
      case 'disk': { const w = worstDisk(s); return w ? w.pct : -1; }
      case 'agent': return s.agent_version || '';
      case 'last_seen': return s.last_seen || '';
      default: return (s.hostname || '').toLowerCase();
    }
  }
  const sorted = useMemo(() => {
    return [...servers].sort((a, b) => {
      const va = sortVal(a, sortKey), vb = sortVal(b, sortKey);
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [servers, sortKey, sortDir]);
  function toggleSort(k) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(k); setSortDir('asc'); }
  }
  function Th({ k, children }) {
    return <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>{children}{sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}</th>;
  }
  const diskPct = (s) => (s.last_disk_used != null && s.last_disk_total > 0)
    ? Math.max(0, Math.min(100, Math.round(Number(s.last_disk_used) / Number(s.last_disk_total) * 100))) : null;
  // Fullest single disk — a full volume must show even if the total looks fine.
  function worstDisk(s) {
    let disks = s.last_disks;
    if (typeof disks === 'string') { try { disks = JSON.parse(disks); } catch { disks = []; } }
    let worst = null;
    if (Array.isArray(disks)) {
      for (const d of disks) {
        const t = Number(d.total_gb);
        if (!(t > 0)) continue;
        const pct = Math.max(0, Math.min(100, Math.round(Number(d.used_gb) / t * 100)));
        if (!worst || pct > worst.pct) worst = { pct, drive: d.drive || '' };
      }
    }
    if (worst) return worst;
    const p = diskPct(s);
    return p != null ? { pct: p, drive: '' } : null;
  }

  useEffect(() => {
    api.getGroups().then(setGroups);
    api.getCustomers().then(setCustomers);
    api.getAgentVersion().then(d => setLatestAgent(d.latest)).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    api.getServers(selectedGroup || undefined, selectedCustomer || undefined).then(setServers).finally(() => setLoading(false));
  }, [selectedGroup, selectedCustomer]);

  // Live updates: patch rows in place as agents check in or drop offline.
  useEffect(() => {
    const es = new EventSource(api.streamUrl());
    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      if (msg.type !== 'metrics' && msg.type !== 'status') return;
      setServers(prev => prev.map(s => {
        if (s.id !== msg.server_id) return s;
        if (msg.type === 'status') return { ...s, status: msg.status };
        return {
          ...s,
          status: msg.status || s.status,
          last_seen: msg.last_seen || s.last_seen,
          last_cpu: msg.cpu != null ? msg.cpu : s.last_cpu,
          last_mem_used: msg.mem_used_mb != null ? msg.mem_used_mb : s.last_mem_used,
          last_mem_total: msg.mem_total_mb != null ? msg.mem_total_mb : s.last_mem_total,
          last_disk_used: msg.disk_used_gb != null ? msg.disk_used_gb : s.last_disk_used,
          last_disk_total: msg.disk_total_gb != null ? msg.disk_total_gb : s.last_disk_total,
          last_disks: msg.disks != null ? msg.disks : s.last_disks,
        };
      }));
    };
    es.onerror = () => {}; // EventSource auto-reconnects
    return () => es.close();
  }, []);

  function openCreate() {
    setEditServer(null);
    setForm({ hostname: '', description: '', ip_address: '', group_id: '', customer_id: '', os_info: '', notify_cpu: true, notify_memory: true, notify_disk: true, cpu_threshold: '', memory_threshold: '', disk_threshold: '' });
    setShowModal(true);
  }

  function openEdit(s) {
    setEditServer(s);
    setForm({
      hostname: s.hostname, description: s.description || '', ip_address: s.ip_address || '',
      group_id: s.group_id || '', customer_id: s.customer_id || '', os_info: s.os_info || '',
      notify_cpu: s.notify_cpu !== 0, notify_memory: s.notify_memory !== 0, notify_disk: s.notify_disk !== 0,
      cpu_threshold: s.cpu_threshold ?? '', memory_threshold: s.memory_threshold ?? '', disk_threshold: s.disk_threshold ?? '',
    });
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (editServer) {
      await api.updateServer(editServer.id, form);
    } else {
      const data = await api.createServer(form);
      setShowToken(data.token);
    }
    setShowModal(false);
    setLoading(true);
    api.getServers(selectedGroup || undefined, selectedCustomer || undefined).then(setServers).finally(() => setLoading(false));
  }

  async function handleDelete(id) {
    if (!confirm('Delete this server?')) return;
    await api.deleteServer(id);
    setServers(prev => prev.filter(s => s.id !== id));
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Servers</h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)}>
            <option value="">All Customers</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            <option value="none">— Unassigned —</option>
          </select>
          <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
            <option value="">All Groups</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {user?.role === 'admin' && <button onClick={openCreate}>+ Add Server</button>}
        </div>
      </div>

      {showToken && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid var(--primary)' }}>
          <strong>Agent Token (save it!):</strong>
          <div className="script-container"><pre>{showToken}</pre></div>
          <button onClick={() => setShowToken(null)}>OK</button>
        </div>
      )}

      <div className="grid grid-3" style={{ marginBottom: 24 }}>
        <div className="card">
          <div className="metric-value">{servers.length}</div>
          <div className="metric-label">Total Servers</div>
        </div>
        <div className="card">
          <div className="metric-value" style={{ color: 'var(--success)' }}>{servers.filter(s => s.status === 'online').length}</div>
          <div className="metric-label">Online</div>
        </div>
        <div className="card">
          <div className="metric-value" style={{ color: 'var(--danger)' }}>{servers.filter(s => s.status === 'offline').length}</div>
          <div className="metric-label">Offline</div>
        </div>
      </div>

      <div className="card">
        {servers.length === 0 ? (
          <div className="empty"><div className="empty-icon">🖥</div><p>No servers yet. Add one to get started.</p></div>
        ) : (
          <table>
            <thead><tr>
              <Th k="status">Status</Th><Th k="hostname">Hostname</Th><Th k="customer">Customer</Th>
              <Th k="group">Group</Th><Th k="cpu">CPU</Th><Th k="memory">Memory</Th><Th k="disk">Disk</Th>
              <Th k="agent">Agent</Th><Th k="last_seen">Last Seen</Th><th></th>
            </tr></thead>
            <tbody>
              {sorted.map(s => (
                <tr key={s.id}>
                  <td><span className="status"><span className={`status-dot ${s.status}`} />{s.status}</span></td>
                  <td>
                    <Link to={`/servers/${s.id}`}>{s.hostname}</Link>
                    {s.health_issues > 0 && <span title="health issues" style={{ marginLeft: 6, color: 'var(--danger)', fontSize: 12 }}>⚠{s.health_issues}</span>}
                    {s.pending_reboot ? <span title="reboot pending" style={{ marginLeft: 4 }}>🔄</span> : null}
                  </td>
                  <td>{s.customer_name || <span style={{ color: 'var(--warning)' }}>—</span>}</td>
                  <td>{s.group_name || '-'}</td>
                  <td>{s.last_cpu != null ? `${Number(s.last_cpu).toFixed(0)}%` : '-'}</td>
                  <td>{s.last_mem_used != null && s.last_mem_total > 0 ? `${Math.round(Number(s.last_mem_used) / Number(s.last_mem_total) * 100)}%` : '-'}</td>
                  <td>{(() => { const w = worstDisk(s); if (!w) return '-'; return <span title={w.drive ? `fullest volume ${w.drive}` : ''} style={w.pct >= 90 ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>{w.pct}%{w.drive ? ` ${w.drive}` : ''}</span>; })()}</td>
                  <td>
                    {s.agent_version
                      ? <span className={`badge ${latestAgent && s.agent_version !== latestAgent ? 'badge-warning' : 'badge-viewer'}`}>v{s.agent_version}{latestAgent && s.agent_version !== latestAgent ? ' ⤴' : ''}</span>
                      : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td>{s.last_seen || 'Never'}</td>
                  <td>
                    {user?.role === 'admin' && (
                      <>
                        <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(s)}>Edit</button>
                        <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => handleDelete(s.id)}>Del</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editServer ? 'Edit Server' : 'Add Server'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group"><label>Hostname *</label><input value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })} required /></div>
              <div className="form-group"><label>Description</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. Primary domain controller" /></div>
              <div className="form-group"><label>IP Address</label><input value={form.ip_address} onChange={e => setForm({ ...form, ip_address: e.target.value })} /></div>
              <div className="form-group"><label>Customer</label><select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}><option value="">Unassigned</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="form-group"><label>Group</label><select value={form.group_id} onChange={e => setForm({ ...form, group_id: e.target.value })}><option value="">None</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
              <div className="form-group"><label>OS Info</label><input value={form.os_info} onChange={e => setForm({ ...form, os_info: e.target.value })} /></div>
              {editServer && (
                <>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>Alert Notifications</label>
                  <div style={{ display: 'flex', gap: 24, marginBottom: 16 }}>
                    <div className="toggle-wrapper" onClick={() => setForm({ ...form, notify_cpu: !form.notify_cpu })}>
                      <div className={`toggle ${form.notify_cpu ? 'on' : ''}`}><div className="toggle-knob" /></div>
                      <label style={{ cursor: 'pointer' }}>CPU</label>
                    </div>
                    <div className="toggle-wrapper" onClick={() => setForm({ ...form, notify_memory: !form.notify_memory })}>
                      <div className={`toggle ${form.notify_memory ? 'on' : ''}`}><div className="toggle-knob" /></div>
                      <label style={{ cursor: 'pointer' }}>Memory</label>
                    </div>
                    <div className="toggle-wrapper" onClick={() => setForm({ ...form, notify_disk: !form.notify_disk })}>
                      <div className={`toggle ${form.notify_disk ? 'on' : ''}`}><div className="toggle-knob" /></div>
                      <label style={{ cursor: 'pointer' }}>Disk</label>
                    </div>
                  </div>
                  <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>Threshold overrides (%) — empty inherits group / customer / global</label>
                  <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                    <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>CPU &gt;</label><input type="number" min="1" max="100" placeholder="inherit" value={form.cpu_threshold} onChange={e => setForm({ ...form, cpu_threshold: e.target.value })} /></div>
                    <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Memory &gt;</label><input type="number" min="1" max="100" placeholder="inherit" value={form.memory_threshold} onChange={e => setForm({ ...form, memory_threshold: e.target.value })} /></div>
                    <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Disk &gt;</label><input type="number" min="1" max="100" placeholder="inherit" value={form.disk_threshold} onChange={e => setForm({ ...form, disk_threshold: e.target.value })} /></div>
                  </div>
                </>
              )}
              <div className="form-actions">
                <button type="submit">Save</button>
                <button type="button" className="secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
