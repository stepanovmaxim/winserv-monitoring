import { useState, useEffect, useMemo } from 'react';
import { api } from '../api';

function fmtDate(v) {
  if (!v) return '-';
  try { return new Date(v).toLocaleString(); } catch { return String(v); }
}
function parseJson(v, fallback) {
  if (Array.isArray(v)) return v;
  try { return JSON.parse(v || '[]'); } catch { return fallback; }
}

export default function Workstations() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    api.getWorkstations().then(r => { setRows(r); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(w => [w.hostname, w.model, w.os_caption, w.last_user, w.ad_ou, w.customer_name, w.ip]
      .some(f => String(f || '').toLowerCase().includes(t)));
  }, [rows, q]);

  const openDetail = (id) => {
    setDetail({ loading: true });
    api.getWorkstation(id).then(w => setDetail(w)).catch(() => setDetail(null));
  };

  const stale = (v) => {
    if (!v) return true;
    return (Date.now() - new Date(v).getTime()) > 3 * 24 * 3600 * 1000; // no report in 3 days
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 8 }}>
        <h1 style={{ margin: 0 }}>Рабочие станции <span style={{ color: 'var(--text-muted)', fontSize: 15, fontWeight: 400 }}>({rows.length})</span></h1>
        <input placeholder="Поиск: имя, модель, ОС, пользователь, OU…" value={q} onChange={e => setQ(e.target.value)}
          style={{ minWidth: 280, maxWidth: '100%' }} />
      </div>

      <div className="card">
        {loading ? (
          <div className="empty"><p>Загрузка…</p></div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <div className="empty-icon">💻</div>
            <p>Пока нет данных о ПК. Настройте GPO-скрипт <code>getcfg.ps1</code> и хост-ретранслятор — см. tools/GETCFG-DEPLOY.md.</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty"><p>Ничего не найдено по «{q}».</p></div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead><tr>
                <th>Имя</th><th>Заказчик</th><th>Модель</th><th>ОС</th><th>CPU / RAM</th>
                <th>Пользователь</th><th>IP</th><th>Патчи</th><th>Собрано</th>
              </tr></thead>
              <tbody>
                {filtered.map(w => (
                  <tr key={w.id} style={{ cursor: 'pointer' }} onClick={() => openDetail(w.id)}>
                    <td>
                      <b>{w.hostname || '—'}</b>
                      {w.clone_of && <span title="Похоже на клон образа (общий MachineGuid, другой серийник)" style={{ marginLeft: 6, color: 'var(--warning)', fontSize: 12 }}>⎘ клон</span>}
                      {stale(w.collected_at) && <span title="Нет свежих данных более 3 дней" style={{ marginLeft: 6, color: 'var(--text-muted)', fontSize: 12 }}>⏳</span>}
                    </td>
                    <td>{w.customer_name || <span style={{ color: 'var(--warning)' }}>—</span>}</td>
                    <td title={w.manufacturer}>{w.model || '-'}</td>
                    <td>{w.os_caption ? `${w.os_caption}${w.os_build ? ' (' + w.os_build + ')' : ''}` : '-'}</td>
                    <td>{w.cpu_logical ? `${w.cpu_logical} ядр` : ''}{w.ram_gb ? ` / ${w.ram_gb} ГБ` : '-'}</td>
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
            {detail.loading ? <p>Загрузка…</p> : <WorkstationDetail w={detail} onClose={() => setDetail(null)} />}
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

function WorkstationDetail({ w, onClose }) {
  const disks = parseJson(w.disks_json, []);
  const monitors = parseJson(w.monitors_json, []);
  const hotfixes = parseJson(w.hotfixes_json, []);
  const software = w.software || [];
  const [tab, setTab] = useState('hw');

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} style={{
      padding: '6px 12px', fontSize: 13, background: tab === k ? 'var(--accent)' : 'transparent',
      color: tab === k ? '#fff' : 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, marginRight: 6,
    }}>{label}</button>
  );

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0 }}>{w.hostname}
          {w.clone_of && <span style={{ marginLeft: 8, color: 'var(--warning)', fontSize: 13 }}>⎘ клон #{w.clone_of}</span>}
        </h2>
        <button onClick={onClose} style={{ padding: '4px 10px' }}>✕</button>
      </div>

      <div style={{ margin: '14px 0' }}>
        {tabBtn('hw', 'Железо и ОС')}
        {tabBtn('disks', `Диски (${disks.length})`)}
        {tabBtn('mon', `Мониторы (${monitors.length})`)}
        {tabBtn('soft', `ПО (${software.length})`)}
        {tabBtn('patch', `Патчи (${hotfixes.length})`)}
      </div>

      {tab === 'hw' && (
        <div>
          <Row label="Заказчик">{w.customer_name}</Row>
          <Row label="Домен / OU">{w.ad_domain}{w.ad_ou ? ` — ${w.ad_ou}` : ''}</Row>
          <Row label="Сайт AD">{w.ad_site}</Row>
          <Row label="Производитель">{w.manufacturer}</Row>
          <Row label="Модель">{w.model}{w.chassis ? ` (${w.chassis})` : ''}</Row>
          <Row label="Серийный номер">{w.serial}</Row>
          <Row label="ОС">{w.os_caption} {w.os_version} (сборка {w.os_build})</Row>
          <Row label="CPU">{w.cpu} — {w.cpu_cores} ядер / {w.cpu_logical} потоков</Row>
          <Row label="RAM">{w.ram_gb} ГБ</Row>
          <Row label="Сеть">{w.ip}{w.mac ? ` · ${w.mac}` : ''}</Row>
          <Row label="Пользователь">{w.last_user}</Row>
          <Row label="Загрузка">{fmtDate(w.last_boot)}</Row>
          <Row label="MachineGuid">{w.agent_uid}</Row>
          <Row label="Собрано / ретранслятор">{fmtDate(w.collected_at)}{w.relay_host ? ` · ${w.relay_host}` : ''}</Row>
        </div>
      )}

      {tab === 'disks' && (
        <table><thead><tr><th>Диск</th><th>Тип</th><th>Объём</th><th>Свободно</th><th>Здоровье</th></tr></thead>
          <tbody>{disks.length === 0 ? <tr><td colSpan="5">нет данных</td></tr> : disks.map((d, i) => (
            <tr key={i}><td>{d.model || '-'}</td><td>{d.media || '-'}</td>
              <td>{d.size_gb ? `${d.size_gb} ГБ` : '-'}</td>
              <td>{d.free_gb ? `${d.free_gb} ГБ` : '-'}</td>
              <td style={d.health && d.health !== 'Healthy' ? { color: 'var(--danger)' } : undefined}>{d.health || '-'}</td></tr>
          ))}</tbody></table>
      )}

      {tab === 'mon' && (
        <table><thead><tr><th>Производитель</th><th>Модель</th><th>Серийный номер</th></tr></thead>
          <tbody>{monitors.length === 0 ? <tr><td colSpan="3">нет данных</td></tr> : monitors.map((m, i) => (
            <tr key={i}><td>{m.manufacturer || '-'}</td><td>{m.model || '-'}</td><td>{m.serial || '-'}</td></tr>
          ))}</tbody></table>
      )}

      {tab === 'soft' && (
        <div style={{ maxHeight: 380, overflowY: 'auto' }}>
          <table><thead><tr><th>Программа</th><th>Версия</th><th>Издатель</th></tr></thead>
            <tbody>{software.length === 0 ? <tr><td colSpan="3">нет данных</td></tr> : software.map((p, i) => (
              <tr key={i}><td>{p.name}</td><td>{p.version || '-'}</td><td>{p.publisher || '-'}</td></tr>
            ))}</tbody></table>
        </div>
      )}

      {tab === 'patch' && (
        <div>
          <Row label="Последний патч">{w.last_patch_date}</Row>
          <table style={{ marginTop: 10 }}><thead><tr><th>KB</th><th>Установлен</th></tr></thead>
            <tbody>{hotfixes.length === 0 ? <tr><td colSpan="2">нет данных</td></tr> : hotfixes.map((h, i) => (
              <tr key={i}><td>{h.id}</td><td>{h.installed_on || '-'}</td></tr>
            ))}</tbody></table>
        </div>
      )}
    </div>
  );
}
