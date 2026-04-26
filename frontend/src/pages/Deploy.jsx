import { useState } from 'react';

export default function Deploy() {
  const [copied, setCopied] = useState(false);

  async function handleDownload() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/deploy/script', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const text = await res.text();
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'winserv-deployer.ps1';
    a.click();
    URL.revokeObjectURL(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div>
      <div className="page-header">
        <h1>Mass Deployment</h1>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Domain-wide Agent Deployment</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>
          Download the deployer script and run it on a domain-joined machine with <b>Domain Admin</b> rights.
          The script will:
        </p>
        <ol style={{ color: 'var(--text-muted)', paddingLeft: 20, lineHeight: 2 }}>
          <li>Discover all Windows Servers in your domain via Active Directory</li>
          <li>Show an interactive grid — select servers with checkboxes</li>
          <li>Remotely install the agent via <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>C$</code> admin share</li>
          <li>Create scheduled task to run every 1 minute</li>
          <li>Servers auto-register and appear in dashboard within 2 minutes</li>
        </ol>

        <div style={{ marginTop: 20 }}>
          <button onClick={handleDownload} style={{ fontSize: 16, padding: '12px 32px' }}>
            Download Deployer Script (deployer.ps1)
          </button>
          {copied && <span style={{ marginLeft: 12, color: 'var(--success)' }}>Downloaded</span>}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Manual Installation (single server)</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0 0' }}>
          For individual servers, use the <b>Agent Script</b> from the Settings page.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Update Agents</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>
          To update agents on all servers: download the deployer script and re-run it.
          It detects existing installations (shows version) and overwrites the agent.ps1 file.
          The scheduled task is re-created with updated settings.
        </p>
        <p style={{ color: 'var(--text-muted)' }}>
          Scheduled task command: <code style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: 4, fontSize: 12 }}>schtasks /create /tn "WinServAgent" /s SERVER /ru SYSTEM /sc minute /mo 1 /tr "powershell.exe -ExecutionPolicy Bypass -File C:\winserv-agent\agent.ps1" /f</code>
        </p>
      </div>

      <div className="card">
        <h3>Requirements</h3>
        <ul style={{ color: 'var(--text-muted)', paddingLeft: 20, lineHeight: 2 }}>
          <li><b>Active Directory PowerShell module</b> — on DC it's available; on Win10/11 run: <code style={{ background: 'var(--bg)', padding: '2px 8px', borderRadius: 4 }}>Install-WindowsFeature RSAT-AD-PowerShell</code></li>
          <li><b>Domain Admin rights</b> — needed for remote scheduled task creation</li>
          <li><b>Admin shares enabled</b> (C$) — default on Windows Server</li>
          <li><b>WinRM</b> (optional) — not required, script uses SMB + schtasks</li>
        </ul>
      </div>
    </div>
  );
}
