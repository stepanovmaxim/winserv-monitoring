import { useState, useEffect } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Audit() {
  const { t } = useLang();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    api.getActionAudit(200).then(setRows).finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('audit.title')}</h1>
        <button className="secondary" onClick={load}>{t('common.refresh')}</button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>{t('audit.desc')}</p>
      </div>

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><p>{t('audit.empty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('common.time')}</th><th>{t('common.server')}</th><th>{t('audit.action')}</th><th>{t('audit.state')}</th><th>{t('audit.source')}</th><th>{t('audit.by')}</th></tr></thead>
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
