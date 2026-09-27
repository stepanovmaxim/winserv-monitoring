import { useState, useEffect } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';
import { forecastLine } from '../forecast';

// A monthly service report for one customer, laid out as a document: always a
// light page (it is meant to be printed / saved as PDF and handed to the
// client), with the panel chrome hidden when printing.

const C = { text: '#1f2937', muted: '#6b7280', border: '#e5e7eb', ok: '#16a34a', warn: '#d97706', bad: '#dc2626', accent: '#4f46e5' };

const CSS = `
.rpt-shell { min-height: 100vh; background: #eef0f3; padding: 24px 12px; color: ${C.text}; }
.rpt { max-width: 900px; margin: 0 auto; background: #fff; padding: 40px 44px; border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0,0,0,.08); font: 14px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
.rpt h1 { font-size: 22px; margin: 0 0 4px; color: ${C.text}; }
.rpt h2 { font-size: 16px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 2px solid ${C.accent}; color: ${C.text}; }
.rpt h3 { font-size: 14px; margin: 16px 0 8px; color: ${C.text}; }
.rpt p { margin: 6px 0; }
.rpt .muted { color: ${C.muted}; }
.rpt table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 13px; background: #fff; }
.rpt th, .rpt td { border-bottom: 1px solid ${C.border}; padding: 6px 8px; text-align: left; color: ${C.text}; background: #fff; }
.rpt th { font-weight: 600; color: ${C.muted}; font-size: 12px; text-transform: none; }
.rpt tr { break-inside: avoid; }
.rpt .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin: 20px 0 4px; }
.rpt .tile { border: 1px solid ${C.border}; border-radius: 8px; padding: 10px 12px; }
.rpt .tile .v { font-size: 22px; font-weight: 700; }
.rpt .tile .l { font-size: 12px; color: ${C.muted}; }
.rpt .note { font-size: 12px; color: ${C.muted}; font-style: italic; }
.rpt .rec { padding: 6px 10px; margin: 4px 0; border-left: 3px solid; border-radius: 3px; background: #fafafa; }
.rpt-bar { max-width: 900px; margin: 0 auto 12px; display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.rpt-bar input { width: auto; }
@page { size: A4; margin: 14mm; }
@media print {
  .no-print { display: none !important; }
  .rpt-shell { background: #fff; padding: 0; }
  .rpt { box-shadow: none; padding: 0; max-width: none; border-radius: 0; }
  .rpt * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: #fff !important; }
}
`;

const sevColor = { critical: C.bad, warning: C.warn, info: C.muted };
const upColor = (v) => (v == null ? C.muted : v < 95 ? C.bad : v < 99 ? C.warn : C.ok);
const patchColor = { ok: C.ok, behind: C.warn, critical: C.bad, unknown: C.muted };
// forecastLine() speaks in panel theme variables; map them to document colours.
const themeToDoc = { 'var(--danger)': C.bad, 'var(--warning)': C.warn, 'var(--text)': C.text, 'var(--text-muted)': C.muted };

export default function CustomerReport() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const month = params.get('month') || '';
  const { t, lang } = useLang();
  const locale = lang === 'ru' ? 'ru-RU' : 'en-GB';
  const [r, setR] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setR(null); setError('');
    api.getCustomerReport(id, month).then(setR).catch(e => setError(e.message || String(e)));
  }, [id, month]);

  const fmtDate = (v) => (v ? new Date(v).toLocaleDateString(locale) : '—');
  const fmtDateTime = (v) => (v ? new Date(v).toLocaleString(locale) : '—');

  return (
    <div className="rpt-shell">
      <style>{CSS}</style>
      <div className="rpt-bar no-print">
        <Link to="/reports">{t('rpt.back')}</Link>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, marginLeft: 'auto' }}>
          {t('rpt.month')}
          <input type="month" value={r ? r.period.label : month} onChange={e => e.target.value && setParams({ month: e.target.value })} />
        </label>
        <button onClick={() => window.print()} disabled={!r}>🖨 {t('rpt.print')}</button>
      </div>

      <div className="rpt">
        {error ? <p style={{ color: C.bad }}>{t('rpt.error')}{error}</p>
          : !r ? <p className="muted">{t('common.loading')}</p>
          : <ReportBody r={r} t={t} locale={locale} fmtDate={fmtDate} fmtDateTime={fmtDateTime} />}
      </div>
    </div>
  );
}

