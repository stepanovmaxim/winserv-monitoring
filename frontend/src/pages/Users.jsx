import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Users() {
  const [users, setUsers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);   // user whose access is being edited
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { loadAll(); }, []);

  function loadAll() {
    setLoading(true);
    Promise.all([
      api.getUsers().then(setUsers),
      api.getCustomers().then(setCustomers).catch(() => setCustomers([])),
    ]).finally(() => setLoading(false));
  }

  async function handleRoleChange(id, role) {
    await api.setUserRole(id, role);
    loadAll();
  }

  function openAccess(u) {
    setEditing(u);
    setPicked((u.customer_ids || []).map(Number));
    setError('');
  }

  function toggle(cid) {
    setPicked(p => (p.includes(cid) ? p.filter(x => x !== cid) : [...p, cid]));
  }

  async function saveAccess() {
    setSaving(true);
    setError('');
    try {
      await api.setUserCustomers(editing.id, picked);
      setEditing(null);
      loadAll();
    } catch (e) {
      setError(e.message);
    }
    setSaving(false);
  }

  const nameOf = (cid) => (customers.find(c => c.id === cid) || {}).name || `#${cid}`;

  function accessCell(u) {
    const ids = (u.customer_ids || []).map(Number);
    if (u.role === 'pending') return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
    if (!ids.length) return <span style={{ fontSize: 12, color: 'var(--warning)' }}>All customers</span>;
    return (
      <span style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
        {ids.map(cid => (
          <span key={cid} style={{ fontSize: 11, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '2px 7px' }}>
            {nameOf(cid)}
          </span>
        ))}
      </span>
    );
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header"><h1>Users</h1></div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          <b>Role</b> sets what a user may do (admin manages, viewer only reads). <b>Access</b> sets which customers
          they see — assign one or more to scope an administrator to those companies only. A user with no assignment
          keeps access to <b>all</b> customers, so nothing changes for your existing accounts.
        </p>
      </div>

      <div className="card">
        {users.length === 0 ? (
          <div className="empty"><div className="empty-icon">👥</div><p>No users yet</p></div>
        ) : (
          <table>
            <thead><tr><th>User</th><th>Email</th><th>Role</th><th>Access</th><th>Registered</th><th></th></tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id}>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {u.avatar_url && <img src={u.avatar_url} alt="" style={{ width: 28, height: 28, borderRadius: '50%' }} />}
                      {u.name}
                    </div>
                  </td>
                  <td>{u.email}</td>
                  <td><span className={`badge badge-${u.role}`}>{u.role}</span></td>
                  <td>{accessCell(u)}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <select
                      value={u.role}
                      onChange={e => handleRoleChange(u.id, e.target.value)}
                      style={{ width: 110, padding: '4px 8px', fontSize: 12 }}
                    >
                      <option value="admin">Admin</option>
                      <option value="viewer">Viewer</option>
                      <option value="pending">Pending</option>
                    </select>
                    {u.role !== 'pending' && (
                      <button className="secondary" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 6 }} onClick={() => openAccess(u)}>Access</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>Customer access — {editing.name || editing.email}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>
              Tick the companies this user may see. Leave everything unticked to grant access to <b>all</b> customers.
              Servers that aren't assigned to any customer stay visible only to unrestricted users.
            </p>

            {customers.length === 0 ? (
              <div className="empty"><p>No customers defined yet</p></div>
            ) : (
              <div style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
                {customers.map(c => (
                  <label key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 2px', cursor: 'pointer' }}>
                    <input type="checkbox" checked={picked.includes(c.id)} onChange={() => toggle(c.id)}
                      style={{ width: 16, height: 16, flex: '0 0 auto', margin: 0 }} />
                    <span>{c.name}</span>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>{c.server_count} servers</span>
                  </label>
                ))}
              </div>
            )}

            <p style={{ fontSize: 12, color: picked.length ? 'var(--text-muted)' : 'var(--warning)', marginTop: 10 }}>
              {picked.length
                ? `Restricted to ${picked.length} customer(s).`
                : 'No restriction — this user will see all customers.'}
            </p>
            {error && <p style={{ color: 'var(--danger)', fontSize: 13 }}>{error}</p>}

            <div className="form-actions">
              <button type="button" onClick={saveAccess} disabled={saving}>Save</button>
              <button type="button" className="secondary" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
