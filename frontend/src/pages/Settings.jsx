import { useState, useEffect } from 'react';
import { api } from '../api';

export default function Settings() {
  const [config, setConfig] = useState({ bot_token: '', chat_id: '', enabled: false, notify_disk: true, notify_cpu: true, notify_errors: true, notify_offline: true, offline_minutes: 3, cpu_threshold: 90, memory_threshold: 95, disk_threshold: 90, authorized_chats: '', viewer_chats: '', webhook_secret: '' });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [agentScripts, setAgentScripts] = useState('');
  const [showAgent, setShowAgent] = useState(false);

  useEffect(() => {
    api.getTelegramConfig().then(data => setConfig(prev => ({ ...prev, ...data }))).finally(() => setLoading(false));
  }, []);

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
                <label>Error alerts</label>
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
            </>
          )}
          <div className="form-actions">
            <button type="submit" disabled={saving}>Save</button>
            <button type="button" className="secondary" onClick={handleTest}>Test Message</button>
            {message && <span style={{ fontSize: 13, color: message.startsWith('Error') ? 'var(--danger)' : 'var(--success)', alignSelf: 'center' }}>{message}</span>}
          </div>
        </form>
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
