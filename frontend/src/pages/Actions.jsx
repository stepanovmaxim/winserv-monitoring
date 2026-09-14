import { useState, useEffect } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

const EMPTY = { server_id: '', label: '', file_path: '', logout_users: true, allowed_chats: '', schedule_enabled: false, schedule_hide: '', schedule_show: '' };

export default function Actions() {
  const { t } = useLang();
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
    if (bulk.scope !== 'all' && !bulk.scope_id) return alert(t('act.selectTarget'));
    const r = await api.bulkAction(bulk.scope, bulk.scope === 'all' ? null : Number(bulk.scope_id), action);
    alert(t('act.bulkDone', { verb: action === 'hide' ? t('act.hidden') : t('act.shown'), n: r.affected }));
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
    if (!confirm(t('act.deleteConfirm'))) return;
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

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('act.title')}</h1>
        <button onClick={() => { setEditing(null); setForm(EMPTY); setShowModal(true); }}>{t('act.add')}</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ marginBottom: 8 }}>{t('act.bulk')}</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('mnt.scope')}</label>
            <select value={bulk.scope} onChange={e => setBulk({ scope: e.target.value, scope_id: '' })}>
              <option value="all">{t('act.s.all')}</option>
              <option value="customer">{t('mnt.s.customer')}</option>
              <option value="group">{t('mnt.s.group')}</option>
            </select>
          </div>
          {bulk.scope !== 'all' && (
            <div>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.target')}</label>
              <select value={bulk.scope_id} onChange={e => setBulk({ ...bulk, scope_id: e.target.value })}>
                <option value="">{t('common.select')}</option>
                {(bulk.scope === 'customer' ? customers : groups).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </div>
          )}
          <button style={{ background: 'var(--danger)' }} onClick={() => runBulk('hide')}>{t('act.hideAll')}</button>
          <button style={{ background: 'var(--success)' }} onClick={() => runBulk('show')}>{t('act.showAll')}</button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)', marginBottom: 12 }}>{t('act.desc')}</p>
      </div>

      <div className="card">
        {actions.length === 0 ? (
          <div className="empty"><p>{t('act.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('common.server')}</th><th>{t('act.label')}</th><th>{t('act.filepath')}</th><th>{t('act.state')}</th><th>{t('act.schedule')}</th><th>{t('act.logout')}</th><th></th></tr></thead>
            <tbody>
              {actions.map(a => (
                <tr key={a.id}>
                  <td><strong>{a.hostname}</strong></td>
                  <td>{a.label || '-'}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.file_path}</td>
                  <td>
                    <span className={`badge ${a.enabled ? 'badge-error' : 'badge-viewer'}`}>
                      {a.enabled ? t('act.hiddenBadge') : t('act.visibleBadge')}
                    </span>
                  </td>
                  <td style={{ fontSize: 12 }}>{a.schedule_enabled ? `🕐 ${a.schedule_hide || '—'} / ${a.schedule_show || '—'}` : '-'}</td>
                  <td>{a.logout_users ? t('common.yes') : t('common.no')}</td>
                  <td>
                    <button
                      onClick={() => toggleAction(a.id)}
                      style={{ padding: '4px 12px', fontSize: 12, background: a.enabled ? 'var(--success)' : 'var(--danger)' }}
                    >
                      {a.enabled ? t('act.show') : t('act.hide')}
                    </button>
                    <button style={{ padding: '4px 8px', fontSize: 12, marginLeft: 4 }} onClick={() => openEdit(a)}>{t('common.edit')}</button>
                    <button className="danger" style={{ padding: '4px 8px', fontSize: 12, marginLeft: 4 }} onClick={() => deleteAction(a.id)}>{t('common.del')}</button>
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
            <h2>{editing ? t('act.editTitle') : t('act.addTitle')}</h2>
            <form onSubmit={handleSave}>
              <div className="form-group">
                <label>{t('common.server')} *</label>
                <select value={form.server_id} onChange={e => setForm({ ...form, server_id: e.target.value })} required>
                  <option value="">{t('common.select')}</option>
                  {servers.map(s => <option key={s.id} value={s.id}>{s.hostname}</option>)}
                </select>
              </div>
              <div className="form-group">
                <label>{t('act.label')}</label>
                <input value={form.label} onChange={e => setForm({ ...form, label: e.target.value })} placeholder={t('act.labelPh')} />
              </div>
              <div className="form-group">
                <label>{t('act.filepath')} *</label>
                <input value={form.file_path} onChange={e => setForm({ ...form, file_path: e.target.value })} placeholder="C:\share\1cv8.cfg" required />
              </div>
              <div className="form-group">
                <label>{t('act.chats')}</label>
                <input value={form.allowed_chats || ''} onChange={e => setForm({ ...form, allowed_chats: e.target.value })} placeholder={t('act.chatsPh')} />
              </div>
              <div className="toggle-wrapper" onClick={() => setForm({ ...form, logout_users: !form.logout_users })} style={{ marginBottom: 16 }}>
                <div className={`toggle ${form.logout_users ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('act.logoutAfter')}</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setForm({ ...form, schedule_enabled: !form.schedule_enabled })} style={{ marginBottom: 12 }}>
                <div className={`toggle ${form.schedule_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('act.dailySchedule')}</label>
              </div>
              {form.schedule_enabled && (
                <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                  <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('act.hideAt')}</label><input value={form.schedule_hide} onChange={e => setForm({ ...form, schedule_hide: e.target.value })} placeholder="23:00" /></div>
                  <div style={{ flex: 1 }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('act.showAt')}</label><input value={form.schedule_show} onChange={e => setForm({ ...form, schedule_show: e.target.value })} placeholder="07:00" /></div>
                </div>
              )}
              <div className="form-actions">
                <button type="submit">{t('act.create')}</button>
                <button type="button" className="secondary" onClick={() => setShowModal(false)}>{t('common.cancel')}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
