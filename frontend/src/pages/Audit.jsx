import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Audit() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.getActionAudit(200).then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Action Audit</h1>
        <button className="secondary" onClick={load}>Refresh</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          Every hide/show toggle of a server action — from the web panel or the Telegram bot — is recorded here,
          including who triggered it and when.
        </p>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><p>No actions recorded yet</p></div>
        ) : (
          <table>
            <thead><tr><th>Time</th><th>Server</th><th>Action</th><th>New state</th><th>Source</th><th>By</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleString()}</td>
                  <td><strong>{r.hostname || '-'}</strong></td>
                  <td>{r.label || '-'}</td>
                  <td><span className={`badge ${r.new_state === 'HIDDEN' ? 'badge-error' : 'badge-viewer'}`}>{r.new_state || '-'}</span></td>
                  <td>{r.source || '-'}</td>
                  <td style={{ fontSize: 12 }}>{r.actor || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
