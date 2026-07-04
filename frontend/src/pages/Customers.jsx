import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Customers() {
  const [customers, setCustomers] = useState([]);
  const [domainData, setDomainData] = useState({ mappings: [], domains: [] });
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', description: '' });
  const [mapForm, setMapForm] = useState({ domain: '', customer_id: '' });

  function loadAll() {
    return Promise.all([api.getCustomers(), api.getDomainMappings()]).then(([c, d]) => {
      setCustomers(c);
      setDomainData(d);
    });
  }

  useEffect(() => { loadAll().finally(() => setLoading(false)); }, []);

  function openCreate() {
    setEditing(null);
    setForm({ name: '', description: '' });
    setShowModal(true);
  }
  function openEdit(c) {
    setEditing(c.id);
    setForm({ name: c.name, description: c.description || '' });
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
    if (!confirm('Delete this customer? Its servers will become unassigned.')) return;
    await api.deleteCustomer(id);
    loadAll();
  }

  async function saveMapping(e) {
    e.preventDefault();
    if (!mapForm.domain || !mapForm.customer_id) return;
    const r = await api.setDomainMapping(mapForm.domain, Number(mapForm.customer_id));
    setMapForm({ domain: '', customer_id: '' });
    await loadAll();
    if (r.applied) alert(`Mapped. ${r.applied} existing server(s) assigned to this customer.`);
  }

  async function removeMapping(domain) {
    await api.deleteDomainMapping(domain);
    loadAll();
  }

  const mappedDomains = new Set(domainData.mappings.map(m => m.domain));
  const unmapped = domainData.domains.filter(d => !mappedDomains.has(d));

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Customers</h1>
        <button onClick={openCreate}>+ Add Customer</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        {customers.length === 0 ? (
          <div className="empty"><p>No customers yet. Add one, then map its AD domains below.</p></div>
        ) : (
          <table>
            <thead><tr><th>Name</th><th>Description</th><th>Servers</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {customers.map(c => (
                <tr key={c.id}>
                  <td><strong>{c.name}</strong></td>
                  <td style={{ color: 'var(--text-muted)' }}>{c.description || '-'}</td>
                  <td>{c.server_count}</td>
                  <td><span className={`badge ${c.active ? 'badge-viewer' : 'badge-error'}`}>{c.active ? 'active' : 'inactive'}</span></td>
                  <td>
                    <button style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => openEdit(c)}>Edit</button>
                    <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => removeCustomer(c.id)}>Del</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 8 }}>Domain → Customer mapping</h3>
        <p style={{ color: 'var(--text-muted)', marginBottom: 16 }}>
          Domain-joined machines inherit their customer automatically from this map. Non-domain machines are
          assigned per-server on the Servers page.
        </p>

        <form onSubmit={saveMapping} style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <select value={mapForm.domain} onChange={e => setMapForm({ ...mapForm, domain: e.target.value })} style={{ flex: '1 1 200px' }} required>
            <option value="">Select domain...</option>
            {unmapped.map(d => <option key={d} value={d}>{d}</option>)}
            {mapForm.domain && mappedDomains.has(mapForm.domain) && <option value={mapForm.domain}>{mapForm.domain}</option>}
          </select>
          <select value={mapForm.customer_id} onChange={e => setMapForm({ ...mapForm, customer_id: e.target.value })} style={{ flex: '1 1 200px' }} required>
            <option value="">Select customer...</option>
            {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="submit">Map</button>
        </form>

        {domainData.mappings.length === 0 ? (
          <div className="empty"><p>No domain mappings yet</p></div>
        ) : (
          <table>
            <thead><tr><th>Domain</th><th>Customer</th><th></th></tr></thead>
            <tbody>
              {domainData.mappings.map(m => (
                <tr key={m.domain}>
                  <td style={{ fontFamily: 'monospace' }}>{m.domain}</td>
                  <td>{m.customer_name || <span style={{ color: 'var(--danger)' }}>(deleted)</span>}</td>
                  <td><button className="danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => removeMapping(m.domain)}>Unmap</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {unmapped.length > 0 && (
          <p style={{ color: 'var(--warning)', marginTop: 12, fontSize: 13 }}>
            Unmapped domains in the fleet: {unmapped.join(', ')}
          </p>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Edit Customer' : 'Add Customer'}</h2>
            <form onSubmit={saveCustomer}>
              <div className="form-group"><label>Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required /></div>
              <div className="form-group"><label>Description</label><input value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="e.g. ООО Ромашка, договор 2026" /></div>
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
