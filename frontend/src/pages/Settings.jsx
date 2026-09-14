import { useState, useEffect } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Settings() {
  const { t } = useLang();
  const [config, setConfig] = useState({ bot_token: '', chat_id: '', enabled: false, notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true, offline_minutes: 3, cpu_threshold: 90, memory_threshold: 95, disk_threshold: 90, authorized_chats: '', viewer_chats: '', webhook_secret: '', digest_enabled: false, digest_hour: 9, flap_threshold: 6, alert_webhook_url: '', alert_webhook_enabled: false, notify_bruteforce: true, bruteforce_threshold: 10, service_ignore: '', metric_interval: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [agentScripts, setAgentScripts] = useState('');
  const [showAgent, setShowAgent] = useState(false);
  const [triggers, setTriggers] = useState([]);
  const [protectedRanges, setProtectedRanges] = useState([]);
  const [presetBusy, setPresetBusy] = useState(false);
  const [trigForm, setTrigForm] = useState({ event_id: '', log_name: 'System', source_match: '', label: '', severity: 'warning' });

  useEffect(() => {
    api.getTelegramConfig().then(data => setConfig(prev => ({ ...prev, ...data }))).finally(() => setLoading(false));
    api.getEventTriggers().then(setTriggers).catch(() => {});
    api.getProtectedRanges().then(setProtectedRanges).catch(() => {});
  }, []);

  async function addTrigger(e) {
    e.preventDefault();
    if (!trigForm.event_id) return;
    await api.createEventTrigger(trigForm);
    setTrigForm({ event_id: '', log_name: 'System', source_match: '', label: '', severity: 'warning' });
    api.getEventTriggers().then(setTriggers);
  }
  async function toggleTrigger(t) {
    await api.updateEventTrigger(t.id, { enabled: t.enabled ? 0 : 1 });
    api.getEventTriggers().then(setTriggers);
  }
  async function removeTrigger(id) {
    if (!confirm(t('st.trigDeleteConfirm'))) return;
    await api.deleteEventTrigger(id);
    api.getEventTriggers().then(setTriggers);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api.updateTelegramConfig(config);
      setMessage(t('st.saved'));
    } catch (err) {
      setMessage(t('st.errorPrefix') + err.message);
    }
    setSaving(false);
  }

  async function handleTest() {
    try {
      await api.testTelegram();
      setMessage(t('st.testSent'));
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
  }

  async function loadAgentScripts() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/agent/script', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    setAgentScripts(text);
    setShowAgent(!showAgent);
  }

  if (loading) return <div className="loading">{t('common.loading')}</div>;

  return (
    <div>
      <div className="page-header"><h1>{t('st.title')}</h1></div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('st.tg')}</h3>
        <form onSubmit={handleSave}>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>{t('st.botToken')}</label>
            <input type="password" value={config.bot_token} onChange={e => setConfig({ ...config, bot_token: e.target.value })} placeholder="123456:ABC-DEF..." />
          </div>
          <div className="form-group">
            <label>{t('st.chatId')}</label>
            <input value={config.chat_id} onChange={e => setConfig({ ...config, chat_id: e.target.value })} placeholder="-100123456789 or @channel" />
          </div>
          <div className="form-group">
            <div className="toggle-wrapper" onClick={() => setConfig({ ...config, enabled: !config.enabled })}>
              <div className={`toggle ${config.enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
              <label>{t('st.enabled')}</label>
            </div>
          </div>
          {config.enabled && (
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_cpu: !config.notify_cpu })}>
                <div className={`toggle ${config.notify_cpu ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('st.cpuAlerts')}</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_disk: !config.notify_disk })}>
                <div className={`toggle ${config.notify_disk ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('st.diskAlerts')}</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_errors: !config.notify_errors })}>
                <div className={`toggle ${config.notify_errors ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('st.memAlerts')}</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_offline: !config.notify_offline })}>
                <div className={`toggle ${config.notify_offline ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('st.offlineAlerts')}</label>
              </div>
            </div>
          )}
          {config.enabled && (
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>{t('st.offlineDetect')}</label>
              <input type="number" min="1" max="30" value={config.offline_minutes || 3} onChange={e => setConfig({ ...config, offline_minutes: e.target.value })} style={{ width: 100 }} />
            </div>
          )}
          {config.enabled && (
            <>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>{t('st.thresholds')}</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>CPU &gt; %</label>
                  <input type="number" min="1" max="100" value={config.cpu_threshold || 90} onChange={e => setConfig({ ...config, cpu_threshold: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>Memory &gt; %</label>
                  <input type="number" min="1" max="100" value={config.memory_threshold || 95} onChange={e => setConfig({ ...config, memory_threshold: e.target.value })} />
                </div>
                <div style={{ flex: 1 }}>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>Disk &gt; %</label>
                  <input type="number" min="1" max="100" value={config.disk_threshold || 90} onChange={e => setConfig({ ...config, disk_threshold: e.target.value })} />
                </div>
              </div>
            </>
          )}
          {config.enabled && (
            <>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>{t('st.digestFlap')}</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="toggle-wrapper" onClick={() => setConfig({ ...config, digest_enabled: !config.digest_enabled })}>
                  <div className={`toggle ${config.digest_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
                  <label style={{ cursor: 'pointer' }}>{t('st.dailyDigest')}</label>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>{t('st.digestHour')}</label>
                  <input type="number" min="0" max="23" value={config.digest_hour ?? 9} onChange={e => setConfig({ ...config, digest_hour: e.target.value })} style={{ width: 100 }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>{t('st.flapAfter')}</label>
                  <input type="number" min="2" value={config.flap_threshold ?? 6} onChange={e => setConfig({ ...config, flap_threshold: e.target.value })} style={{ width: 120 }} />
                </div>
              </div>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>{t('st.bruteTitle')}</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_bruteforce: !config.notify_bruteforce })}>
                  <div className={`toggle ${config.notify_bruteforce ? 'on' : ''}`}><div className="toggle-knob" /></div>
                  <label style={{ cursor: 'pointer' }}>{t('st.bruteAlert')}</label>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>{t('st.bruteThresh')}</label>
                  <input type="number" min="3" value={config.bruteforce_threshold ?? 10} onChange={e => setConfig({ ...config, bruteforce_threshold: e.target.value })} style={{ width: 160 }} />
                </div>
              </div>
              <div className="form-group">
                <label>{t('st.adminChats')}</label>
                <input value={config.authorized_chats || ''} onChange={e => setConfig({ ...config, authorized_chats: e.target.value })} placeholder="123456789" />
              </div>
              <div className="form-group">
                <label>{t('st.viewerChats')}</label>
                <input value={config.viewer_chats || ''} onChange={e => setConfig({ ...config, viewer_chats: e.target.value })} placeholder="-10012345,987654321" />
              </div>
              <div className="form-group">
                <label>{t('st.webhookSecret')}</label>
                <input value={config.webhook_secret || ''} onChange={e => setConfig({ ...config, webhook_secret: e.target.value })} placeholder="random-secret-string" />
              </div>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>{t('st.extraChannel')}</label>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, alert_webhook_enabled: !config.alert_webhook_enabled })} style={{ marginBottom: 8 }}>
                <div className={`toggle ${config.alert_webhook_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>{t('st.sendWebhook')}</label>
              </div>
              <div className="form-group">
                <label>{t('st.webhookUrl')}</label>
                <input value={config.alert_webhook_url || ''} onChange={e => setConfig({ ...config, alert_webhook_url: e.target.value })} placeholder="https://hooks.slack.com/services/..." />
              </div>
            </>
          )}
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>{t('st.metricInterval')}</label>
            <input type="number" min="1" max="1439" value={config.metric_interval ?? 1} onChange={e => setConfig({ ...config, metric_interval: e.target.value })} style={{ width: 120 }} />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('st.metricNote')}
            </div>
          </div>
          <div className="toggle-wrapper" onClick={() => setConfig({ ...config, agent_auto_update: !config.agent_auto_update })} style={{ marginTop: 16 }}>
            <div className={`toggle ${config.agent_auto_update ? 'on' : ''}`}><div className="toggle-knob" /></div>
            <label>{t('st.autoUpdate')}</label>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '4px 0 8px' }}>
            {t('st.autoUpdateNote')}
          </div>

          <div className="form-group" style={{ marginTop: 16 }}>
            <label>{t('st.ignoredSvc')}</label>
            <textarea value={config.service_ignore || ''} onChange={e => setConfig({ ...config, service_ignore: e.target.value })} rows={4} placeholder="sppsvc&#10;googleupdate&#10;remoteregistry" style={{ fontFamily: 'monospace', fontSize: 13 }} />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {t('st.ignoredNote')}
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={saving}>{t('common.save')}</button>
            <button type="button" className="secondary" onClick={handleTest}>{t('st.testMsg')}</button>
            {message && <span style={{ fontSize: 13, color: message.startsWith(t('st.errorPrefix')) ? 'var(--danger)' : 'var(--success)', alignSelf: 'center' }}>{message}</span>}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('st.ransomTitle')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 12px' }}>
          {t('st.ransomDesc')}
        </p>
        <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_ransomware: !config.notify_ransomware })} style={{ marginBottom: 10 }}>
          <div className={`toggle ${config.notify_ransomware ? 'on' : ''}`}><div className="toggle-knob" /></div>
          <label>{t('st.ransomAlert')}</label>
        </div>
        <div className="toggle-wrapper" onClick={() => setConfig({ ...config, ransomware_canary: !config.ransomware_canary })}>
          <div className={`toggle ${config.ransomware_canary ? 'on' : ''}`}><div className="toggle-knob" /></div>
          <label>{t('st.ransomCanary')}</label>
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', margin: '6px 0 12px' }}>
          {t('st.ransomCanaryNote')}
        </div>
        <button type="button" onClick={handleSave} disabled={saving}>{t('st.ransomSave')}</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('st.abTitle')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>
          {t('st.abDesc')}
        </p>
        <div className="toggle-wrapper" onClick={() => setConfig({ ...config, autoban_enabled: !config.autoban_enabled })} style={{ marginBottom: 12 }}>
          <div className={`toggle ${config.autoban_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
          <label>{t('st.abEnable')}</label>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group">
            <label>{t('st.abThresh')}</label>
            <input type="number" min="5" value={config.autoban_threshold ?? 30} onChange={e => setConfig({ ...config, autoban_threshold: e.target.value })} style={{ width: 140 }} />
          </div>
          <div className="form-group">
            <label>{t('st.abWindow')}</label>
            <input type="number" min="1" max="1440" value={config.autoban_window_minutes ?? 60} onChange={e => setConfig({ ...config, autoban_window_minutes: e.target.value })} style={{ width: 160 }} />
          </div>
          <div className="form-group">
            <label>{t('st.abDuration')}</label>
            <input type="number" min="0" value={config.autoban_minutes ?? 1440} onChange={e => setConfig({ ...config, autoban_minutes: e.target.value })} style={{ width: 180 }} />
          </div>
          <div className="form-group">
            <label>{t('st.abMinAcc')}</label>
            <input type="number" min="1" value={config.autoban_min_accounts ?? 3} onChange={e => setConfig({ ...config, autoban_min_accounts: e.target.value })} style={{ width: 160 }} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          {t('st.abHow', { n: config.autoban_min_accounts ?? 3 })}
        </p>

        <div className="form-group">
          <label>{t('st.abBadAcc')}</label>
          <textarea value={config.autoban_bad_accounts || ''} onChange={e => setConfig({ ...config, autoban_bad_accounts: e.target.value })} rows={4}
            placeholder={'administrator\nguest\nroot\nauditor'} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('st.abBadNote')}
          </div>
        </div>

        <div className="form-group">
          <label>{t('st.abProtAcc')}</label>
          <textarea value={config.autoban_protected_accounts || ''} onChange={e => setConfig({ ...config, autoban_protected_accounts: e.target.value })} rows={3}
            placeholder={'DmitrievAV\nNedlinVE'} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('st.abProtNote')}
          </div>
        </div>
        <div className="form-group">
          <label>{t('st.abBuiltin')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {protectedRanges.map(p => (
              <span key={p.cidr} title={p.label}
                style={{ fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--success, #22c55e)' }}>
                🛡 {p.cidr}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            {t('st.abBuiltinNote')}
          </div>
        </div>

        <div className="form-group">
          <label>{t('st.abAllowlist')}</label>
          <textarea value={config.autoban_allowlist || ''} onChange={e => setConfig({ ...config, autoban_allowlist: e.target.value })} rows={4}
            placeholder={'203.0.113.7\n45.10.20.0/24  (office egress)\n2a01:4f8::/29'} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            {t('st.abAllowNote')}
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}>{t('st.abSave')}</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('st.etTitle')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>
          {t('st.etDesc')}
        </p>
        <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>{t('st.etPreset')}</b>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
              {t('st.etPresetDesc')}
            </span>
            <button type="button" style={{ marginLeft: 'auto' }} disabled={presetBusy} onClick={async () => {
              setPresetBusy(true);
              try {
                const r = await api.applyEventPreset();
                const t = await api.getEventTriggers(); setTriggers(t);
                alert(r.added ? t('st.etPresetAdded', { added: r.added, total: r.total }) : t('st.etPresetAll'));
              } catch (e) { alert(e.message); }
              setPresetBusy(false);
            }}>{t('st.etAddPreset')}</button>
          </div>
          <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 8 }}>
            {t('st.etAuditNote')}
          </div>
        </div>

        <form onSubmit={addTrigger} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('st.etEventId')}</label><input type="number" value={trigForm.event_id} onChange={e => setTrigForm({ ...trigForm, event_id: e.target.value })} required style={{ width: 100 }} placeholder="6008" /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('st.etLog')}</label><select value={trigForm.log_name} onChange={e => setTrigForm({ ...trigForm, log_name: e.target.value })} style={{ width: 130 }}><option>System</option><option>Application</option><option>Security</option><option>Setup</option></select></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('st.etSource')}</label><input value={trigForm.source_match} onChange={e => setTrigForm({ ...trigForm, source_match: e.target.value })} style={{ width: 130 }} placeholder={t('st.etOptional')} /></div>
          <div style={{ flex: '1 1 160px' }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('st.etLabel')}</label><input value={trigForm.label} onChange={e => setTrigForm({ ...trigForm, label: e.target.value })} placeholder={t('st.etLabelPh')} /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t('st.etSeverity')}</label><select value={trigForm.severity} onChange={e => setTrigForm({ ...trigForm, severity: e.target.value })} style={{ width: 110 }}><option value="info">{t('al.sev.info')}</option><option value="warning">{t('al.sev.warning')}</option><option value="critical">{t('al.sev.critical')}</option></select></div>
          <button type="submit">{t('common.add')}</button>
        </form>
        {triggers.length === 0 ? (
          <div className="empty"><p>{t('st.etEmpty')}</p></div>
        ) : (
          <table>
            <thead><tr><th>{t('st.etEventId').replace(' *','')}</th><th>{t('st.etLog')}</th><th>{t('st.etColSource')}</th><th>{t('st.etLabel')}</th><th>{t('st.etSeverity')}</th><th>{t('mnt.state')}</th><th></th></tr></thead>
            <tbody>
              {triggers.map(trg => (
                <tr key={trg.id} style={trg.enabled ? {} : { opacity: 0.5 }}>
                  <td><strong>{trg.event_id}</strong></td>
                  <td style={{ fontSize: 13 }}>{trg.log_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{trg.source_match || '-'}</td>
                  <td style={{ fontSize: 13 }}>{trg.label || '-'}</td>
                  <td style={{ fontSize: 12 }}>{trg.severity}</td>
                  <td><button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => toggleTrigger(trg)}>{trg.enabled ? t('st.on') : t('st.off')}</button></td>
                  <td><button className="danger" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => removeTrigger(trg.id)}>{t('common.del')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>{t('st.agentTitle')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>{t('st.agentDesc')}</p>
        <button onClick={loadAgentScripts}>{showAgent ? t('st.agentHide') : t('st.agentShow')}</button>
        {showAgent && (
          <div className="script-container" style={{ maxHeight: 700, overflow: 'auto', marginTop: 16 }}>
            <pre>{agentScripts}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
