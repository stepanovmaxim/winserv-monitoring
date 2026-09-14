import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

function fmtDate(v) {
  if (!v) return '-';
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}
function parseJson(v, fallback) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return fallback; }
}

// CSV-escape one value and quote it. Newlines/quotes/commas are all handled.
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

function downloadCsv(filename, headers, rows) {
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) lines.push(r.map(csvCell).join(','));
  // Prepend a UTF-8 BOM so Excel opens Cyrillic correctly.
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function Workstations() {
  const { t } = useLang();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [domain, setDomain] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    api.getWorkstations().then(r => { setRows(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  // Distinct domains for the filter dropdown.
  const domains = useMemo(() => {
    const set = new Set();
    for (const w of rows) if (w.ad_domain) set.add(w.ad_domain);
    return Array.from(set).sort();
  }, [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows.filter(w => {
      if (domain && (w.ad_domain || '') !== domain) return false;
      if (!term) return true;
      return [w.hostname, w.model, w.os_caption, w.last_user, w.ad_ou, w.customer_name, w.ip]
        .some(f => String(f || '').toLowerCase().includes(term));
    });
  }, [rows, q, domain]);

  const exportCsv = () => {
    const headers = [t('ws.col.name'), t('ws.domain'), 'OU', t('ws.col.customer'), t('ws.f.vendor'),
      t('ws.col.model'), t('ws.col.os'), 'Build', 'CPU', 'RAM (GB)', 'IP', t('ws.col.user'),
      t('ws.f.boot'), t('ws.col.patch'), t('ws.col.collected')];
    const body = filtered.map(w => [
      w.hostname, w.ad_domain, w.ad_ou, w.customer_name, w.manufacturer, w.model,
      w.os_caption, w.os_build, w.cpu, w.ram_gb, w.ip, w.last_user,
      w.last_boot ? fmtDate(w.last_boot) : '', w.last_patch_date, w.collected_at ? fmtDate(w.collected_at) : '',
    ]);
    const tag = domain ? domain : 'all';
    const date = new Date().toISOString().slice(0, 10);
    downloadCsv(`workstations-${tag}-${date}.csv`, headers, body);
  };

  const openDetail = (id) => {
    setDetail({ loading: true });
    api.getWorkstation(id).then(w => setDetail(w)).catch(() => setDetail(null));
  };

  const stale = (v) => {
    if (!v) return true;
    return (Date.now() - new Date(v).getTime()) > 3 * 24 * 3600 * 1000;
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>{t('ws.title')} <span style={{ color: 'var(--text-muted)', fontSize: 15, fontWeight: 400 }}>({rows.length})</span></h1>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <select value={domain} onChange={e => setDomain(e.target.value)} style={{ minWidth: 140 }}>
            <option value="">{t('ws.domain')}: {t('common.all')}</option>
            {domains.map(d => <option key={d} value={d}>{d}</option>)}
          </select>
          <input placeholder={t('ws.search')} value={q} onChange={e => setQ(e.target.value)} style={{ minWidth: 240, maxWidth: '100%' }} />
          <button onClick={exportCsv} disabled={filtered.length === 0} title={t('common.export')}>⬇ {t('common.export')}</button>
        </div>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty"><p>{t('common.loading')}</p></div>
        ) : rows.length === 0 ? (
          <div className="empty"><div className="empty-icon">💻</div><p>{t('ws.empty')}</p></div>
        ) : filtered.length === 0 ? (
          <div className="empty"><p>{t('ws.notfound')} «{q || domain}».</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th>{t('ws.col.name')}</th><th>{t('ws.domain')}</th><th>{t('ws.col.customer')}</th>
                <th>{t('ws.col.model')}</th><th>{t('ws.col.os')}</th><th>{t('ws.col.cpuram')}</th>
                <th>{t('ws.col.user')}</th><th>{t('ws.col.ip')}</th><th>{t('ws.col.patch')}</th><th>{t('ws.col.collected')}</th>
              </tr></thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(w.id)}>
                    <td>
                      <b>{w.hostname || '—'}</b>
                      {w.clone_of && <span title={t('ws.clone.title')} style={{ marginLeft: 6, color: 'var(--warning)', fontSize: 12 }}>⎘ {t('ws.clone')}</span>}
                      {stale(w.collected_at) && <span title={t('ws.stale.title')} style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 12 }}>⏳</span>}
                    </td>
                    <td>{w.ad_domain || '-'}</td>
                    <td>{w.customer_name || <span style={{ color: 'var(--warning)' }}>—</span>}</td>
                    <td title={w.manufacturer}>{w.model || '-'}</td>
                    <td>{w.os_caption ? `${w.os_caption}${w.os_build ? ' (' + w.os_build + ')' : ''}` : '-'}</td>
                    <td>{w.cpu_logical ? `${w.cpu_logical} ${t('ws.cores')}` : ''}{w.ram_gb ? ` / ${w.ram_gb} GB` : '-'}</td>
                    <td>{w.last_user || '-'}</td>
                    <td>{w.ip || '-'}</td>
                    <td>{w.last_patch_date || '-'}</td>
                    <td style={stale(w.collected_at) ? { color: 'var(--text-muted)' } : undefined}>{fmtDate(w.collected_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detail && (
        <div className="modal-overlay" onClick={() => setDetail(null)}>
          <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760, width: '92%' }}>
            {detail.loading ? <p>{t('common.loading')}</p> : <WorkstationDetail w={detail} onClose={() => setDetail(null)} t={t} />}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '3px 0', fontSize: 14 }}>
      <div style={{ width: 150, color: 'var(--text-muted)', flexShrink: 0 }}>{label}</div>
      <div style={{ wordBreak: 'break-word' }}>{children || '-'}</div>
    </div>
  );
}

