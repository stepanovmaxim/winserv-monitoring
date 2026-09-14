import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { api } from '../api';

const SEV_KEY = {
  critical: { key: 'al.sev.critical', color: 'var(--danger)' },
  warning: { key: 'al.sev.warning', color: 'var(--warning)' },
  info: { key: 'al.sev.info', color: 'var(--text-muted)' },
};
const KIND_ICON = {
  threshold: '📊', offline: '🔌', online: '✅', flapping: '🔁',
  service: '🧩', cert: '🔐', security: '🛡', check: '📡',
};

export default function Alerts() {
  const { user } = useAuth();
  const { t } = useLang();
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
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, [load]);

  async function ack(id) { await api.ackAlert(id); load(); }
  async function ackAll() {
    if (!confirm(t('al.ackConfirm'))) return;
    setBusy(true);
    try { await api.ackAllAlerts(); await load(); } finally { setBusy(false); }
  }
  async function snooze(a) {
    const who = a.hostname ? a.hostname : (a.customer_name || t('al.thisSource'));
    const raw = prompt(t('al.snoozePrompt', { who }), '60');
    if (raw == null) return;
    const mins = parseInt(raw);
    if (!mins || mins < 5) return alert(t('al.snoozeMin'));
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

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('al.title')}</h1>
        {isAdmin && unacked > 0 && <button onClick={ackAll} disabled={busy}>{t('al.ackAll', { n: unacked })}</button>}
      </div>

      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
          <input type="checkbox" checked={onlyUnacked} onChange={e => setOnlyUnacked(e.target.checked)} style={{ width: 16, height: 16, flex: '0 0 auto', margin: 0 }} />
          {t('al.onlyUnacked')}
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {t('al.severity')}
          <select value={severity} onChange={e => setSeverity(e.target.value)} style={{ width: 'auto' }}>
            <option value="">{t('al.all')}</option>
            <option value="critical">{t('al.sev.critical')}</option>
            <option value="warning">{t('al.sev.warning')}</option>
            <option value="info">{t('al.sev.info')}</option>
          </select>
        </label>
        <span style={{ color: 'var(--text-muted)', fontSize: 13, marginLeft: 'auto' }}>{t('al.shown', { n: alerts.length })}</span>
      </div>

      <div className="card">
        {alerts.length === 0 ? (
          <div className="empty"><p>{t('al.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('common.time')}</th><th>{t('al.severity')}</th><th>{t('al.type')}</th><th>{t('al.target')}</th><th>{t('al.message')}</th><th>{t('common.status')}</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {alerts.map(a => {
                const sev = SEV_KEY[a.severity] || SEV_KEY.info;
                return (
                  <tr key={a.id} style={a.acknowledged_at ? { opacity: 0.55 } : {}}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }} title={new Date(a.created_at).toLocaleString()}>{new Date(a.created_at).toLocaleString()}</td>
                    <td><span style={{ color: sev.color, fontWeight: 600, fontSize: 12 }}>● {t(sev.key)}</span></td>
                    <td style={{ fontSize: 12 }}>{KIND_ICON[a.kind] || '•'} {a.kind || '—'}</td>
                    <td style={{ fontSize: 13 }}>{target(a)}</td>
                    <td style={{ fontSize: 13, maxWidth: 380 }}>{a.message}</td>
                    <td style={{ fontSize: 12 }}>
                      {a.acknowledged_at
                        ? <span style={{ color: 'var(--text-muted)' }} title={`${a.acknowledged_by || ''} @ ${new Date(a.acknowledged_at).toLocaleString()}`}>✓ {t('al.acked')}</span>
                        : <span style={{ color: 'var(--warning)' }}>{t('al.new')}</span>}
                    </td>
                    {isAdmin && (
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {!a.acknowledged_at && <button className="secondary" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => ack(a.id)}>{t('al.ack')}</button>}
                        {(a.server_id || a.customer_id) && <button style={{ padding: '4px 10px', fontSize: 12, marginLeft: 4 }} onClick={() => snooze(a)}>{t('al.snooze')}</button>}
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
