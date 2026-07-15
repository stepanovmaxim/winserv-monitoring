import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Security() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  function load(h) {
    setLoading(true);
    Promise.all([
      api.getSecurityTop(h).then(setRows),
      api.getBlocks().then(setBlocks).catch(() => setBlocks([])),
    ]).finally(() => setLoading(false));
  }

  useEffect(() => { load(hours); }, [hours]);

  async function blockIp(row) {
    if (!confirm(`Block ${row.ip} on ${row.server_ids.length} server(s)? A firewall rule will be added on each.`)) return;
    try {
      const r = await api.blockIp(row.ip, row.server_ids, 0);
      alert(`Queued block for ${row.ip} on ${r.queued} server(s). Applies within ~1 min.`);
      load(hours);
    } catch (e) {
      alert(e.message);
    }
  }

  async function unblock(b) {
    if (!confirm(`Unblock ${b.ip} on ${b.hostname}?`)) return;
    await api.unblockIp(b.id);
    load(hours);
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Security</h1>
        <select value={hours} onChange={e => setHours(Number(e.target.value))}>
          <option value={6}>Last 6 hours</option>
          <option value={24}>Last 24 hours</option>
          <option value={168}>Last 7 days</option>
        </select>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          Source IPs by failed RDP/SSH logons across the fleet. Auto-ban (configured in Settings) firewalls
          persistent attackers automatically — local, reserved, and allowlisted addresses are never blocked.
        </p>
      </div>

      {blocks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Active blocks ({blocks.length})</h3>
          <table>
            <thead><tr><th>IP</th><th>Server</th><th>Reason</th><th>Type</th><th>Expires</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {blocks.map(b => (
                <tr key={b.id}>
                  <td style={{ fontFamily: 'monospace' }}><strong>{b.ip}</strong></td>
                  <td>{b.hostname || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.reason || '-'}</td>
                  <td>{b.auto ? <span className="badge badge-error">auto</span> : <span className="badge badge-viewer">manual</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.expires_at ? new Date(b.expires_at).toLocaleString() : 'permanent'}</td>
                  {isAdmin && <td><button className="secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => unblock(b)}>Unblock</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><p>No failed logons recorded</p></div>
        ) : (
          <table>
            <thead><tr><th>Source IP</th><th>Failed logons</th><th>Servers</th><th>Targets</th><th>Last</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ip}>
                  <td style={{ fontFamily: 'monospace' }}><strong>{r.ip}</strong></td>
                  <td><span className={`badge ${r.fails >= 20 ? 'badge-error' : 'badge-warning'}`}>{r.fails}</span></td>
                  <td>{r.servers}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(r.hostnames || []).join(', ')}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(r.last_seen).toLocaleString()}</td>
                  {isAdmin && <td><button className="danger" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => blockIp(r)}>Block</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
