import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Servers() {
  const { user } = useAuth();
  const [servers, setServers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState('');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState({ hostname: '', ip_address: '', group_id: '', os_info: '' });
  const [showToken, setShowToken] = useState(null);

  useEffect(() => { api.getGroups().then(setGroups); }, []);

  useEffect(() => {
    setLoading(true);
    api.getServers(selectedGroup || undefined).then(setServers).finally(() => setLoading(false));
  }, [selectedGroup]);

  async function handleCreate(e) {
    e.preventDefault();
    const data = await api.createServer(form);
    setServers(prev => [...prev, { ...form, id: data.id, status: 'unknown', group_name: groups.find(g => g.id == form.group_id)?.name }]);
    setShowToken(data.token);
    setShowModal(false);
    setForm({ hostname: '', ip_address: '', group_id: '', os_info: '' });
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
        <div style={{ display: 'flex', gap: 8 }}>
          <select value={selectedGroup} onChange={e => setSelectedGroup(e.target.value)}>
            <option value="">All Groups</option>
            {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          {user?.role === 'admin' && <button onClick={() => setShowModal(true)}>+ Add Server</button>}
        </div>
      </div>

      {showToken && (
        <div className="card" style={{ marginBottom: 16, border: '1px solid var(--primary)' }}>
          <strong>Agent Token (save it!):</strong>
          <div className="script-container"><pre>{showToken}</pre></div>
          <button onClick={() => setShowToken(null)}>OK</button>
        </div>
      )}

      <div className="card">
        {servers.length === 0 ? (
          <div className="empty"><div className="empty-icon">🖥</div><p>No servers yet. Add one to get started.</p></div>
        ) : (
          <table>
            <thead><tr><th>Status</th><th>Hostname</th><th>Group</th><th>IP</th><th>OS</th><th>Last Seen</th><th></th></tr></thead>
            <tbody>
              {servers.map(s => (
                <tr key={s.id}>
                  <td><span className="status"><span className={`status-dot ${s.status}`} />{s.status}</span></td>
                  <td><Link to={`/servers/${s.id}`}>{s.hostname}</Link></td>
                  <td>{s.group_name || '-'}</td>
                  <td>{s.ip_address || '-'}</td>
                  <td>{s.os_info || '-'}</td>
                  <td>{s.last_seen || 'Never'}</td>
                  <td>
                    {user?.role === 'admin' && (
                      <button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => handleDelete(s.id)}>Del</button>
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
            <h2>Add Server</h2>
            <form onSubmit={handleCreate}>
              <div className="form-group"><label>Hostname *</label><input value={form.hostname} onChange={e => setForm({ ...form, hostname: e.target.value })} required /></div>
              <div className="form-group"><label>IP Address</label><input value={form.ip_address} onChange={e => setForm({ ...form, ip_address: e.target.value })} /></div>
              <div className="form-group"><label>Group</label><select value={form.group_id} onChange={e => setForm({ ...form, group_id: e.target.value })}><option value="">None</option>{groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></div>
              <div className="form-group"><label>OS Info</label><input value={form.os_info} onChange={e => setForm({ ...form, os_info: e.target.value })} /></div>
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