function ReportBody({ r, t, locale, fmtDate, fmtDateTime }) {
  const monthName = new Date(r.period.start).toLocaleDateString(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const s = r.summary;
  const tile = (v, l, color) => (
    <div className="tile"><div className="v" style={color ? { color } : undefined}>{v}</div><div className="l">{l}</div></div>
  );

  return (
    <>
      <h1>{t('rpt.title')}</h1>
      <div style={{ fontSize: 18, fontWeight: 600 }}>{r.customer.name}</div>
      <p className="muted">
        {t('rpt.period')}: <b style={{ color: C.text }}>{monthName}</b> · {t('rpt.generated')}: {fmtDateTime(r.generated_at)}
      </p>

      <div className="tiles">
        {tile(s.servers, t('rpt.sum.servers'))}
        {tile(s.avgUptime != null ? s.avgUptime + '%' : '—', t('rpt.sum.uptime'), upColor(s.avgUptime))}
        {tile(s.critical, t('rpt.sum.critical'), s.critical ? C.bad : C.ok)}
        {tile(s.blocks, t('rpt.sum.blocks'))}
        {tile(s.threats, t('rpt.sum.threats'), s.threats ? C.bad : C.ok)}
        {tile(s.patchBehind, t('rpt.sum.patch'), s.patchBehind ? C.warn : C.ok)}
        {s.workstations > 0 && tile(s.workstations, t('rpt.sum.ws'))}
      </div>

      {/* 1. Availability */}
      <h2>{t('rpt.s.availability')}</h2>
      <table>
        <thead><tr><th>{t('rpt.col.server')}</th><th>{t('rpt.col.os')}</th><th>{t('rpt.col.uptime')}</th><th>{t('rpt.col.outages')}</th></tr></thead>
        <tbody>
          {r.servers.map(x => (
            <tr key={x.id}>
              <td><b>{x.name}</b></td>
              <td className="muted">{(x.os || '').replace(/^Microsoft\s+|^Майкрософт\s+/i, '') || '—'}</td>
              <td style={{ color: upColor(x.uptime), fontWeight: 600 }}>{x.uptime != null ? x.uptime + '%' : t('rpt.noData')}</td>
              <td>{x.offline || 0}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* 2. Incidents */}
      <h2>{t('rpt.s.incidents')}</h2>
      <p>{t('rpt.sev', { c: r.alerts.bySeverity.critical || 0, w: r.alerts.bySeverity.warning || 0, i: r.alerts.bySeverity.info || 0 })}</p>
      {r.alerts.byKind.length > 0 && (
        <>
          <h3>{t('rpt.byKind')}</h3>
          <table><tbody>
            {r.alerts.byKind.map(k => (
              <tr key={k.kind}><td>{t('rpt.kind.' + k.kind) !== 'rpt.kind.' + k.kind ? t('rpt.kind.' + k.kind) : (k.kind || '—')}</td><td style={{ width: 80 }}>{k.n}</td></tr>
            ))}
          </tbody></table>
        </>
      )}
      {r.alerts.top.length === 0 ? <p className="muted">{t('rpt.noIncidents')}</p> : (
        <>
          <h3>{t('rpt.notable')}</h3>
          <table>
            <thead><tr><th style={{ width: 140 }}>{t('rpt.col.time')}</th><th>{t('rpt.col.server')}</th><th>{t('rpt.col.event')}</th></tr></thead>
            <tbody>
              {r.alerts.top.map((a, i) => (
                <tr key={i}>
                  <td className="muted" style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(a.created_at)}</td>
                  <td>{a.host || '—'}</td>
                  <td><span style={{ color: sevColor[a.severity], fontWeight: 600 }}>●</span> {a.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {/* 3. Security */}
      <h2>{t('rpt.s.security')}</h2>
      <p>{t('rpt.fails', { n: r.security.fails, ips: r.security.ips })}</p>
      <p>{t('rpt.blocksLine', { n: r.security.blocks.total, auto: r.security.blocks.auto })}</p>
      {r.securityPartial && <p className="note">{t('rpt.partial')}</p>}
      {r.security.topIps.length > 0 && (
        <>
          <h3>{t('rpt.topIps')}</h3>
          <table>
            <thead><tr><th>{t('rpt.col.ip')}</th><th>{t('rpt.col.attempts')}</th><th>{t('rpt.col.accounts')}</th></tr></thead>
            <tbody>{r.security.topIps.map(x => (
              <tr key={x.ip}><td style={{ fontFamily: 'monospace' }}>{x.ip}</td><td>{x.n}</td><td>{x.accounts}</td></tr>
            ))}</tbody>
          </table>
        </>
      )}

      <h3>{t('rpt.threats')}</h3>
      {r.threats.length === 0 ? <p className="muted">{t('rpt.noThreats')}</p> : (
        <table>
          <thead><tr><th>{t('rpt.col.time')}</th><th>{t('rpt.col.server')}</th><th>{t('rpt.col.threat')}</th><th>{t('rpt.col.result')}</th></tr></thead>
          <tbody>{r.threats.map((x, i) => (
            <tr key={i}>
              <td className="muted">{fmtDate(x.detected_at)}</td><td>{x.host}</td><td><b>{x.name}</b></td>
              <td style={{ color: x.action_success ? C.ok : C.bad, fontWeight: 600 }}>{x.action_success ? t('rpt.neutralised') : t('rpt.notNeutralised')}</td>
            </tr>
          ))}</tbody>
        </table>
      )}

      {r.antivirus.length > 0 && (
        <>
          <h3>{t('rpt.av')}</h3>
          <table>
            <thead><tr><th>{t('rpt.col.server')}</th><th>{t('rpt.col.av')}</th><th>{t('rpt.col.sig')}</th></tr></thead>
            <tbody>{r.antivirus.map((a, i) => {
              const on = a.available && a.av_enabled && a.realtime_enabled;
              return (
                <tr key={i}>
                  <td>{a.host}</td>
                  <td style={{ color: a.third_party ? C.muted : on ? C.ok : C.bad, fontWeight: 600 }}>
                    {a.third_party ? t('rpt.avThird') : on ? t('rpt.avOk') : t('rpt.avOff')}
                  </td>
                  <td style={{ color: a.signature_age_days > 3 ? C.warn : C.text }}>
                    {a.third_party || a.signature_age_days == null ? '—' : t('rpt.days', { n: a.signature_age_days })}
                  </td>
                </tr>
              );
            })}</tbody>
          </table>
        </>
      )}

      {r.servers.some(x => x.score != null) && (
        <>
          <h3>{t('rpt.score')}</h3>
          <table>
            <thead><tr><th>{t('rpt.col.server')}</th><th>{t('rpt.col.score')}</th></tr></thead>
            <tbody>{r.servers.filter(x => x.score != null).map(x => (
              <tr key={x.id}><td>{x.name}</td>
                <td style={{ color: x.score >= 90 ? C.ok : x.score >= 70 ? C.warn : C.bad, fontWeight: 600 }}>{x.score}/100</td></tr>
            ))}</tbody>
          </table>
        </>
      )}

      {/* 4. Updates */}
      <h2>{t('rpt.s.updates')}</h2>
      <p className="note">{t('rpt.updatesNote')}</p>
      <table>
        <thead><tr><th>{t('rpt.col.server')}</th><th>{t('rpt.col.lastUpdate')}</th><th>{t('rpt.col.status')}</th></tr></thead>
        <tbody>{r.servers.filter(x => x.patch).map(x => (
          <tr key={x.id}>
            <td>{x.name}</td>
            <td>{x.patch.days != null ? t('rpt.daysAgo', { n: x.patch.days }) : '—'}</td>
            <td style={{ color: patchColor[x.patch.status], fontWeight: 600 }}>{t('rpt.p.' + x.patch.status)}</td>
          </tr>
        ))}</tbody>
      </table>
      {r.workstations.total > 0 && <p>{t('rpt.wsPatch', { n: r.workstations.patchBehind, total: r.workstations.total })}</p>}

      {/* 5. Disks */}
      <h2>{t('rpt.s.disks')}</h2>
      <p className="note">{t('rpt.updatesNote')}</p>
      <table>
        <thead><tr><th>{t('rpt.col.server')}</th><th>{t('rpt.col.volume')}</th><th>{t('rpt.col.usage')}</th><th>{t('rpt.col.forecast')}</th></tr></thead>
        <tbody>{r.disks.map((d, i) => {
          const pct = d.total > 0 ? Math.round(d.used / d.total * 100) : null;
          const fl = forecastLine(t, { status: d.status, days: d.days, rate: d.rate, r2: d.r2 });
          return (
            <tr key={i}>
              <td>{d.host}</td><td>{d.drive}</td>
              <td style={{ color: pct >= 90 ? C.bad : pct >= 80 ? C.warn : C.text }}>
                {d.used != null ? `${Math.round(d.used)} / ${Math.round(d.total)} GB` : '—'}{pct != null ? ` (${pct}%)` : ''}
              </td>
              <td style={{ color: fl ? (themeToDoc[fl.color] || C.muted) : C.muted, fontSize: 12 }}>{fl ? fl.text : '—'}</td>
            </tr>
          );
        })}</tbody>
      </table>

      {/* 6. Workstations */}
      <h2>{t('rpt.s.ws')}</h2>
      {r.workstations.total === 0 ? <p className="muted">{t('rpt.noWs')}</p> : (
        <>
          <p>{t('rpt.wsTotal', { n: r.workstations.total })}{r.workstations.stale > 0 ? ' ' + t('rpt.wsStale', { n: r.workstations.stale }) : ''}</p>
          <table>
            <thead><tr><th>{t('rpt.col.osName')}</th><th style={{ width: 80 }}>{t('rpt.col.count')}</th></tr></thead>
            <tbody>{r.workstations.byOs.map(o => <tr key={o.os}><td>{o.os}</td><td>{o.n}</td></tr>)}</tbody>
          </table>
        </>
      )}

      {/* 7. Recommendations */}
      <h2>{t('rpt.s.recs')}</h2>
      {r.recommendations.length === 0 ? <p style={{ color: C.ok }}>{t('rpt.noRecs')}</p>
        : r.recommendations.map((x, i) => (
          <div key={i} className="rec" style={{ borderLeftColor: sevColor[x.severity] }}>
            {t('rpt.rec.' + x.code, { host: x.host || '', drive: x.drive || '', value: x.value ?? '' })}
          </div>
        ))}
    </>
  );
}
