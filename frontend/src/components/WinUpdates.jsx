import { useEffect, useState, useCallback } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

// Pending Windows updates for one server, with install now / at a set time.
const STATUS = {
  scheduled: { cls: 'badge-information', key: 'wu.st.scheduled' },
  queued: { cls: 'badge-warning', key: 'wu.st.queued' },
  running: { cls: 'badge-warning', key: 'wu.st.running' },
  done: { cls: 'badge-viewer', key: 'wu.st.done' },
  failed: { cls: 'badge-error', key: 'wu.st.failed' },
  cancelled: { cls: '', key: 'wu.st.cancelled' },
};
const OPEN = ['scheduled', 'queued', 'running'];

// Mirrors lib/winUpdates.inScope on the server: bulk scopes never take
// previews or feature upgrades.
function inScope(u, scope, picked) {
  if (scope === 'selected') return picked.has(u.update_id);
  if (u.preview || u.upgrade) return false;
  return scope === 'all' ? true : !!u.security;
}

export default function WinUpdates({ serverId, hostname, isAdmin }) {
  const { t } = useLang();
  const [data, setData] = useState(null);
  const [scope, setScope] = useState('security');
  const [picked, setPicked] = useState(new Set());
  const [reboot, setReboot] = useState(false);
  const [when, setWhen] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [openJob, setOpenJob] = useState(null);

  const load = useCallback(() => api.getUpdates(serverId).then(setData).catch(() => setData({ supported: false, updates: [], jobs: [] })), [serverId]);
  useEffect(() => {
    load();
    const iv = setInterval(load, 20000);
    return () => clearInterval(iv);
  }, [load]);

  if (!data) return <div className="loading">{t('common.loading')}</div>;
  if (!data.supported) return <div className="card"><div className="empty"><p>{t('wu.unsupported')}</p></div></div>;

  const updates = data.updates || [];
  const active = (data.jobs || []).find(j => OPEN.includes(j.status));
  const chosen = updates.filter(u => inScope(u, scope, picked));
  const sizeMb = chosen.reduce((a, u) => a + (Number(u.size_mb) || 0), 0);

  function toggle(id) {
    // Leaving a bulk scope keeps what it had ticked, then applies the click.
    const n = new Set(scope === 'selected' ? picked : chosen.map(u => u.update_id));
    if (n.has(id)) n.delete(id); else n.add(id);
    setPicked(n);
    setScope('selected');
  }

  async function run(fn) {
    setBusy(true); setNote('');
    try { await fn(); await load(); } catch (e) { setNote(e.message); } finally { setBusy(false); }
  }

  function scan() {
    run(async () => { await api.scanUpdates(serverId); setNote(t('wu.scanQueued')); });
  }

  function install() {
    const at = when ? new Date(when) : null;
    const whenText = at ? at.toLocaleString() : t('wu.now');
    const q = t(reboot ? 'wu.confirmReboot' : 'wu.confirm', { n: chosen.length, host: hostname, when: whenText });
    if (!confirm(q)) return;
    run(async () => {
      await api.installUpdates(serverId, { scope, ids: scope === 'selected' ? [...picked] : [], reboot, run_at: at ? at.toISOString() : null });
      setPicked(new Set()); setWhen('');
    });
  }

  function cancel(job) {
    if (!confirm(t('wu.cancelConfirm'))) return;
    run(() => api.cancelUpdateJob(job.id));
  }

  return (
    <div>
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <h3 style={{ margin: 0 }}>{t('wu.title')}</h3>
          <span className={`badge ${updates.length ? 'badge-warning' : 'badge-viewer'}`}>{t('wu.pendingN', { n: updates.length })}</span>
          {data.reboot_required && <span className="badge badge-warning">{t('wu.rebootRequired')}</span>}
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
            {data.scan_at ? t('wu.scannedAt', { time: new Date(data.scan_at).toLocaleString() }) : t('wu.neverScanned')}
          </span>
          {isAdmin && <button className="secondary" onClick={scan} disabled={busy} style={{ padding: '4px 12px', fontSize: 12 }}>{t('wu.scanNow')}</button>}
        </div>
        {data.error && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--danger)' }}>{t('wu.scanError', { e: data.error })}</div>}
        {note && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--text-muted)' }}>{note}</div>}

        {updates.length === 0 ? (
          <div className="empty" style={{ marginTop: 12 }}><p>{data.scan_at ? t('wu.none') : t('wu.waiting')}</p></div>
        ) : (
          <div style={{ overflowX: 'auto', marginTop: 12 }}>
            <table>
              <thead><tr>{isAdmin && <th style={{ width: 28 }}></th>}<th>{t('wu.col.update')}</th><th>{t('wu.col.kb')}</th><th>{t('wu.col.kind')}</th><th>{t('wu.col.size')}</th></tr></thead>
              <tbody>
                {updates.map(u => (
                  <tr key={u.update_id} style={inScope(u, scope, picked) ? undefined : { opacity: 0.55 }}>
                    {isAdmin && (
                      <td><input type="checkbox" checked={inScope(u, scope, picked)} onChange={() => toggle(u.update_id)} style={{ width: 16, height: 16, margin: 0 }} /></td>
                    )}
                    <td style={{ fontSize: 13 }}>{u.title}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{u.kb || '—'}</td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {u.preview ? <span className="badge">{t('wu.kind.preview')}</span>
                        : u.upgrade ? <span className="badge">{t('wu.kind.upgrade')}</span>
                        : u.security ? <span className="badge badge-error">{t('wu.kind.security')}{u.severity ? ` · ${u.severity}` : ''}</span>
                        : <span className="badge badge-information">{t('wu.kind.other')}</span>}
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{u.size_mb != null ? `${Math.round(u.size_mb)} MB` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin && updates.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 12 }}>{t('wu.install')}</h3>
          {active ? (
            <div style={{ fontSize: 13 }}>
              <span className={`badge ${STATUS[active.status].cls}`}>{t(STATUS[active.status].key)}</span>
              <span style={{ marginLeft: 8 }}>{active.status === 'scheduled' ? t('wu.activeAt', { time: new Date(active.run_at).toLocaleString() }) : t('wu.activeNow')}</span>
              {active.status !== 'running' && <button className="secondary" onClick={() => cancel(active)} disabled={busy} style={{ marginLeft: 12, padding: '4px 12px', fontSize: 12 }}>{t('wu.cancel')}</button>}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t('wu.what')}
                  <select value={scope} onChange={e => setScope(e.target.value)} style={{ width: 'auto' }}>
                    <option value="security">{t('wu.scope.security')}</option>
                    <option value="all">{t('wu.scope.all')}</option>
                    <option value="selected">{t('wu.scope.selected')}</option>
                  </select>
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {t('wu.when')}
                  <input type="datetime-local" value={when} onChange={e => setWhen(e.target.value)} style={{ width: 'auto' }} />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={reboot} onChange={e => setReboot(e.target.checked)} style={{ width: 16, height: 16, flex: '0 0 auto', margin: 0 }} />
                  {t('wu.reboot')}
                </label>
                <button onClick={install} disabled={busy || chosen.length === 0}>
                  {when ? t('wu.schedule', { n: chosen.length }) : t('wu.installNow', { n: chosen.length })}
                </button>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 10 }}>
                {t('wu.hint', { n: chosen.length, mb: Math.round(sizeMb) })} {when ? '' : t('wu.hintNow')} {t('wu.hintMute')}
              </div>
            </>
          )}
        </div>
      )}

      {(data.jobs || []).length > 0 && (
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>{t('wu.history')}</h3>
          <table>
            <thead><tr><th>{t('wu.col.when')}</th><th>{t('common.status')}</th><th>{t('wu.col.what')}</th><th>{t('wu.col.result')}</th><th>{t('wu.col.by')}</th></tr></thead>
            <tbody>
              {data.jobs.map(j => {
                const st = STATUS[j.status] || STATUS.failed;
                const items = (j.result && j.result.items) || [];
                return [
                  <tr key={j.id} onClick={() => items.length && setOpenJob(openJob === j.id ? null : j.id)} style={items.length ? { cursor: 'pointer' } : undefined}>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(j.finished_at || j.started_at || j.run_at).toLocaleString()}</td>
                    <td><span className={`badge ${st.cls}`}>{t(st.key)}</span></td>
                    <td style={{ fontSize: 12 }}>{t('wu.scope.' + j.scope)}{j.reboot ? ` · ${t('wu.withReboot')}` : ''}</td>
                    <td style={{ fontSize: 13 }}>{j.summary || '—'}{items.length > 0 && <span style={{ color: 'var(--text-muted)', marginLeft: 6 }}>{openJob === j.id ? '▾' : '▸'}</span>}</td>
                    <td style={{ fontSize: 12 }}>{j.created_by}</td>
                  </tr>,
                  openJob === j.id && (
                    <tr key={j.id + '-d'}>
                      <td colSpan={5} style={{ fontSize: 12 }}>
                        {items.map((i, n) => (
                          <div key={n} style={{ color: i.result === 'installed' ? 'var(--text)' : 'var(--danger)' }}>
                            {i.result === 'installed' ? '✓' : '✗'} {i.title}{i.detail ? ` — ${i.detail}` : ''}
                          </div>
                        ))}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
