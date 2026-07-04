import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Security() {
  const { user } = useAuth();
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  function load(h) {
    setLoading(true);
    api.getSecurityTop(h).then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(hours); }, [hours]);

  async function blockIp(row) {
    if (!confirm(`Block ${row.ip} on ${row.server_ids.length} server(s)? A firewall rule will be added on each.`)) return;
    await Promise.all(row.server_ids.map(id => api.queueCommand(id, 'block_ip', row.ip)));
    alert(`Queued block for ${row.ip} on ${row.server_ids.length} server(s). Applies within ~1 min (agent v2.5+).`);
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
          Source IPs by failed RDP/network logons (event 4625) across the fleet. Requires agent v2.5+ on the hosts.
          Blocking adds an inbound firewall Block rule on each affected server.
        </p>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><p>No failed logons recorded</p></div>
        ) : (
          <table>
            <thead><tr><th>Source IP</th><th>Failed logons</th><th>Servers</th><th>Targets</th><th>Last</th>{user?.role === 'admin' && <th></th>}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ip}>
                  <td style={{ fontFamily: 'monospace' }}><strong>{r.ip}</strong></td>
                  <td><span className={`badge ${r.fails >= 20 ? 'badge-error' : 'badge-warning'}`}>{r.fails}</span></td>
                  <td>{r.servers}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(r.hostnames || []).join(', ')}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(r.last_seen).toLocaleString()}</td>
                  {user?.role === 'admin' && <td><button className="danger" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => blockIp(r)}>Block</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
