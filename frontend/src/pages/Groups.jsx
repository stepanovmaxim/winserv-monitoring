import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';

export default function Groups() {
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editGroup, setEditGroup] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });

  useEffect(() => { loadGroups(); }, []);

  async function loadGroups() {
    setLoading(true);
    api.getGroups().then(setGroups).finally(() => setLoading(false));
  }

  function openCreate() {
    setEditGroup(null);
    setForm({ name: '', description: '' });
    setShowModal(true);
  }

  function openEdit(g) {
    setEditGroup(g);
    setForm({ name: g.name, description: g.description || '' });
    setShowModal(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    if (editGroup) {
      await api.updateGroup(editGroup.id, form);
    } else {
      await api.createGroup(form);
    }
    setShowModal(false);
    loadGroups();
  }

  async function handleDelete(id) {
    if (!confirm('Delete this group? Servers in it will be ungrouped.')) return;
    await api.deleteGroup(id);
    loadGroups();
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Server Groups</h1>
        <button onClick={openCreate}>+ New Group</button>
      </div>

      <div className="card">
        {groups.length === 0 ? (
          <div className="empty"><div className="empty-icon">📁</div><p>No groups yet</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Description</th><th>Servers</th><th></th></tr></thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id}>
                  <td><Link to={`/servers?group_id=${g.id}`}><strong>{g.name}</strong></Link></td>
                  <td style={{ color: 'var(--text-muted)' }}>{g.description || '-'}</td>
                  <td>{g.server_count}</td>
                  <td>
                    <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(g)}>Edit</button>
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => handleDelete(g.id)}>Del</button>
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
            <h2>{editGroup ? 'Edit Group' : 'New Group'}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group"><label>Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="form-group"><label>Description</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
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
