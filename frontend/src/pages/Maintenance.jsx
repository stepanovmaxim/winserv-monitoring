import { useState, useEffect } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Maintenance() {
  const { t } = useLang();
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

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header"><h1>{t('mnt.title')}</h1></div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3 style={{ marginBottom: 8 }}>{t('mnt.mute')}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{t('mnt.desc')}</p>
        <form onSubmit={submit} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 140px' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('mnt.scope')}</label>
            <select value={form.scope_type} onChange={e => setForm({ ...form, scope_type: e.target.value, scope_id: '' })}>
              <option value="server">{t('mnt.s.server')}</option>
              <option value="group">{t('mnt.s.group')}</option>
              <option value="customer">{t('mnt.s.customer')}</option>
              <option value="global">{t('mnt.s.global')}</option>
            </select>
          </div>
          {form.scope_type !== 'global' && (
            <div style={{ flex: '1 1 180px' }}>
              <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('common.target')}</label>
              <select value={form.scope_id} onChange={e => setForm({ ...form, scope_id: e.target.value })} required>
                <option value="">{t('common.select')}</option>
                {targets.map(tg => <option key={tg.id} value={tg.id}>{tg.label}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: '0 1 130px' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('mnt.minutes')}</label>
            <input type="number" min="5" value={form.duration_minutes} onChange={e => setForm({ ...form, duration_minutes: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 200px' }}>
            <label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('mnt.reason')}</label>
            <input value={form.reason} onChange={e => setForm({ ...form, reason: e.target.value })} placeholder={t('mnt.reasonPh')} />
          </div>
          <button type="submit">{t('mnt.muteBtn')}</button>
        </form>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 16 }}>{t('mnt.windows')}</h3>
        {windows.length === 0 ? (
          <div className="empty"><p>{t('mnt.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('mnt.state')}</th><th>{t('mnt.scope')}</th><th>{t('common.target')}</th><th>{t('mnt.from')}</th><th>{t('mnt.to')}</th><th>{t('mnt.reason')}</th><th>{t('mnt.by')}</th><th></th></tr></thead>
            <tbody>
              {windows.map(w => (
                <tr key={w.id}>
                  <td><span className={`badge ${w.active ? 'badge-warning' : 'badge-viewer'}`}>{w.active ? t('mnt.active') : t('mnt.scheduled')}</span></td>
                  <td>{w.scope_type}</td>
                  <td>{w.scope_name || '-'}</td>
                  <td style={{ fontSize: 12 }}>{new Date(w.starts_at).toLocaleString()}</td>
                  <td style={{ fontSize: 12 }}>{new Date(w.ends_at).toLocaleString()}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{w.reason || '-'}</td>
                  <td style={{ fontSize: 12 }}>{w.created_by || '-'}</td>
                  <td><button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => cancel(w.id)}>{t('common.cancel')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
