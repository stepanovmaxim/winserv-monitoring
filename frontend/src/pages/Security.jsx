import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../api';

export default function Security() {
  const { user } = useAuth();
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
    if (!r.server_id || r.available === null || r.available === undefined) return ['no data yet'];
    if (r.third_party) return [];                       // another AV owns the box
    if (!r.available) return ['Defender not available'];
    const p = [];
    if (!r.av_enabled) p.push('DISABLED');
    else if (!r.realtime_enabled) p.push('real-time OFF');
    if (r.signature_age_days != null && r.signature_age_days > 3) p.push(`signatures ${r.signature_age_days}d old`);
    const scans = [r.quick_scan_age_days, r.full_scan_age_days].filter(v => v != null);
    if (!scans.length) p.push('never scanned');
    else if (Math.min(...scans) > 14) p.push(`last scan ${Math.min(...scans)}d ago`);
    if (!r.tamper_protected) p.push('tamper protection off');
    return p;
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

      {ransom.some(r => r.canary_tripped > 0) && (
        <div className="card" style={{ marginBottom: 16, borderLeft: '3px solid var(--danger)' }}>
          <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>🧬 RANSOMWARE SUSPECTED</h3>
          <p style={{ color: 'var(--text-muted)', marginTop: 0 }}>
            Canary files were modified — something is rewriting files on these servers right now.
          </p>
          <table>
            <thead><tr><th>Server</th><th>Customer</th><th>Canaries hit</th><th>Where</th><th>Seen</th></tr></thead>
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
          <h3 style={{ marginTop: 0, color: 'var(--danger)' }}>🦠 Malware detected ({threats.length} in 30 days)</h3>
          <table>
            <thead><tr><th>When</th><th>Server</th><th>Threat</th><th>Object</th><th>Result</th></tr></thead>
            <tbody>
              {threats.slice(0, 15).map(t => (
                <tr key={t.id}>
                  <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(t.detected_at).toLocaleString()}</td>
                  <td>{t.hostname}</td>
                  <td><strong>{t.name}</strong></td>
                  <td style={{ fontSize: 11, color: 'var(--text-muted)', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis' }} title={t.resource}>{t.resource || '-'}</td>
                  <td>{t.action_success
                    ? <span className="badge badge-viewer">neutralised</span>
                    : <span className="badge badge-error">NOT neutralised</span>}</td>
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
              <h3 style={{ margin: 0 }}>🛡 Antivirus posture</h3>
              <span style={{ fontSize: 13, color: withProblems.length ? 'var(--danger)' : 'var(--success, #22c55e)' }}>
                {withProblems.length ? `${withProblems.length} of ${av.length} need attention` : `all ${av.length} protected`}
              </span>
              <button className="secondary" style={{ marginLeft: 'auto', padding: '4px 10px', fontSize: 12 }}
                onClick={() => setShowAllAv(s => !s)}>{showAllAv ? 'Only problems' : 'Show all'}</button>
            </div>
            {shown.length === 0 ? (
              <div className="empty"><p>✓ Defender is enabled, current and scanning everywhere.</p></div>
            ) : (
              <table>
                <thead><tr><th>Server</th><th>Customer</th><th>State</th><th>Signatures</th><th>Last scan</th><th>Version</th></tr></thead>
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
                            ? <span className="badge badge-viewer" title={r.third_party}>3rd-party AV</span>
                            : probs.length
                              ? probs.map((p, i) => <span key={i} className="badge badge-error" style={{ marginRight: 4 }}>{p}</span>)
                              : <span className="badge badge-viewer">protected</span>}
                        </td>
                        <td style={{ fontSize: 12, color: r.signature_age_days > 3 ? 'var(--danger)' : 'var(--text-muted)' }}>
                          {r.signature_age_days != null ? `${r.signature_age_days}d` : '-'}
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{scans.length ? `${Math.min(...scans)}d ago` : 'never'}</td>
                        <td style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.engine_version || '-'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
              Reported by the agent (v2.19+) every ~10 minutes. Hosts running a third-party antivirus are shown as such:
              Defender goes passive there, which is expected and not flagged.
            </p>
          </div>
        );
      })()}

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

      {score.some(r => r.score !== null) && (() => {
        const scored = score.filter(r => r.score !== null);
        const avg = Math.round(scored.reduce((a, r) => a + r.score, 0) / scored.length);
        const col = (v) => (v >= 90 ? 'var(--success, #22c55e)' : v >= 70 ? 'var(--warning)' : 'var(--danger)');
        return (
          <div className="card" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
              <h3 style={{ margin: 0 }}>📋 Security score</h3>
              <span style={{ fontSize: 22, fontWeight: 700, color: col(avg) }}>{avg}</span>
              <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>fleet average over {scored.length} host(s)</span>
            </div>
            <table>
              <thead><tr><th>Server</th><th>Customer</th><th>Score</th><th>What to fix</th></tr></thead>
              <tbody>
                {scored.map(r => (
                  <tr key={r.server_id} style={{ cursor: r.findings.length ? 'pointer' : 'default' }}
                      onClick={() => r.findings.length && setOpenScore(openScore === r.server_id ? null : r.server_id)}>
                    <td><strong>{r.hostname}</strong></td>
                    <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.customer_name || '-'}</td>
                    <td><span style={{ fontWeight: 700, color: col(r.score) }}>{r.score}</span></td>
                    <td style={{ fontSize: 12 }}>
                      {r.findings.length === 0 ? <span style={{ color: 'var(--success, #22c55e)' }}>nothing — hardened</span> : (
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
              Click a row for the fix. Settings the agent could not read are left out of the score rather than counted
              against the host. Requires agent v2.24+.
            </p>
          </div>
        );
      })()}

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
