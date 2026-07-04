import { useState, useEffect } from 'react';
import { api } from '../api';

const EMPTY = { server_id: '', label: '', file_path: '', logout_users: true, allowed_chats: '', schedule_enabled: false, schedule_hide: '', schedule_show: '' };

export default function Actions() {
  const [actions, setActions] = useState([]);
  const [servers, setServers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editing, setEditing] = useState(null);
  const [bulk, setBulk] = useState({ scope: 'all', scope_id: '' });

  useEffect(() => {
    Promise.all([api.getServers(), loadActions(), api.getGroups(), api.getCustomers()])
      .then(([s, , g, c]) => { setServers(s); setGroups(g); setCustomers(c); });
  }, []);

  async function runBulk(action) {
    if (bulk.scope !== 'all' && !bulk.scope_id) return alert('Select a target');
    const r = await api.bulkAction(bulk.scope, bulk.scope === 'all' ? null : Number(bulk.scope_id), action);
    alert(`${action === 'hide' ? 'Hidden' : 'Shown'} ${r.affected} action(s). Agents apply within 1 min.`);
    loadActions();
  }

  async function loadActions() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/actions', { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    setActions(data);
    setLoading(false);
  }

  async function toggleAction(id) {
    const token = localStorage.getItem('token');
    await fetch(`/api/actions/${id}/toggle`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    loadActions();
  }

  async function deleteAction(id) {
    if (!confirm('Delete?')) return;
    const token = localStorage.getItem('token');
    await fetch(`/api/actions/${id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    loadActions();
  }

  async function handleSave(e) {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (editing) {
      await fetch(`/api/actions/${editing}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
    } else {
      await fetch('/api/actions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(form),
      });
    }
    setShowModal(false);
    setEditing(null);
    setForm(EMPTY);
    loadActions();
  }

  function openEdit(a) {
    setEditing(a.id);
    setForm({ server_id: a.server_id, label: a.label || '', file_path: a.file_path, logout_users: !!a.logout_users, allowed_chats: a.allowed_chats || '', schedule_enabled: !!a.schedule_enabled, schedule_hide: a.schedule_hide || '', schedule_show: a.schedule_show || '' });
    setShowModal(true);
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Server Actions</h1>
        <button onClick={() => { setEditing(null); setForm(EMPTY); setShowModal(true); }}>+ Add Action</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 8 }}>Bulk hide / show</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Scope</label>
            <select value={bulk.scope} onChange={e => setBulk({ scope: e.target.value, scope_id: '' })}>
              <option value="all">All servers</option>
              <option value="customer">Customer</option>
              <option value="group">Group</option>
            </select>
          </div>
          {bulk.scope !== 'all' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Target</label>
              <select value={bulk.scope_id} onChange={e => setBulk({ ...bulk, scope_id: e.target.value })}>
                <option value="">Select...</option>
                {(bulk.scope === 'customer' ? customers : groups).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <button style={{ background: 'var(--danger)' }} onClick={() => runBulk('hide')}>Hide all</button>
          <button style={{ background: 'var(--success)' }} onClick={() => runBulk('show')}>Show all</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>
          Configure file rename actions on servers. The agent will execute them on the next check-in (within 1 minute).
          The file is renamed with a <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>~name.old</code> suffix to hide it.
          When <b>Logout users</b> is enabled, all active sessions are logged off after hiding the file.
        </p>
      </div>

      <div className="card">
        {actions.length === 0 ? (
          <div className="empty"><p>No actions configured</p></div>
        ) : (
          <table>
            <thead><tr><th>Server</th><th>Label</th><th>File path</th><th>State</th><th>Schedule</th><th>Logout</th><th></th></tr></thead>
            <tbody>
              {actions.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.hostname}</strong></td>
                  <td>{a.label || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.file_path}</td>
                  <td>
                    <span className={`badge ${a.enabled ? 'badge-error' : 'badge-viewer'}`}>
                      {a.enabled ? 'HIDDEN' : 'VISIBLE'}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{a.schedule_enabled ? `🕐 ${a.schedule_hide || '—'} / ${a.schedule_show || '—'}` : '-'}</td>
                  <td>{a.logout_users ? 'Yes' : 'No'}</td>
                  <td>
                    <button
                      onClick={() => toggleAction(a.id)}
                      style={{ padding: '4px 12px', fontSize: 12, background: a.enabled ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {a.enabled ? 'Show' : 'Hide'}
                    </button>
                    <button style={{ padding: '4px 8px', fontSize: 12, marginLeft: 4 }} onClick={() => openEdit(a)}>Edit</button>
                    <button className="danger" style={{ padding: '4px 8px', fontSize: 12, marginLeft: 4 }} onClick={() => deleteAction(a.id)}>Del</button>
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
            <h2>{editing ? 'Edit Action' : 'Add Action'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>Server *</label>
                <select value={form.server_id} onChange={e => setForm({ ...form, server_id: e.target.value })} required>
                  <option value="">Select...</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.hostname}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>Label</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder="e.g. 1C Database v8i" />
              </div>
              <div className="form-group">
                <label>File path *</label>
                <input value={form.file_path} onChange={e => setForm({ ...form, file_path: e.target.value })} placeholder="C:\share\1cv8.cfg" required />
              </div>
              <div className="form-group">
                <label>Bot Chat IDs (who can toggle via Telegram)</label>
                <input value={form.allowed_chats || ''} onChange={e => setForm({ ...form, allowed_chats: e.target.value })} placeholder="123456,789012 (empty = admin only)" />
              </div>
              <div className="toggle-wrapper" onClick={() => setForm({ ...form, logout_users: !form.logout_users })} style={{ marginBottom: 16 }}>
                <div className={`toggle ${form.logout_users ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>Logout users after hiding</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setForm({ ...form, schedule_enabled: !form.schedule_enabled })} style={{ marginBottom: 12 }}>
                <div className={`toggle ${form.schedule_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>Daily schedule (server local time)</label>
              </div>
              {form.schedule_enabled && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Hide at (HH:MM)</label><input value={form.schedule_hide} onChange={e => setForm({ ...form, schedule_hide: e.target.value })} placeholder="23:00" /></div>
                  <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Show at (HH:MM)</label><input value={form.schedule_show} onChange={e => setForm({ ...form, schedule_show: e.target.value })} placeholder="07:00" /></div>
                </div>
              )}
              <div className="form-actions">
                <button type="submit">Create</button>
                <button type="button" className="secondary" onClick={() => setShowModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
