import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

const OVERALL_COLOR = {
  operational: { color: '#22c55e', bg: 'rgba(34,197,94,0.12)', key: 'sp.op' },
  degraded: { color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', key: 'sp.deg' },
  down: { color: '#ef4444', bg: 'rgba(239,68,68,0.12)', key: 'sp.down' },
  unknown: { color: '#94a3b8', bg: 'rgba(148,163,184,0.12)', key: 'sp.unknown' },
};
const DOT = { operational: '#22c55e', degraded: '#f59e0b', down: '#ef4444', unknown: '#94a3b8' };
const LABEL_KEY = { operational: 'sp.l.op', degraded: 'sp.l.deg', down: 'sp.l.down', unknown: 'sp.l.unknown' };

export default function StatusPage() {
  const { token } = useParams();
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    return api.getPublicStatus(token)
      .then(d => { setData(d); setError(false); })
      .catch(() => setError(true));
  }, [token]);

  useEffect(() => {
    load().finally(() => setLoading(false));
    const iv = setInterval(load, 30000);
    return () => clearInterval(iv);
  }, [load]);

  const wrap = { minHeight: '100vh', background: '#0b1220', color: '#e5e7eb', fontFamily: 'system-ui, sans-serif', padding: '40px 16px' };
  const inner = { maxWidth: 720, margin: '0 auto' };

  if (loading) return <div style={{ ...wrap, textAlign: 'center' }}><div style={inner}>{t('common.loading')}</div></div>;
  if (error || !data) return (
    <div style={{ ...wrap, textAlign: 'center' }}>
      <div style={inner}>
        <h1 style={{ fontSize: 22 }}>{t('sp.notfound')}</h1>
        <p style={{ color: '#94a3b8' }}>{t('sp.notfound.desc')}</p>
      </div>
    </div>
  );

  const ov = OVERALL_COLOR[data.overall] || OVERALL_COLOR.unknown;
  const groups = [...new Set(data.components.map(c => c.group))];

  return (
    <div style={wrap}>
      <div style={inner}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, color: '#94a3b8', letterSpacing: 0.5 }}>{t('sp.status')}</div>
          <h1 style={{ fontSize: 26, margin: '2px 0 0' }}>{data.name}</h1>
        </div>

        <div style={{ background: ov.bg, border: `1px solid ${ov.color}55`, borderRadius: 12, padding: '18px 20px', marginBottom: 28, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ width: 12, height: 12, borderRadius: '50%', background: ov.color, boxShadow: `0 0 10px ${ov.color}` }} />
          <span style={{ fontSize: 18, fontWeight: 600, color: ov.color }}>{t(ov.key)}</span>
        </div>

        {data.components.length === 0 ? (
          <p style={{ color: '#94a3b8' }}>{t('sp.nocomp')}</p>
        ) : groups.map(g => (
          <div key={g} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 13, textTransform: 'uppercase', letterSpacing: 0.5, color: '#94a3b8', marginBottom: 8 }}>{g}</div>
            <div style={{ background: '#111a2e', border: '1px solid #1f2b45', borderRadius: 12, overflow: 'hidden' }}>
              {data.components.filter(c => c.group === g).map((c, i) => (
                <div key={c.name + i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderTop: i ? '1px solid #1f2b45' : 'none' }}>
                  <span style={{ fontSize: 15 }}>{c.name}</span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: DOT[c.status] }}>
                    {t(LABEL_KEY[c.status] || 'sp.l.unknown')}
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: DOT[c.status] }} />
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}

        <div style={{ marginTop: 32, textAlign: 'center', color: '#64748b', fontSize: 12 }}>
          {t('sp.updated', { t: new Date(data.generated_at).toLocaleString() })}
        </div>
      </div>
    </div>
  );
}
