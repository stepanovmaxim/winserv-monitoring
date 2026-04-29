import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Servers() {
  const { user } = useAuth();
  const [searchParams] = useSearchParams();
  const [servers, setServers] = useState([]);
  const [groups, setGroups] = useState([]);
  const [selectedGroup, setSelectedGroup] = useState(searchParams.get('group_id') || '');
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editServer, setEditServer] = useState(null);
  const [form, setForm] = useState({ hostname: '', description: '', ip_address: '', group_id: '', os_info: '', notify_cpu: true, notify_memory: true, notify_disk: true });

  useEffect(() => { api.getGroups().then(setGroups); }, []);

  useEffect(() => {
    setLoading(true);
    api.getServers(selectedGroup || undefined).then(setServers).finally(() => setLoading(false));
  }, [selectedGroup]);

  function openCreate() {
    setEditServer(null);
    setForm({ hostname: '', description: '', ip_address: '', group_id: '', os_info: '', notify_cpu: true, notify_memory: true, notify_disk: true });
    setShowModal(true);
  }

  function openEdit(s) {
    setEditServer(s);
    setForm({
      hostname: s.hostname, description: s.description || '', ip_address: s.ip_address || '',
      group_id: s.group_id || '', os_info: s.os_info || '',
      notify_cpu: s.notify_cpu !== 0, notify_memory: s.notify_memory !== 0, notify_disk: s.notify_disk !== 0,
    });
    setShowModal(true);
  }

  function openEdit(s) {
    setEditServer(s);
    setForm({ hostname: s.hostname, description: s.description || '', ip_address: s.ip_address || '', group_id: s.group_id || '', os_info: s.os_info || '' });
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
    api.getServers(selectedGroup || undefined).then(setServers).finally(() => setLoading(false));
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

      <div className="card">
        {servers.length === 0 ? (
          <div className="empty"><div className="empty-icon">🖥</div><p>No servers yet. Add one to get started.</p></div>
        ) : (
          <table>
            <thead><tr><th>Status</th><th>Hostname</th><th>Group</th><th>Description</th><th>IP</th><th>OS</th><th>Last Seen</th><th></th></tr></thead>
            <tbody>
              {servers.map(s => (
                <tr key={s.id}>
                  <td><span className="status"><span className={`status-dot ${s.status}`} />{s.status}</span></td>
                  <td><Link to={`/servers/${s.id}`}>{s.hostname}</Link></td>
                  <td>{s.group_name || '-'}</td>
                  <td style={{ color: 'var(--text-muted)', maxWidth: 150, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description || '-'}</td>
                  <td>{s.ip_address || '-'}</td>
                  <td>{s.os_info || '-'}</td>
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
