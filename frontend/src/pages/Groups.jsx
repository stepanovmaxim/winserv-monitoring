import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Groups() {
  const { t } = useLang();
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
    setForm({ name: '', description: '', cpu_threshold: '', memory_threshold: '', disk_threshold: '' });
    setShowModal(true);
  }

  function openEdit(g) {
    setEditGroup(g);
    setForm({ name: g.name, description: g.description || '', cpu_threshold: g.cpu_threshold ?? '', memory_threshold: g.memory_threshold ?? '', disk_threshold: g.disk_threshold ?? '' });
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
    if (!confirm(t('groups.deleteConfirm'))) return;
    await api.deleteGroup(id);
    loadGroups();
  }

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('groups.title')}</h1>
        <button onClick={openCreate}>{t('groups.new')}</button>
      </div>

      <div className="card">
        {groups.length === 0 ? (
          <div className="empty"><div className="empty-icon">📁</div><p>{t('groups.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('common.name')}</th><th>{t('common.description')}</th><th>{t('groups.servers')}</th><th></th></tr></thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.id}>
                  <td><Link to={`/servers?group_id=${g.id}`}><strong>{g.name}</strong></Link></td>
                  <td style={{ color: 'var(--text-muted)' }}>{g.description || '-'}</td>
                  <td>{g.server_count}</td>
                  <td>
                    <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(g)}>{t('common.edit')}</button>
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => handleDelete(g.id)}>{t('common.del')}</button>
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
            <h2>{editGroup ? t('groups.editTitle') : t('groups.newTitle')}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group"><label>{t('common.name')} *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="form-group"><label>{t('common.description')}</label><textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} rows={2} /></div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>{t('groups.thresholds')}</label>
              <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>CPU &gt;</label><input type="number" min="1" max="100" placeholder={t('common.inherit')} value={form.cpu_threshold} onChange={e => setForm({ ...form, cpu_threshold: e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Mem &gt;</label><input type="number" min="1" max="100" placeholder={t('common.inherit')} value={form.memory_threshold} onChange={e => setForm({ ...form, memory_threshold: e.target.value })} /></div>
                <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Disk &gt;</label><input type="number" min="1" max="100" placeholder={t('common.inherit')} value={form.disk_threshold} onChange={e => setForm({ ...form, disk_threshold: e.target.value })} /></div>
              </div>
              <div className="form-actions">
                <button type="submit">{t('common.save')}</button>
                <button type="button" className="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
