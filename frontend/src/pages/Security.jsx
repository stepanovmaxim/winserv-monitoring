import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLang } from '../context/LanguageContext';
import { api } from '../api';

export default function Security() {
  const { user } = useAuth();
  const { t } = useLang();
  const isAdmin = user?.role === 'admin';
  const [hours, setHours] = useState(24);
  const [rows, setRows] = useState([]);
  const [blocks, setBlocks] = useState([]);
  const [av, setAv] = useState([]);
  const [threats, setThreats] = useState([]);
  const [ransom, setRansom] = useState([]);
  const [score, setScore] = useState([]);
  const [openScore, setOpenScore] = useState(null);
  const [showAllAv, setShowAllAv] = useState(false);
  const [loading, setLoading] = useState(true);

  function load(h) {
    setLoading(true);
    Promise.all([
      api.getSecurityTop(h).then(setRows),
      api.getBlocks().then(setBlocks).catch(() => setBlocks([])),
      api.getDefenderFleet().then(setAv).catch(() => setAv([])),
      api.getThreats().then(setThreats).catch(() => setThreats([])),
      api.getRansomwareFleet().then(setRansom).catch(() => setRansom([])),
      api.getSecurityScore().then(setScore).catch(() => setScore([])),
    ]).finally(() => setLoading(false));
  }

  // What's wrong with this host's antivirus, worst first. Empty = healthy.
  function avProblems(r) {
    if (!r.server_id || r.available === null || r.available === undefined) return [t('sec.p.nodata')];
    if (r.third_party) return [];                       // another AV owns the box
    if (!r.available) return [t('sec.p.unavail')];
    const p = [];
    if (!r.av_enabled) p.push(t('sec.p.disabled'));
    else if (!r.realtime_enabled) p.push(t('sec.p.rtoff'));
    if (r.signature_age_days != null && r.signature_age_days > 3) p.push(t('sec.p.sigold', { n: r.signature_age_days }));
    const scans = [r.quick_scan_age_days, r.full_scan_age_days].filter(v => v != null);
    if (!scans.length) p.push(t('sec.p.neverscan'));
    else if (Math.min(...scans) > 14) p.push(t('sec.p.lastscan', { n: Math.min(...scans) }));
    if (!r.tamper_protected) p.push(t('sec.p.tamper'));
    return p;
  }

  useEffect(() => { load(hours); }, [hours]);

  async function blockIp(row) {
    if (!confirm(t('sec.blockConfirm', { ip: row.ip, n: row.server_ids.length }))) return;
    try {
      const r = await api.blockIp(row.ip, row.server_ids, 0);
      alert(t('sec.blockQueued', { ip: row.ip, n: r.queued }));
      load(hours);
    } catch (e) {
      alert(e.message);
    }
  }

  async function unblock(b) {
    if (!confirm(t('sec.unblockConfirm', { ip: b.ip, host: b.hostname }))) return;
    await api.unblockIp(b.id);
    load(hours);
  }

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header">
        <h1>{t('sec.title')}</h1>
        <select value={hours} onChange={e => setHours(Number(e.target.value))}>
          <option value={6}>{t('sec.last6')}</option>
          <option value={24}>{t('sec.last24')}</option>
          <option value={168}>{t('sec.last7d')}</option>
        </select>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <p style={{ color: 'var(--text-muted)' }}>
          {t('sec.desc')}
        </p>
      </div>

      {ransom.some(r => r.canary_tripped > 0) && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--danger)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>{t('sec.ransomTitle')}</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
            {t('sec.ransomDesc')}
          </p>
          <table>
            <thead><tr><th>{t('common.server')}</th><th>{t('common.customer')}</th><th>{t('sec.canariesHit')}</th><th>{t('sec.where')}</th><th>{t('sec.seen')}</th></tr></thead>
            <tbody>
              {ransom.filter(r => r.canary_tripped > 0).map(r => (
                <tr key={r.server_id}>
                  <td><strong>{r.hostname}</strong></td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.customer_name || '-'}</td>
                  <td><span className="badge badge-error">{r.canary_tripped} / {r.canary_total}</span></td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 340 }}>{r.tripped_detail || '-'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.updated_at ? new Date(r.updated_at).toLocaleString() : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {threats.length > 0 && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--danger)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>{t('sec.malwareTitle', { n: threats.length })}</h3>
          <table>
            <thead><tr><th>{t('sec.when')}</th><th>{t('common.server')}</th><th>{t('sec.threat')}</th><th>{t('sec.object')}</th><th>{t('sec.result')}</th></tr></thead>
            <tbody>
              {threats.slice(0, 15).map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(t.detected_at).toLocaleString()}</td>
                  <td>{t.hostname}</td>
                  <td><strong>{t.name}</strong></td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.resource}>{t.resource || '-'}</td>
                  <td>{t.action_success
                    ? <span className="badge badge-viewer">{t('sec.neutralised')}</span>
                    : <span className="badge badge-error">{t('sec.notNeutralised')}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {av.length > 0 && (() => {
        const withProblems = av.filter(r => avProblems(r).length);
        const shown = showAllAv ? av : withProblems;
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{t('sec.avTitle')}</h3>
              <span style={{ fontSize: 13, color: withProblems.length ? 'var(--danger)' : 'var(--success, #22c55e)' }}>
                {withProblems.length ? t('sec.avNeed', { n: withProblems.length, total: av.length }) : t('sec.avAll', { n: av.length })}
              </span>
              <button className="secondary" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
                onClick={() => setShowAllAv(s => !s)}>{showAllAv ? t('sec.onlyProblems') : t('sec.showAll')}</button>
            </div>
            {shown.length === 0 ? (
              <div className="empty"><p>{t('sec.avHealthy')}</p></div>
            ) : (
              <table>
                <thead><tr><th>{t('common.server')}</th><th>{t('common.customer')}</th><th>{t('sec.state')}</th><th>{t('sec.signatures')}</th><th>{t('sec.lastScan')}</th><th>{t('sec.version')}</th></tr></thead>
                <tbody>
                  {shown.map(r => {
                    const probs = avProblems(r);
                    const scans = [r.quick_scan_age_days, r.full_scan_age_days].filter(v => v != null);
                    return (
                      <tr key={r.server_id}>
                        <td><strong>{r.hostname}</strong></td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.customer_name || '-'}</td>
                        <td style={{ fontSize: 12 }}>
                          {r.third_party
                            ? <span className="badge badge-viewer" title={r.third_party}>{t('sec.thirdParty')}</span>
                            : probs.length
                              ? probs.map((p, i) => <span key={i} className="badge badge-error" style={{ marginRight: 4 }}>{p}</span>)
                              : <span className="badge badge-viewer">{t('sec.protected')}</span>}
                        </td>
                        <td style={{ fontSize: 12, color: r.signature_age_days > 3 ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {r.signature_age_days != null ? `${r.signature_age_days}d` : '-'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{scans.length ? t('sec.ago', { n: Math.min(...scans) }) : t('sec.never')}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.engine_version || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              {t('sec.avNote')}
            </p>
          </div>
        );
      })()}

      {blocks.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>{t('sec.blocksTitle', { n: blocks.length })}</h3>
          <table>
            <thead><tr><th>{t('sec.ip')}</th><th>{t('common.server')}</th><th>{t('sec.reason')}</th><th>{t('sec.type')}</th><th>{t('sec.expires')}</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {blocks.map(b => (
                <tr key={b.id}>
                  <td style={{ fontFamily: 'monospace' }}><strong>{b.ip}</strong></td>
                  <td>{b.hostname || '—'}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.reason || '-'}</td>
                  <td>{b.auto ? <span className="badge badge-error">{t('sec.auto')}</span> : <span className="badge badge-viewer">{t('sec.manual')}</span>}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{b.expires_at ? new Date(b.expires_at).toLocaleString() : t('sec.permanent')}</td>
                  {isAdmin && <td><button className="secondary" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => unblock(b)}>{t('sec.unblock')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {score.some(r => r.score !== null) && (() => {
        const scored = score.filter(r => r.score !== null);
        const avg = Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length);
        const col = (v) => (v >= 90 ? 'var(--success, #22c55e)' : v >= 70 ? 'var(--warning)' : 'var(--danger)');
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>{t('sec.scoreTitle')}</h3>
              <span style={{ fontSize: 22, fontWeight: 700, color: col(avg) }}>{avg}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{t('sec.scoreAvg', { n: scored.length })}</span>
            </div>
            <table>
              <thead><tr><th>{t('common.server')}</th><th>{t('common.customer')}</th><th>{t('sec.score')}</th><th>{t('sec.whatToFix')}</th></tr></thead>
              <tbody>
                {scored.map(r => (
                  <tr key={r.server_id} style={{ cursor: r.findings.length ? 'pointer' : 'default' }}
                      onClick={() => r.findings.length && setOpenScore(openScore === r.server_id ? null : r.server_id)}>
                    <td><strong>{r.hostname}</strong></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.customer_name || '-'}</td>
                    <td><span style={{ fontWeight: 700, color: col(r.score) }}>{r.score}</span></td>
                    <td style={{ fontSize: 12 }}>
                      {r.findings.length === 0 ? <span style={{ color: 'var(--success, #22c55e)' }}>{t('sec.hardened')}</span> : (
                        openScore === r.server_id ? (
                          <ul style={{ margin: 0, paddingLeft: 16 }}>
                            {r.findings.map(f => (
                              <li key={f.key} style={{ marginBottom: 4 }}>
                                <b style={{ color: f.severity === 'critical' ? 'var(--danger)' : 'var(--warning)' }}>{f.title}</b>
                                {f.detail ? ' (' + f.detail + ')' : ''} — <span style={{ color: 'var(--text-muted)' }}>{f.hint}</span>
                              </li>
                            ))}
                          </ul>
                        ) : r.findings.map(f => (
                          <span key={f.key} className={f.severity === 'critical' ? 'badge badge-error' : 'badge badge-warning'} style={{ marginRight: 4 }}>{f.title}</span>
                        ))
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              {t('sec.scoreNote')}
            </p>
          </div>
        );
      })()}

      <div className="card">
        {rows.length === 0 ? (
          <div className="empty"><p>{t('sec.emptyLogons')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('sec.sourceIp')}</th><th>{t('sec.failedLogons')}</th><th>{t('groups.servers')}</th><th>{t('sec.targets')}</th><th>{t('sec.last')}</th>{isAdmin && <th></th>}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.ip}>
                  <td style={{ fontFamily: 'monospace' }}><strong>{r.ip}</strong></td>
                  <td><span className={`badge ${r.fails >= 20 ? 'badge-error' : 'badge-warning'}`}>{r.fails}</span></td>
                  <td>{r.servers}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{(r.hostnames || []).join(', ')}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{new Date(r.last_seen).toLocaleString()}</td>
                  {isAdmin && <td><button className="danger" style={{ padding: '4px 12px', fontSize: 12 }} onClick={() => blockIp(r)}>{t('sec.block')}</button></td>}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