function WorkstationDetail({ w, onClose, t }) {
  const disks = parseJson(w.disks_json, []);
  const monitors = parseJson(w.monitors_json, []);
  const hotfixes = parseJson(w.hotfixes_json, []);
  const software = w.software || [];
  const [tab, setTab] = useState('hw');

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{
      padding: '6px 12px', fontSize: 13, background: tab === k ? 'var(--accent)' : 'transparent',
      color: tab === k ? '#fff' : 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, marginRight: 6, marginBottom: 6,
    }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{w.hostname}
          {w.clone_of && <span style={{ marginLeft: 8, color: 'var(--warning)', fontSize: 13 }}>⎘ {t('ws.clone')} #{w.clone_of}</span>}
        </h2>
        <button onClick={onClose} style={{ padding: '4px 10px' }}>✕</button>
      </div>

      <div style={{ margin: '14px 0' }}>
        {tabBtn('hw', t('ws.tab.hw'))}
        {tabBtn('disks', `${t('ws.tab.disks')} (${disks.length})`)}
        {tabBtn('mon', `${t('ws.tab.mon')} (${monitors.length})`)}
        {tabBtn('soft', `${t('ws.tab.soft')} (${software.length})`)}
        {tabBtn('patch', `${t('ws.tab.patch')} (${hotfixes.length})`)}
      </div>

      {tab === 'hw' && (
        <div>
          <Row label={t('ws.f.customer')}>{w.customer_name}</Row>
          <Row label={t('ws.f.domainou')}>{w.ad_domain}{w.ad_ou ? ` — ${w.ad_ou}` : ''}</Row>
          <Row label={t('ws.f.site')}>{w.ad_site}</Row>
          <Row label={t('ws.f.vendor')}>{w.manufacturer}</Row>
          <Row label={t('ws.f.model')}>{w.model}{w.chassis ? ` (${w.chassis})` : ''}</Row>
          <Row label={t('ws.f.serial')}>{w.serial}</Row>
          <Row label={t('ws.f.os')}>{w.os_caption} {w.os_version} ({w.os_build})</Row>
          <Row label={t('ws.f.cpu')}>{w.cpu} — {w.cpu_cores}/{w.cpu_logical}</Row>
          <Row label={t('ws.f.ram')}>{w.ram_gb} GB</Row>
          <Row label={t('ws.f.net')}>{w.ip}{w.mac ? ` · ${w.mac}` : ''}</Row>
          <Row label={t('ws.f.user')}>{w.last_user}</Row>
          <Row label={t('ws.f.boot')}>{fmtDate(w.last_boot)}</Row>
          <Row label={t('ws.f.uid')}>{w.agent_uid}</Row>
          <Row label={t('ws.f.collected')}>{fmtDate(w.collected_at)}{w.relay_host ? ` · ${w.relay_host}` : ''}</Row>
        </div>
      )}

      {tab === 'disks' && (
        <table><thead><tr><th>{t('ws.d.disk')}</th><th>{t('ws.d.type')}</th><th>{t('ws.d.size')}</th><th>{t('ws.d.free')}</th><th>{t('ws.d.health')}</th></tr></thead>
          <tbody>{disks.length === 0 ? <tr><td colSpan="5">{t('common.none')}</td></tr> : disks.map((d, i) => (
            <tr key={i}><td>{d.model || '-'}</td><td>{d.media || '-'}</td>
              <td>{d.size_gb ? `${d.size_gb} GB` : '-'}</td>
              <td>{d.free_gb ? `${d.free_gb} GB` : '-'}</td>
              <td style={d.health && d.health !== 'Healthy' ? { color: 'var(--danger)' } : undefined}>{d.health || '-'}</td></tr>
          ))}</tbody></table>
      )}

      {tab === 'mon' && (
        <table><thead><tr><th>{t('ws.m.vendor')}</th><th>{t('ws.m.model')}</th><th>{t('ws.m.serial')}</th></tr></thead>
          <tbody>{monitors.length === 0 ? <tr><td colSpan="3">{t('common.none')}</td></tr> : monitors.map((m, i) => (
            <tr key={i}><td>{m.manufacturer || '-'}</td><td>{m.model || '-'}</td><td>{m.serial || '-'}</td></tr>
          ))}</tbody></table>
      )}

      {tab === 'soft' && (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table><thead><tr><th>{t('ws.s.name')}</th><th>{t('ws.s.version')}</th><th>{t('ws.s.publisher')}</th></tr></thead>
            <tbody>{software.length === 0 ? <tr><td colSpan="3">{t('common.none')}</td></tr> : software.map((p, i) => (
              <tr key={i}><td>{p.name}</td><td>{p.version || '-'}</td><td>{p.publisher || '-'}</td></tr>
            ))}</tbody></table>
        </div>
      )}

      {tab === 'patch' && (
        <div>
          <Row label={t('ws.p.last')}>{w.last_patch_date}</Row>
          <table style={{ marginTop: 10 }}><thead><tr><th>{t('ws.p.kb')}</th><th>{t('ws.p.installed')}</th></tr></thead>
            <tbody>{hotfixes.length === 0 ? <tr><td colSpan="2">{t('common.none')}</td></tr> : hotfixes.map((h, i) => (
              <tr key={i}><td>{h.id}</td><td>{h.installed_on || '-'}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </div>
  );
}
