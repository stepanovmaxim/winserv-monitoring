import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Maintenance() {
  const [windows, setWindows] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [servers, setServers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ scope_type: 'server', scope_id: '', duration_minutes: 60, reason: '' });

  function load() {
    return api.getMaintenance().then(setWindows);
  }

  useEffect(() => {
    Promise.all([
      load(),
      api.getCustomers().then(setCustomers),
      api.getGroups().then(setGroups),
      api.getServers().then(setServers),
    ]).finally(() => setLoading(false));
  }, []);

  const targets = form.scope_type === 'customer' ? customers.map(c => ({ id: c.id, label: c.name }))
    : form.scope_type === 'group' ? groups.map(g => ({ id: g.id, label: g.name }))
    : form.scope_type === 'server' ? servers.map(s => ({ id: s.id, label: s.hostname }))
    : [];

  async function submit(e) {
    e.preventDefault();
    if (form.scope_type !== 'global' && !form.scope_id) return;
    await api.createMaintenance({
      scope_type: form.scope_type,
      scope_id: form.scope_type === 'global' ? null : Number(form.scope_id),
      duration_minutes: Number(form.duration_minutes) || 60,
      reason: form.reason,
    });
    setForm({ ...form, scope_id: '', reason: '' });
    load();
  }

  async function cancel(id) {
    await api.deleteMaintenance(id);
    load();
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header"><h1>Maintenance</h1></div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8 }}>Mute alerts</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
          Suppress all alerts (including offline) for a server, group, customer, or the whole fleet during planned work.
        </p>
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scope</label>
            <select value={form.scope_type} onChange={e => setForm({ ...form, scope_type: e.target.value, scope_id: '' })}>
              <option value="server">Server</option>
              <option value="group">Group</option>
              <option value="customer">Customer</option>
              <option value="global">All servers</option>
            </select>
          </div>
          {form.scope_type !== 'global' && (
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Target</label>
              <select value={form.scope_id} onChange={e => setForm({ ...form, scope_id: e.target.value })} required>
                <option value="">Select...</option>
                {targets.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: '0 1 130px' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Minutes</label>
            <input type="number" min="5" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Reason</label>
            <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder="e.g. patching + reboot" />
          </div>
          <button type="submit">Mute</button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>Windows</h3>
        {windows.length === 0 ? (
          <div className="empty"><p>No maintenance windows</p></div>
        ) : (
          <table>
            <thead><tr><th>State</th><th>Scope</th><th>Target</th><th>From</th><th>To</th><th>Reason</th><th>By</th><th></th></tr></thead>
            <tbody>
              {windows.map(w => (
                <tr key={w.id}>
                  <td><span className={`badge ${w.active ? 'badge-warning' : 'badge-viewer'}`}>{w.active ? 'ACTIVE' : 'scheduled/ended'}</span></td>
                  <td>{w.scope_type}</td>
                  <td>{w.scope_name || '-'}</td>
                  <td style={{ fontSize: 12 }}>{new Date(w.starts_at).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{new Date(w.ends_at).toLocaleString()}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{w.reason || '-'}</td>
                  <td style={{ fontSize: 12 }}>{w.created_by || '-'}</td>
                  <td><button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => cancel(w.id)}>Cancel</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
