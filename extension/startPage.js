'use strict';
// The start page: shown in an empty window so the custom features are the first thing you see.

const vscode = require('vscode');

// Commands the page may run (the page can only ask for these by name).
const ACTIONS = {
  newProject: 'vsproj.newProject',
  openFolder: 'workbench.action.files.openFolder',
  openRecent: 'workbench.action.openRecent',
  signIn: 'vsproj.signInGitHub',
  updates: 'vsproj.checkForUpdates',
  menu: 'vsproj.menu'
};

let panel = null;

function show() {
  if (panel) { panel.reveal(); return; }
  panel = vscode.window.createWebviewPanel('vsprojStart', 'IDE of Doom and Destruction', vscode.ViewColumn.Active, { enableScripts: true });
  panel.onDidDispose(() => { panel = null; });
  panel.webview.onDidReceiveMessage((m) => {
    if (m && Object.prototype.hasOwnProperty.call(ACTIONS, m.action)) vscode.commands.executeCommand(ACTIONS[m.action]);
  });
  panel.webview.html = html(require('crypto').randomBytes(16).toString('hex'));
}

function html(nonce) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<style nonce="${nonce}">
body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);padding:32px 40px;max-width:760px}
h1{font-size:1.8em;margin:0} .sub{color:var(--vscode-descriptionForeground);margin:4px 0 28px}
h2{font-size:1.05em;margin:26px 0 8px;color:var(--vscode-descriptionForeground);text-transform:uppercase;letter-spacing:.04em}
.big{display:block;width:100%;text-align:left;background:var(--vscode-button-background);color:var(--vscode-button-foreground);border:0;padding:12px 16px;margin:6px 0;cursor:pointer;font-size:1.05em}
.big:hover{background:var(--vscode-button-hoverBackground)}
.big small{display:block;opacity:.8;font-size:.82em;margin-top:2px}
.alt{background:var(--vscode-button-secondaryBackground);color:var(--vscode-button-secondaryForeground)}
.alt:hover{background:var(--vscode-button-secondaryHoverBackground)}
table{border-collapse:collapse} td{padding:3px 18px 3px 0} kbd{background:var(--vscode-textCodeBlock-background);padding:1px 6px;border-radius:3px}
</style></head><body>
<h1>IDE of Doom and Destruction</h1>
<div class="sub">The buttons and commands on this page are the custom ones. Everything else is regular VS Code.</div>

<h2>Start</h2>
<button class="big" data-a="newProject">New Console App<small>Creates a Visual Studio solution and project (.slnx, .vcxproj)</small></button>
<button class="big alt" data-a="openFolder">Open a project folder<small>The folder that holds your .slnx / .sln</small></button>
<button class="big alt" data-a="openRecent">Open recent</button>

<h2>Account</h2>
<button class="big alt" data-a="signIn">Sign in to GitHub<small>For Source Control and Publish to GitHub</small></button>

<h2>While you work</h2>
<table>
<tr><td><kbd>F5</kbd></td><td>Build and run (also the <b>Run</b> button in the top bar and bottom bar)</td></tr>
<tr><td><kbd>F7</kbd></td><td>Build</td></tr>
<tr><td><kbd>Shift+Alt+C</kbd></td><td>Add Class</td></tr>
<tr><td><kbd>Ctrl+Shift+A</kbd></td><td>Add New Item</td></tr>
<tr><td><kbd>Ctrl+Shift+M</kbd></td><td>Errors and warnings (Problems)</td></tr>
</table>
<p>The <b>IDE of Doom</b> button in the bottom-left corner lists every custom action, including Package for Submission.</p>

<h2>Tool</h2>
<button class="big alt" data-a="updates">Updates<small>Check for and install a newer version</small></button>
<script nonce="${nonce}">
const vscode = acquireVsCodeApi();
for (const b of document.querySelectorAll('[data-a]')) b.addEventListener('click', () => vscode.postMessage({ action: b.dataset.a }));
</script></body></html>`;
}

module.exports = { show };
