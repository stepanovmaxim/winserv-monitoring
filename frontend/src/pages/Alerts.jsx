import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

const SEV = {
  critical: { label: 'Critical', color: 'var(--danger)' },
  warning: { label: 'Warning', color: 'var(--warning)' },
  info: { label: 'Info', color: 'var(--text-muted)' },
};
const KIND_ICON = {
  threshold: '📊', offline: '🔌', online: '✅', flapping: '🔁',
  service: '🧩', cert: '🔐', security: '🛡', check: '📡',
};

export default function Alerts() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [alerts, setAlerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyUnacked, setOnlyUnacked] = useState(true);
  const [severity, setSeverity] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    const qs = [];
    if (onlyUnacked) qs.push('ack=0');
    if (severity) qs.push('severity=' + severity);
    return api.getAlerts(qs.length ? '?' + qs.join('&') : '').then(setAlerts);
  }, [onlyUnacked, severity]);

  useEffect(() => {
    setLoading(true);
    load().finally(() => setLoading(false));
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  async function ack(id) { await api.ackAlert(id); load(); }
  async function ackAll() {
    if (!confirm('Acknowledge all unacknowledged alerts?')) return;
    setBusy(true);
    try { await api.ackAllAlerts(); await load(); } finally { setBusy(false); }
  }
  async function snooze(a) {
    const raw = prompt(`Snooze for how many minutes? This mutes ${a.hostname ? a.hostname : a.customer_name || 'this source'} and acknowledges the alert.`, '60');
    if (raw == null) return;
    const mins = parseInt(raw);
    if (!mins || mins < 5) return alert('Enter at least 5 minutes.');
    await api.snoozeAlert(a.id, mins);
    load();
  }

  const unacked = alerts.filter(a => !a.acknowledged_at).length;

  function target(a) {
    if (a.hostname) return a.hostname;
    if (a.check_name) return a.check_name;
    if (a.customer_name) return a.customer_name;
    return '—';
  }

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header">
        <h1>Alerts</h1>
        {isAdmin && unacked > 0 && <button onClick={ackAll} disabled={busy}>Acknowledge all ({unacked})</button>}
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyUnacked} onChange={e => setOnlyUnacked(e.target.checked)} />
          Only unacknowledged
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          Severity
          <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="info">Info</option>
          </select>
        </label>
        <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 'auto' }}>{alerts.length} shown</span>
      </div>

      <div className="card">
        {alerts.length === 0 ? (
          <div className="empty"><p>No alerts</p></div>
        ) : (
          <table>
            <thead><tr><th>Time</th><th>Severity</th><th>Type</th><th>Target</th><th>Message</th><th>Status</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {alerts.map(a => {
                const sev = SEV[a.severity] || SEV.info;
                return (
                  <tr key={a.id} style={a.acknowledged_at ? { opacity: 0.55 } : {}}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }} title={new Date(a.created_at).toLocaleString()}>{new Date(a.created_at).toLocaleString()}</td>
                    <td><span style={{ color: sev.color, fontWeight: 600, fontSize: 12 }}>● {sev.label}</span></td>
                    <td style={{ fontSize: 12 }}>{KIND_ICON[a.kind] || '•'} {a.kind || '—'}</td>
                    <td style={{ fontSize: 13 }}>{target(a)}</td>
                    <td style={{ fontSize: 13, maxWidth: 380 }}>{a.message}</td>
                    <td style={{ fontSize: 12 }}>
                      {a.acknowledged_at
                        ? <span style={{ color: 'var(--text-muted)' }} title={`${a.acknowledged_by || ''} @ ${new Date(a.acknowledged_at).toLocaleString()}`}>✓ ack</span>
                        : <span style={{ color: 'var(--warning)' }}>new</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {!a.acknowledged_at && <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => ack(a.id)}>Ack</button>}
                        {(a.server_id || a.customer_id) && <button style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => snooze(a)}>Snooze</button>}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
