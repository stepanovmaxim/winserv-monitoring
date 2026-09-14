import { useState, useEffect } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Customers() {
  const { t } = useLang();
  const [customers, setCustomers] = useState([]);
  const [domainData, setDomainData] = useState({ mappings: [], domains: [] });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [mapForm, setMapForm] = useState({ domain: '', customer_id: '' });
  const [statusFor, setStatusFor] = useState(null);
  const [copied, setCopied] = useState(false);

  function loadAll() {
    return Promise.all([api.getCustomers(), api.getDomainMappings()]).then(([c, d]) => {
      setCustomers(c);
      setDomainData(d);
    });
  }

  useEffect(() => { loadAll().finally(() => setLoading(false)); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '', cpu_threshold: '', memory_threshold: '', disk_threshold: '' });
    setShowModal(true);
  }
  function openEdit(c) {
    setEditing(c.id);
    setForm({ name: c.name, description: c.description || '', cpu_threshold: c.cpu_threshold ?? '', memory_threshold: c.memory_threshold ?? '', disk_threshold: c.disk_threshold ?? '' });
    setShowModal(true);
  }

  async function saveCustomer(e) {
    e.preventDefault();
    if (editing) await api.updateCustomer(editing, form);
    else await api.createCustomer(form);
    setShowModal(false);
    loadAll();
  }

  async function removeCustomer(id) {
    if (!confirm(t('cst.deleteConfirm'))) return;
    await api.deleteCustomer(id);
    loadAll();
  }

  async function saveMapping(e) {
    e.preventDefault();
    if (!mapForm.domain || !mapForm.customer_id) return;
    const r = await api.setDomainMapping(mapForm.domain, Number(mapForm.customer_id));
    setMapForm({ domain: '', customer_id: '' });
    await loadAll();
    if (r.applied) alert(t('cst.mapApplied', { n: r.applied }));
  }

  async function removeMapping(domain) {
    await api.deleteDomainMapping(domain);
    loadAll();
  }

  async function updateStatusPage(opts) {
    const r = await api.setStatusPage(statusFor.id, opts);
    const updated = { ...statusFor, status_enabled: r.status_enabled, status_token: r.status_token };
    setStatusFor(updated);
    setCustomers(cs => cs.map(c => c.id === updated.id ? { ...c, status_enabled: r.status_enabled, status_token: r.status_token } : c));
  }
  const statusUrl = (c) => c && c.status_token ? `${window.location.origin}/status/${c.status_token}` : '';

  const mappedDomains = new Set(domainData.mappings.map(m => m.domain));
  const unmapped = domainData.domains.filter(d => !mappedDomains.has(d));

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('cst.title')}</h1>
        <button onClick={openCreate}>{t('cst.add')}</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        {customers.length === 0 ? (
          <div className="empty"><p>{t('cst.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('common.name')}</th><th>{t('common.description')}</th><th>{t('groups.servers')}</th><th>{t('common.status')}</th><th>{t('cst.publicPage')}</th><th></th></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td style={{ color: 'var(--text-muted)' }}>{c.description || '-'}</td>
                  <td>{c.server_count}</td>
                  <td><span className={`badge ${c.active ? 'badge-viewer' : 'badge-error'}`}>{c.active ? t('cst.active') : t('cst.inactive')}</span></td>
                  <td>
                    <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => { setStatusFor(c); setCopied(false); }}>
                      {c.status_enabled ? t('cst.on') : t('cst.off')}
                    </button>
                  </td>
                  <td>
                    <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(c)}>{t('common.edit')}</button>
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => removeCustomer(c.id)}>{t('common.del')}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>{t('cst.mapping')}</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>{t('cst.mapDesc')}</p>

        <form onSubmit={saveMapping} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <select value={mapForm.domain} onChange={e => setMapForm({ ...mapForm, domain: e.target.value })} style={{ flex: '1 1 200px' }} required>
            <option value="">{t('cst.selectDomain')}</option>
            {unmapped.map(d => <option key={d} value={d}>{d}</option>)}
            {mapForm.domain && mappedDomains.has(mapForm.domain) && <option value={mapForm.domain}>{mapForm.domain}</option>}
          </select>
          <select value={mapForm.customer_id} onChange={e => setMapForm({ ...mapForm, customer_id: e.target.value })} style={{ flex: '1 1 200px' }} required>
            <option value="">{t('cst.selectCustomer')}</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit">{t('cst.map')}</button>
        </form>

        {domainData.mappings.length === 0 ? (
          <div className="empty"><p>{t('cst.noMappings')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('cst.domain')}</th><th>{t('common.customer')}</th><th></th></tr></thead>
            <tbody>
              {domainData.mappings.map(m => (
                <tr key={m.domain}>
                  <td style={{ fontFamily: 'monospace' }}>{m.domain}</td>
                  <td>{m.customer_name || <span style={{ color: 'var(--danger)' }}>{t('cst.deleted')}</span>}</td>
                  <td><button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeMapping(m.domain)}>{t('cst.unmap')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {unmapped.length > 0 && (
          <p style={{ color: 'var(--warning)', marginTop: 12, fontSize: 13 }}>{t('cst.unmapped', { list: unmapped.join(', ') })}</p>
        )}
      </div>

      {statusFor && (
        <div className="modal-overlay" onClick={() => setStatusFor(null)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{t('cst.sp.title', { name: statusFor.name })}</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 16 }}>{t('cst.sp.desc')}</p>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, cursor: 'pointer' }}>
              <input type="checkbox" checked={!!statusFor.status_enabled} onChange={e => updateStatusPage({ enabled: e.target.checked })} style={{ width: 16, height: 16, flex: '0 0 auto', margin: 0 }} />
              {t('cst.sp.enable')}
            </label>

            {statusFor.status_enabled && statusFor.status_token && (
              <>
                <div className="form-group">
                  <label>{t('cst.sp.url')}</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input readOnly value={statusUrl(statusFor)} onFocus={e => e.target.select()} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
                    <button type="button" className="secondary" onClick={() => { navigator.clipboard?.writeText(statusUrl(statusFor)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
                      {copied ? t('cst.sp.copied') : t('cst.sp.copy')}
                    </button>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <a href={statusUrl(statusFor)} target="_blank" rel="noreferrer"><button type="button" className="secondary">{t('cst.sp.open')}</button></a>
                  <button type="button" className="secondary" onClick={() => { if (confirm(t('cst.sp.regenConfirm'))) updateStatusPage({ enabled: true, regenerate: true }); }}>
                    {t('cst.sp.regen')}
                  </button>
                </div>
              </>
            )}

            <div className="form-actions" style={{ marginTop: 20 }}>
              <button type="button" onClick={() => setStatusFor(null)}>{t('cst.sp.done')}</button>
            </div>
          </div>
        </div>
      )}

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? t('cst.editTitle') : t('cst.addTitle')}</h2>
            <form onSubmit={saveCustomer}>
              <div className="form-group"><label>{t('common.name')} *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="form-group"><label>{t('common.description')}</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder={t('cst.descPh')} /></div>
              <label style={{ display: 'block', marginBottom: 8, fontSize: 13, color: 'var(--text-muted)' }}>{t('cst.thresholds')}</label>
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
