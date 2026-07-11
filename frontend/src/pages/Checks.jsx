import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

const EMPTY = { name: '', customer_id: '', kind: 'ping', host: '', port: '', interval_sec: 60 };

export default function Checks() {
  const { user } = useAuth();
  const [checks, setChecks] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);

  function load() {
    return api.getChecks().then(setChecks);
  }

  useEffect(() => {
    Promise.all([load(), api.getCustomers().then(setCustomers)]).finally(() => setLoading(false));
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, []);

  function openCreate() { setEditing(null); setForm(EMPTY); setShowModal(true); }
  function openEdit(c) {
    setEditing(c.id);
    setForm({ name: c.name, customer_id: c.customer_id || '', kind: c.kind, host: c.host, port: c.port || '', interval_sec: c.interval_sec });
    setShowModal(true);
  }

  async function save(e) {
    e.preventDefault();
    const payload = { ...form, customer_id: form.customer_id ? Number(form.customer_id) : null, port: form.port ? Number(form.port) : null, interval_sec: Number(form.interval_sec) || 60 };
    if (editing) await api.updateCheck(editing, payload);
    else await api.createCheck(payload);
    setShowModal(false);
    load();
  }
  async function remove(id) { if (confirm('Delete this check?')) { await api.deleteCheck(id); load(); } }
  async function runNow(id) { await api.runCheck(id); load(); }

  if (loading) return <div className="loading">Loading...</div>;

  const dotClass = (s) => (s === 'up' ? 'online' : s === 'down' ? 'offline' : 'unknown');
  const down = checks.filter(c => c.status === 'down').length;
  function certCell(c) {
    if (c.kind !== 'tls' || !c.cert_expires_at) return '-';
    const days = Math.floor((new Date(c.cert_expires_at).getTime() - Date.now()) / 86400000);
    const color = days <= 7 ? 'var(--danger)' : days <= 14 ? 'var(--warning)' : 'var(--text-muted)';
    return <span style={{ color, fontSize: 12 }} title={new Date(c.cert_expires_at).toLocaleDateString()}>{days}d</span>;
  }

  return (
    <div>
      <div className="page-header">
        <h1>Checks</h1>
        {user?.role === 'admin' && <button onClick={openCreate}>+ Add Check</button>}
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          Agentless availability checks run from the backend. Use for anything the server can reach — public IPs,
          gateways, VPN/mail endpoints. Internal machines behind NAT aren't reachable this way; the agent covers those.
          {down > 0 && <b style={{ color: 'var(--danger)' }}> {down} down.</b>}
        </p>
      </div>

      <div className="card">
        {checks.length === 0 ? (
          <div className="empty"><p>No checks yet</p></div>
        ) : (
          <table>
            <thead><tr><th>Status</th><th>Name</th><th>Type</th><th>Target</th><th>Latency</th><th>Cert</th><th>Customer</th><th>Checked</th>{user?.role === 'admin' && <th></th>}</tr></thead>
            <tbody>
              {checks.map(c => (
                <tr key={c.id}>
                  <td><span className="status"><span className={`status-dot ${dotClass(c.status)}`} />{c.status}</span></td>
                  <td><strong>{c.name}</strong></td>
                  <td>{c.kind}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.host}>{c.host}{c.port && c.kind !== 'http' ? `:${c.port}` : ''}</td>
                  <td>{c.status === 'up' && c.last_latency_ms != null ? `${c.last_latency_ms} ms` : (c.status === 'down' ? <span style={{ color: 'var(--danger)', fontSize: 12 }}>{c.last_error || 'down'}</span> : '-')}</td>
                  <td>{certCell(c)}</td>
                  <td>{c.customer_name || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{c.last_checked ? new Date(c.last_checked).toLocaleTimeString() : 'never'}</td>
                  {user?.role === 'admin' && (
                    <td>
                      <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => runNow(c.id)}>Run</button>
                      <button style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => openEdit(c)}>Edit</button>
                      <button className="danger" style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => remove(c.id)}>Del</button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h2>{editing ? 'Edit Check' : 'Add Check'}</h2>
            <form onSubmit={save}>
              <div className="form-group"><label>Name *</label><input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} required placeholder="e.g. Office gateway" /></div>
              <div className="form-group"><label>Customer</label><select value={form.customer_id} onChange={e => setForm({ ...form, customer_id: e.target.value })}><option value="">None</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
              <div className="form-group"><label>Type</label><select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}><option value="ping">Ping (ICMP)</option><option value="tcp">TCP port</option><option value="http">HTTP(S) URL</option><option value="tls">TLS certificate</option></select></div>
              <div className="form-group">
                <label>{form.kind === 'http' ? 'URL *' : form.kind === 'tls' ? 'Hostname *' : 'Host / IP *'}</label>
                <input value={form.host} onChange={e => setForm({ ...form, host: e.target.value })} required placeholder={form.kind === 'http' ? 'https://example.com/health' : form.kind === 'tls' ? 'example.com' : '1.2.3.4 or host.example.com'} />
              </div>
              {form.kind === 'tcp' && <div className="form-group"><label>Port *</label><input type="number" min="1" max="65535" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} required placeholder="3389" /></div>}
              {form.kind === 'tls' && <div className="form-group"><label>Port (default 443)</label><input type="number" min="1" max="65535" value={form.port} onChange={e => setForm({ ...form, port: e.target.value })} placeholder="443" /></div>}
              <div className="form-group"><label>Interval (seconds)</label><input type="number" min="20" value={form.interval_sec} onChange={e => setForm({ ...form, interval_sec: e.target.value })} style={{ width: 120 }} /></div>
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
