import { useState } from 'react';
import { api } from '../api';
import { useLang } from '../context/LanguageContext';

export default function Deploy() {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const [linuxCmd, setLinuxCmd] = useState('');
  const [linuxCopied, setLinuxCopied] = useState(false);

  async function loadLinuxCmd() {
    const d = await api.getLinuxOneLiner();
    setLinuxCmd(d.command);
  }
  function copyLinux() {
    navigator.clipboard?.writeText(linuxCmd);
    setLinuxCopied(true);
    setTimeout(() => setLinuxCopied(false), 1500);
  }

  async function download(path, filename) {
    const token = localStorage.getItem('token');
    const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
    const text = await res.text();
    const blob = new Blob([text], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleDownload() {
    await download('/api/deploy/script', 'winserv-deployer.ps1');
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  function handleDownloadLauncher() {
    download('/api/deploy/launcher', 'winserv-deployer.cmd');
  }

  const codeStyle = { background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 };

  return (
    <div>
      <div className="page-header">
        <h1>{t('dep.title')}</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('dep.h1')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>{t('dep.p1')}</p>
        <ol style={{ color: 'var(--text-muted)', paddingLeft: 20, lineHeight: 2 }}>
          <li>{t('dep.li1')}</li>
          <li>{t('dep.li2')}</li>
          <li>{t('dep.li3')}</li>
          <li>{t('dep.li4')}</li>
          <li>{t('dep.li5')}</li>
        </ol>

        <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleDownload} style={{ fontSize: 16, padding: '12px 32px' }}>{t('dep.dlPs1')}</button>
          <button className="secondary" onClick={handleDownloadLauncher} style={{ fontSize: 16, padding: '12px 24px' }}>{t('dep.dlCmd')}</button>
          {copied && <span style={{ color: 'var(--success)' }}>{t('dep.downloaded')}</span>}
        </div>
        <div style={{ marginTop: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px' }}>
          <b style={{ fontSize: 14 }}>{t('dep.easiest')}</b>
          <ol style={{ color: 'var(--text-muted)', paddingLeft: 20, lineHeight: 1.9, marginTop: 8, marginBottom: 0 }}>
            <li>{t('dep.easy1')}</li>
            <li>{t('dep.easy2a')} <code style={codeStyle}>winserv-deployer.cmd</code> {t('dep.easy2b')}</li>
          </ol>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>
            {t('dep.psNoteA')} <code style={codeStyle}>powershell -ExecutionPolicy Bypass -File winserv-deployer.ps1</code> {t('dep.psNoteB')}
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('dep.manualH')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0 0' }}>{t('dep.manualP')}</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('dep.linuxH')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>{t('dep.linuxP')}</p>
        {linuxCmd ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={linuxCmd} onFocus={e => e.target.select()} style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
            <button type="button" className="secondary" onClick={copyLinux}>{linuxCopied ? t('dep.copied') : t('dep.copy')}</button>
          </div>
        ) : (
          <button onClick={loadLinuxCmd}>{t('dep.showCmd')}</button>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10 }}>{t('dep.linuxNote')}</p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>{t('dep.updateH')}</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>{t('dep.updateP1')}</p>
        <p style={{ color: 'var(--text-muted)' }}>
          {t('dep.updateP2')} <code style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>schtasks /create /tn "WinServAgent" /s SERVER /ru SYSTEM /sc minute /mo 1 /tr "powershell.exe -ExecutionPolicy Bypass -File C:\winserv-agent\agent.ps1" /f</code>
        </p>
      </div>

      <div className="card">
        <h3>{t('dep.reqH')}</h3>
        <ul style={{ color: 'var(--text-muted)', paddingLeft: 20, lineHeight: 2 }}>
          <li><b>{t('dep.req1a')}</b> {t('dep.req1b')} <code style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: 4 }}>Install-WindowsFeature RSAT-AD-PowerShell</code></li>
          <li><b>{t('dep.req2a')}</b> {t('dep.req2b')}</li>
          <li><b>{t('dep.req3a')}</b> {t('dep.req3b')} <b>TCP 445 (SMB)</b>, {t('dep.req3c')}</li>
          <li><b>WinRM</b> — <b>TCP 5985</b>{t('dep.req4a')} (<code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>Enable-PSRemoting -Force</code>){t('dep.req4b')} <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>schtasks /s</code> {t('dep.req4c')}</li>
          <li><b>{t('dep.req5a')}</b> {t('dep.req5b')} <b>{t('dep.req5c')}</b> {t('dep.req5d')} <b>WMF 3.0+</b> {t('dep.req5e')}</li>
          <li><b>{t('dep.req6a')}</b> {t('dep.req6b')}</li>
          <li>{t('dep.req7a')} <b>{t('dep.req7b')}</b> {t('dep.req7c')}</li>
        </ul>
      </div>
    </div>
  );
}
