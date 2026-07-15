import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Settings() {
  const [config, setConfig] = useState({ bot_token: '', chat_id: '', enabled: false, notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true, offline_minutes: 3, cpu_threshold: 90, memory_threshold: 95, disk_threshold: 90, authorized_chats: '', viewer_chats: '', webhook_secret: '', digest_enabled: false, digest_hour: 9, flap_threshold: 6, alert_webhook_url: '', alert_webhook_enabled: false, notify_bruteforce: true, bruteforce_threshold: 10, service_ignore: '', metric_interval: 1 });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [agentScripts, setAgentScripts] = useState('');
  const [showAgent, setShowAgent] = useState(false);
  const [triggers, setTriggers] = useState([]);
  const [protectedRanges, setProtectedRanges] = useState([]);
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
    if (!confirm('Delete this trigger?')) return;
    await api.deleteEventTrigger(id);
    api.getEventTriggers().then(setTriggers);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await api.updateTelegramConfig(config);
      setMessage('Saved');
    } catch (err) {
      setMessage(`Error: ${err.message}`);
    }
    setSaving(false);
  }

  async function handleTest() {
    try {
      await api.testTelegram();
      setMessage('Test message sent!');
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

  if (loading) return <div className="loading">Loading...</div>;

  return (
    <div>
      <div className="page-header"><h1>Settings</h1></div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Telegram Notifications</h3>
        <form onSubmit={handleSave}>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Bot Token</label>
            <input type="password" value={config.bot_token} onChange={e => setConfig({ ...config, bot_token: e.target.value })} placeholder="123456:ABC-DEF..." />
          </div>
          <div className="form-group">
            <label>Chat ID</label>
            <input value={config.chat_id} onChange={e => setConfig({ ...config, chat_id: e.target.value })} placeholder="-100123456789 or @channel" />
          </div>
          <div className="form-group">
            <div className="toggle-wrapper" onClick={() => setConfig({ ...config, enabled: !config.enabled })}>
              <div className={`toggle ${config.enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
              <label>Enabled</label>
            </div>
          </div>
          {config.enabled && (
            <div className="grid grid-2" style={{ marginTop: 12 }}>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_cpu: !config.notify_cpu })}>
                <div className={`toggle ${config.notify_cpu ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>CPU alerts</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_disk: !config.notify_disk })}>
                <div className={`toggle ${config.notify_disk ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>Disk alerts</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_errors: !config.notify_errors })}>
                <div className={`toggle ${config.notify_errors ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>Memory alerts</label>
              </div>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_offline: !config.notify_offline })}>
                <div className={`toggle ${config.notify_offline ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>Offline alerts</label>
              </div>
            </div>
          )}
          {config.enabled && (
            <div className="form-group" style={{ marginTop: 16 }}>
              <label>Offline detection (minutes)</label>
              <input type="number" min="1" max="30" value={config.offline_minutes || 3} onChange={e => setConfig({ ...config, offline_minutes: e.target.value })} style={{ width: 100 }} />
            </div>
          )}
          {config.enabled && (
            <>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>Alert Thresholds (%)</label>
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
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>Daily digest & flapping</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="toggle-wrapper" onClick={() => setConfig({ ...config, digest_enabled: !config.digest_enabled })}>
                  <div className={`toggle ${config.digest_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
                  <label style={{ cursor: 'pointer' }}>Daily digest</label>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>Digest hour (0–23)</label>
                  <input type="number" min="0" max="23" value={config.digest_hour ?? 9} onChange={e => setConfig({ ...config, digest_hour: e.target.value })} style={{ width: 100 }} />
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>Flap alert after N/hr</label>
                  <input type="number" min="2" value={config.flap_threshold ?? 6} onChange={e => setConfig({ ...config, flap_threshold: e.target.value })} style={{ width: 120 }} />
                </div>
              </div>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>RDP brute-force detection</label>
              <div style={{ display: 'flex', gap: 16, marginBottom: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <div className="toggle-wrapper" onClick={() => setConfig({ ...config, notify_bruteforce: !config.notify_bruteforce })}>
                  <div className={`toggle ${config.notify_bruteforce ? 'on' : ''}`}><div className="toggle-knob" /></div>
                  <label style={{ cursor: 'pointer' }}>Alert on brute-force</label>
                </div>
                <div>
                  <label style={{ display: 'block', marginBottom: 4, fontSize: 12, color: 'var(--text-muted)' }}>Failed logons/hr from one IP</label>
                  <input type="number" min="3" value={config.bruteforce_threshold ?? 10} onChange={e => setConfig({ ...config, bruteforce_threshold: e.target.value })} style={{ width: 160 }} />
                </div>
              </div>
              <div className="form-group">
                <label>Admin Chat IDs (full access + alerts)</label>
                <input value={config.authorized_chats || ''} onChange={e => setConfig({ ...config, authorized_chats: e.target.value })} placeholder="123456789" />
              </div>
              <div className="form-group">
                <label>Viewer Chat IDs (hide/show commands)</label>
                <input value={config.viewer_chats || ''} onChange={e => setConfig({ ...config, viewer_chats: e.target.value })} placeholder="-10012345,987654321" />
              </div>
              <div className="form-group">
                <label>Webhook Secret Token</label>
                <input value={config.webhook_secret || ''} onChange={e => setConfig({ ...config, webhook_secret: e.target.value })} placeholder="random-secret-string" />
              </div>
              <label style={{ display: 'block', margin: '16px 0 8px', fontSize: 13, color: 'var(--text-muted)' }}>Extra alert channel (Slack / Teams / custom webhook)</label>
              <div className="toggle-wrapper" onClick={() => setConfig({ ...config, alert_webhook_enabled: !config.alert_webhook_enabled })} style={{ marginBottom: 8 }}>
                <div className={`toggle ${config.alert_webhook_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
                <label>Send alerts to webhook</label>
              </div>
              <div className="form-group">
                <label>Alert webhook URL</label>
                <input value={config.alert_webhook_url || ''} onChange={e => setConfig({ ...config, alert_webhook_url: e.target.value })} placeholder="https://hooks.slack.com/services/..." />
              </div>
            </>
          )}
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Metric interval (minutes)</label>
            <input type="number" min="1" max="1439" value={config.metric_interval ?? 1} onChange={e => setConfig({ ...config, metric_interval: e.target.value })} style={{ width: 120 }} />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              How often agents report and reschedule their task. Applied to already-deployed servers on their next check-in (agent v2.10+).
            </div>
          </div>
          <div className="form-group" style={{ marginTop: 16 }}>
            <label>Ignored services (health monitoring)</label>
            <textarea value={config.service_ignore || ''} onChange={e => setConfig({ ...config, service_ignore: e.target.value })} rows={4} placeholder="sppsvc&#10;googleupdate&#10;remoteregistry" style={{ fontFamily: 'monospace', fontSize: 13 }} />
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              One name prefix per line (or comma-separated), case-insensitive. Stopped auto-start services matching these are not alerted or shown in Health. Leave empty to monitor every service.
            </div>
          </div>
          <div className="form-actions">
            <button type="submit" disabled={saving}>Save</button>
            <button type="button" className="secondary" onClick={handleTest}>Test Message</button>
            {message && <span style={{ fontSize: 13, color: message.startsWith('Error') ? 'var(--danger)' : 'var(--success)', alignSelf: 'center' }}>{message}</span>}
          </div>
        </form>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Automatic IP ban (brute-force / DoS)</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>
          When a source IP exceeds the threshold of failed logons within an hour, a firewall block is pushed to the
          attacked server automatically. <b>Local, reserved, and allowlisted IPs are never banned</b>, and an IP that
          also logged in successfully in the last 24h is skipped (likely a real user). Requires agent v2.16+ / Linux v1.1+.
        </p>
        <div className="toggle-wrapper" onClick={() => setConfig({ ...config, autoban_enabled: !config.autoban_enabled })} style={{ marginBottom: 12 }}>
          <div className={`toggle ${config.autoban_enabled ? 'on' : ''}`}><div className="toggle-knob" /></div>
          <label>Enable auto-ban</label>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <div className="form-group">
            <label>Ban threshold (failed logons / hour)</label>
            <input type="number" min="5" value={config.autoban_threshold ?? 30} onChange={e => setConfig({ ...config, autoban_threshold: e.target.value })} style={{ width: 140 }} />
          </div>
          <div className="form-group">
            <label>Ban duration (minutes, 0 = permanent)</label>
            <input type="number" min="0" value={config.autoban_minutes ?? 1440} onChange={e => setConfig({ ...config, autoban_minutes: e.target.value })} style={{ width: 180 }} />
          </div>
          <div className="form-group">
            <label>Min distinct accounts to ban</label>
            <input type="number" min="1" value={config.autoban_min_accounts ?? 3} onChange={e => setConfig({ ...config, autoban_min_accounts: e.target.value })} style={{ width: 160 }} />
          </div>
        </div>
        <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '0 0 12px' }}>
          <b>Account diversity guard:</b> failures against fewer than this many distinct accounts are treated as a
          misconfigured client (e.g. an employee's stale Outlook password) and are <b>never</b> banned — only a
          password-spray across many accounts is. This is what tells a broken client apart from a real attack.
        </p>
        <div className="form-group">
          <label>Always protected (built-in — cannot be banned)</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {protectedRanges.map(p => (
              <span key={p.cidr} title={p.label}
                style={{ fontSize: 12, fontFamily: 'monospace', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px', color: 'var(--success, #22c55e)' }}>
                🛡 {p.cidr}
              </span>
            ))}
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Private (10/8, 172.16/12, 192.168/16), loopback, link-local, CGNAT and IPv6-local ranges are enforced in
            code — they are never banned even if the allowlist below is empty, and can't be removed.
          </div>
        </div>

        <div className="form-group">
          <label>Additional allowlist — your public IPs (IP or CIDR, one per line)</label>
          <textarea value={config.autoban_allowlist || ''} onChange={e => setConfig({ ...config, autoban_allowlist: e.target.value })} rows={4}
            placeholder={'203.0.113.7\n45.10.20.0/24  (office egress)\n2a01:4f8::/29'} style={{ fontFamily: 'monospace', fontSize: 13 }} />
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
            Put your office public IPs, VPN, and admin ranges here so they can never be auto-banned. Private ranges
            (10/8, 172.16/12, 192.168/16), loopback, and link-local are already protected automatically.
          </div>
        </div>
        <button type="button" onClick={handleSave} disabled={saving}>Save auto-ban settings</button>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Event ID triggers</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>
          Alert when a specific Windows Event Log ID appears on any server — e.g. <b>6008</b> unexpected shutdown,
          <b> 55</b> NTFS corruption, <b>7</b> disk bad block, <b>41</b> kernel power. The agent collects these from
          the chosen log regardless of level (agent v2.15+).
        </p>
        <form onSubmit={addTrigger} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Event ID *</label><input type="number" value={trigForm.event_id} onChange={e => setTrigForm({ ...trigForm, event_id: e.target.value })} required style={{ width: 100 }} placeholder="6008" /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Log</label><select value={trigForm.log_name} onChange={e => setTrigForm({ ...trigForm, log_name: e.target.value })} style={{ width: 130 }}><option>System</option><option>Application</option><option>Security</option><option>Setup</option></select></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Source contains</label><input value={trigForm.source_match} onChange={e => setTrigForm({ ...trigForm, source_match: e.target.value })} style={{ width: 130 }} placeholder="optional" /></div>
          <div style={{ flex: '1 1 160px' }}><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Label</label><input value={trigForm.label} onChange={e => setTrigForm({ ...trigForm, label: e.target.value })} placeholder="Unexpected shutdown" /></div>
          <div><label style={{ fontSize: 12, color: 'var(--text-muted)' }}>Severity</label><select value={trigForm.severity} onChange={e => setTrigForm({ ...trigForm, severity: e.target.value })} style={{ width: 110 }}><option value="info">Info</option><option value="warning">Warning</option><option value="critical">Critical</option></select></div>
          <button type="submit">Add</button>
        </form>
        {triggers.length === 0 ? (
          <div className="empty"><p>No triggers yet.</p></div>
        ) : (
          <table>
            <thead><tr><th>Event ID</th><th>Log</th><th>Source</th><th>Label</th><th>Severity</th><th>State</th><th></th></tr></thead>
            <tbody>
              {triggers.map(t => (
                <tr key={t.id} style={t.enabled ? {} : { opacity: 0.5 }}>
                  <td><strong>{t.event_id}</strong></td>
                  <td style={{ fontSize: 13 }}>{t.log_name}</td>
                  <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{t.source_match || '-'}</td>
                  <td style={{ fontSize: 13 }}>{t.label || '-'}</td>
                  <td style={{ fontSize: 12 }}>{t.severity}</td>
                  <td><button className="secondary" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => toggleTrigger(t)}>{t.enabled ? 'On' : 'Off'}</button></td>
                  <td><button className="danger" style={{ padding: '3px 10px', fontSize: 12 }} onClick={() => removeTrigger(t.id)}>Del</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>Agent Scripts</h3>
        <p style={{ color: 'var(--text-muted)', margin: '8px 0 16px' }}>Download the PowerShell agent script for all registered servers. Each includes a unique token.</p>
        <button onClick={loadAgentScripts}>{showAgent ? 'Hide' : 'Show'} Agent Scripts</button>
        {showAgent && (
          <div className="script-container" style={{ maxHeight: 700, overflow: 'auto', marginTop: 16 }}>
            <pre>{agentScripts}</pre>
          </div>
        )}
      </div>
    </div>
  );
}
