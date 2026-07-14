import { useState } from 'react';
import { api } from '../api';

export default function Deploy() {
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

        <div style={{ marginTop: 20, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={handleDownload} style={{ fontSize: 16, padding: '12px 32px' }}>
            Download deployer (.ps1)
          </button>
          <button className="secondary" onClick={handleDownloadLauncher} style={{ fontSize: 16, padding: '12px 24px' }}>
            Download launcher (.cmd)
          </button>
          {copied && <span style={{ color: 'var(--success)' }}>Downloaded</span>}
        </div>
        <div style={{ marginTop: 16, background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 16px' }}>
          <b style={{ fontSize: 14 }}>Easiest way to run — no unblock, no manual admin:</b>
          <ol style={{ color: 'var(--text-muted)', paddingLeft: 20, lineHeight: 1.9, marginTop: 8, marginBottom: 0 }}>
            <li>Download <b>both</b> files above into the <b>same folder</b>.</li>
            <li>Double-click <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>winserv-deployer.cmd</code> — it requests admin (UAC) and runs the deployer with the execution policy bypassed.</li>
          </ol>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: '8px 0 0' }}>
            The .ps1 also self-elevates and unblocks itself, so running it directly with
            <code style={{ background: 'var(--bg)', padding: '1px 6px', borderRadius: 4 }}>powershell -ExecutionPolicy Bypass -File winserv-deployer.ps1</code> works too.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>Manual Installation (single server)</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0 0' }}>
          For individual servers, use the <b>Agent Script</b> from the Settings page.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 24 }}>
        <h3>🐧 Linux agent (Ubuntu / Debian)</h3>
        <p style={{ color: 'var(--text-muted)', margin: '12px 0' }}>
          Run this one-liner on the Linux host as root. It installs the agent and a systemd timer;
          the host registers itself and appears in the dashboard within 1–2 minutes. Same features as
          the Windows agent: metrics, processes, failed services, SSH brute-force, inventory, self-update.
        </p>
        {linuxCmd ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input readOnly value={linuxCmd} onFocus={e => e.target.select()}
              style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }} />
            <button type="button" className="secondary" onClick={copyLinux}>{linuxCopied ? 'Copied!' : 'Copy'}</button>
          </div>
        ) : (
          <button onClick={loadLinuxCmd}>Show install command</button>
        )}
        <p style={{ color: 'var(--text-muted)', fontSize: 12, marginTop: 10 }}>
          Needs only outbound HTTPS from the host. The command contains the registration key — treat it as a secret.
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
          <li><b>Domain Admin rights</b> — local admin on each target (remote task creation)</li>
          <li><b>Admin share C$</b> reachable — <b>TCP 445 (SMB)</b>, used to copy the agent</li>
          <li><b>WinRM enabled</b> — <b>TCP 5985</b>. Required: the deployer creates the scheduled task via <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>Invoke-Command</code>. Enable with <code style={{ background: 'var(--bg)', padding: '2px 6px', borderRadius: 4 }}>Enable-PSRemoting -Force</code></li>
          <li><b>ICMP not required</b> — hardened hosts often block ping; the deployer no longer gates on it</li>
          <li>After install the agent needs <b>outbound HTTPS only</b> — no inbound ports</li>
        </ul>
      </div>
    </div>
  );
}
