'use strict';
// The Updates window: a panel inside the editor, the same card the engine's apps have in Settings.
// Check, download, install (with the copyable command when the password prompt is not available), restart.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');
const up = require('./lib/updater');

class UpdateWindow {
  /** `context` is the extension context; `onAvailable(release)` is told when a check finds a newer version. */
  constructor(context) {
    this.context = context;
    this.panel = null;
    this.state = { phase: 'idle', current: '', latest: '', notes: '', url: '', message: '', command: '', progress: 0, canInstall: false, canUpdate: false, log: '', mode: '' };
    this.release = null;
    this.file = null;
    this.busy = false;
  }

  currentVersion() {
    const deb = up.installedVersion();
    return deb || this.context.extension.packageJSON.version;
  }

  /** 'deb' when installed from the package (can install updates here), else 'source' with the command that updates it. */
  mode() {
    return up.installedVersion() ? 'deb' : 'source';
  }

  show(autoCheck = true) {
    if (this.panel) { this.panel.reveal(); return; }
    this.panel = vscode.window.createWebviewPanel('vsprojUpdates', 'Updates', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    this.panel.onDidDispose(() => { this.panel = null; });
    this.panel.webview.onDidReceiveMessage((m) => this.onMessage(m));
    this.panel.webview.html = this.html();
    this.set({ current: this.currentVersion(), mode: this.mode() });
    if (autoCheck) this.check();
  }

  set(patch) {
    Object.assign(this.state, patch);
    if (this.panel) this.panel.webview.postMessage({ type: 'state', state: this.state });
  }

  async onMessage(m) {
    if (!m) return;
    if (m.type === 'ready') this.set({});
    else if (m.type === 'check') await this.check();
    else if (m.type === 'download') await this.download();
    else if (m.type === 'install') await this.install();
    else if (m.type === 'updateNow') await this.updateNow();
    else if (m.type === 'copy' && typeof this.state.command === 'string') {
      await vscode.env.clipboard.writeText(this.state.command);
      vscode.window.showInformationMessage('Copied.');
    } else if (m.type === 'open' && this.state.url) vscode.env.openExternal(vscode.Uri.parse(this.state.url));
    else if (m.type === 'restart') this.restart();
  }

  /** Looks for a newer release. Returns it when there is one. */
  async check() {
    if (this.busy) return null;
    this.busy = true;
    this.set({ phase: 'checking', message: '', command: '', progress: 0, canInstall: false, canUpdate: false, log: '', current: this.currentVersion(), mode: this.mode() });
    try {
      const r = await up.latestRelease();
      this.release = r;
      if (!r) { this.set({ phase: 'uptodate', message: 'No releases have been published yet.' }); return null; }
      const newer = up.isNewer(r.version, this.state.current === '0.0.0' ? '0.0.0' : this.state.current);
      const base = { latest: r.version, notes: r.notes, url: r.url };
      if (!newer) { this.set({ ...base, phase: 'uptodate', message: 'You have the newest version.' }); return null; }
      if (this.state.mode !== 'deb') {
        this.set({ ...base, phase: 'manual', canUpdate: true, message: 'Version ' + r.version + ' is available. This copy was not installed from the .deb (a clone or a download), so it updates itself in place.' });
        return r;
      }
      if (!r.asset) {
        // The release is created before its files are attached: not an error.
        this.set({ ...base, phase: 'building', message: 'Version ' + r.version + ' was just published and its package is still being built. Try again in a few minutes.' });
        return null;
      }
      this.set({ ...base, phase: 'available', message: 'Version ' + r.version + ' is available.', canInstall: false });
      return r;
    } catch (e) {
      this.set({ phase: 'error', message: 'Could not check for updates: ' + e.message });
      return null;
    } finally {
      this.busy = false;
    }
  }

  async download() {
    if (this.busy || !this.release || !this.release.asset) return;
    this.busy = true;
    try {
      const dir = up.updateDir(this.context.globalStorageUri.fsPath);
      const dest = path.join(dir, this.release.asset.name);
      this.set({ phase: 'downloading', message: 'Downloading ' + this.release.asset.name + '...', progress: 0 });
      await up.download(this.release.asset.url, dest, (p) => this.set({ progress: p }));
      up.clearOld(dir, dest);
      this.file = dest;
      this.set({ phase: 'downloaded', message: 'Downloaded. Installing asks for your password.', canInstall: true, progress: 100 });
    } catch (e) {
      this.set({ phase: 'error', message: 'The download failed: ' + e.message, canInstall: false });
    } finally {
      this.busy = false;
    }
  }

  /** Non-.deb copies: run the launcher's own update (git pull or the release download, then the extension) and show its output. */
  async updateNow() {
    if (this.busy) return;
    this.busy = true;
    const bin = process.env.IDE_BIN || 'ide';
    this.set({ phase: 'installing', message: 'Updating...', canUpdate: false, log: '', command: '' });
    await new Promise((resolve) => {
      const child = cp.spawn(bin, ['update'], { stdio: ['ignore', 'pipe', 'pipe'] });
      let log = '';
      const add = (d) => { log = (log + String(d)).slice(-4000); this.set({ log }); };
      child.stdout.on('data', add);
      child.stderr.on('data', add);
      child.on('error', (e) => { this.set({ phase: 'failed', message: 'Could not run the updater: ' + e.message, command: 'ide update' }); resolve(); });
      child.on('close', (code) => {
        if (code === 0) this.set({ phase: 'installed', message: 'Updated. Restart the editor to use the new version.', current: this.release ? this.release.version : this.state.current });
        else this.set({ phase: 'failed', message: 'The update failed (exit code ' + code + '). You can run it yourself:', command: 'ide update', canUpdate: true });
        resolve();
      });
    });
    this.busy = false;
  }

  async install() {
    if (this.busy || !this.file || !fs.existsSync(this.file)) return;
    this.busy = true;
    this.set({ phase: 'installing', message: 'Installing...', command: '', canInstall: false });
    try {
      const r = await up.installDeb(this.file, this.release.version);
      if (r.ok) this.set({ phase: 'installed', message: 'Updated to ' + this.release.version + '. Restart the editor to use it.', current: this.release.version, canInstall: false });
      else this.set({ phase: 'failed', message: r.message, command: r.command || '', canInstall: !r.command });
    } catch (e) {
      this.set({ phase: 'failed', message: 'The install failed: ' + e.message, canInstall: true });
    } finally {
      this.busy = false;
    }
  }

  /** Quit, then start the launcher again on the same folder. It also refreshes the extension to the new version. */
  restart() {
    const folder = vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri.fsPath : '';
    const launcher = fs.existsSync('/usr/bin/ide') ? '/usr/bin/ide' : 'ide';
    const script = 'sleep 3; exec "$0" "$@"';
    const child = cp.spawn('sh', ['-c', script, launcher, ...(folder ? [folder] : [])], { detached: true, stdio: 'ignore' });
    child.unref();
    vscode.commands.executeCommand('workbench.action.quit');
  }

  html() {
    const nonce = crypto.randomBytes(16).toString('hex');
    return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:24px;max-width:720px}
h1{font-size:1.5em;margin:0 0 4px} .sub{color:var(--vscode-descriptionForeground);margin-bottom:20px}
.row{display:flex;gap:24px;margin:12px 0} .row div span{display:block;color:var(--vscode-descriptionForeground);font-size:.85em}
button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:6px 14px;margin-right:8px;cursor:pointer}
button:hover{background:var(--vscode-button-hoverBackground)} button[disabled]{opacity:.5;cursor:default}
button.secondary{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
progress{width:100%;height:8px;margin:12px 0} pre{background:var(--vscode-textCodeBlock-background);padding:10px;overflow:auto;user-select:all}
.notes{white-space:pre-wrap;border-top:1px solid var(--vscode-panel-border);margin-top:16px;padding-top:12px;max-height:280px;overflow:auto}
.hidden{display:none}
</style></head><body>
<h1>Updates</h1><div class="sub">Releases come from GitHub.</div>
<div class="row"><div><span>Installed</span><b id="cur">-</b></div><div><span>Latest</span><b id="lat">-</b></div></div>
<p id="msg"></p>
<progress id="bar" class="hidden" max="100" value="0"></progress>
<pre id="cmd" class="hidden"></pre>
<pre id="log" class="hidden"></pre>
<div>
<button id="check">Check again</button>
<button id="download" class="hidden">Download</button>
<button id="install" class="hidden">Install</button>
<button id="updateNow" class="hidden">Update now</button>
<button id="copy" class="secondary hidden">Copy command</button>
<button id="restart" class="hidden">Restart now</button>
<button id="open" class="secondary hidden">Release page</button>
</div>
<div id="notes" class="notes hidden"></div>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
const $ = (id) => document.getElementById(id);
const show = (id, on) => $(id).classList.toggle('hidden', !on);
for (const id of ['check','download','install','updateNow','copy','restart','open']) $(id).addEventListener('click', () => vscode.postMessage({ type: id }));
window.addEventListener('message', (e) => {
  if (e.data.type !== 'state') return;
  const s = e.data.state;
  $('cur').textContent = s.current || '-';
  $('lat').textContent = s.latest || '-';
  $('msg').textContent = s.message || (s.phase === 'checking' ? 'Checking...' : '');
  const busy = ['checking','downloading','installing'].includes(s.phase);
  $('check').disabled = busy;
  show('download', s.phase === 'available' || s.phase === 'downloading');
  $('download').disabled = s.phase === 'downloading';
  show('install', s.canInstall);
  show('updateNow', !!s.canUpdate);
  show('log', !!s.log); $('log').textContent = s.log || '';
  show('bar', s.phase === 'downloading');
  $('bar').value = s.progress || 0;
  show('cmd', !!s.command); $('cmd').textContent = s.command || '';
  show('copy', !!s.command);
  show('restart', s.phase === 'installed');
  show('open', !!s.url);
  show('notes', !!s.notes); $('notes').textContent = s.notes || '';
});
vscode.postMessage({ type: 'ready' });
</script></body></html>`;
  }
}

module.exports = { UpdateWindow };
