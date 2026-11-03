'use strict';
// VS Code side: commands, Solution Explorer, tasks and status bar. The work itself is in lib/.

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const https = require('https');
const { shellQuote } = require('./lib/text');
const ws = require('./lib/workspace');
const { planBuild, CROSS_COMPILERS } = require('./lib/build');
const { packageSubmission } = require('./lib/submission');

const REPO = 'TurboNZL/ide-of-doom-and-destruction';

let context;
let solution = null; // loaded solution, or null
let startupName = null;
let statusItem;
let tree;
let runTerminal;
const output = { channel: null };

// ---------------------------------------------------------------------------------------
// State

function cfg() {
  return vscode.workspace.getConfiguration('vsproj');
}

function rootDir() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length ? f[0].uri.fsPath : null;
}

function configuration() {
  return context.workspaceState.get('configuration') || cfg().get('configuration') || 'Debug';
}

function platform() {
  return context.workspaceState.get('platform') || cfg().get('platform') || 'x64';
}

function reload() {
  const root = rootDir();
  solution = root ? ws.loadSolution(root, configuration(), platform()) : null;
  vscode.commands.executeCommand('setContext', 'vsproj.hasSolution', !!solution);
  if (solution) {
    try { ws.writeCompileCommands(solution, buildOpts('native')); } catch (e) { log('IntelliSense data not written: ' + e.message); }
  }
  updateStatus();
  if (tree) tree.refresh();
}

function startupProject() {
  if (!solution || !solution.projects.length) return null;
  const saved = startupName || context.workspaceState.get('startup');
  return solution.projects.find((p) => p.name === saved) || solution.projects[0];
}

function buildOpts(target) {
  const extra = cfg().get('extraFlags') || [];
  const winCompiler = cfg().get('windowsCompiler') || CROSS_COMPILERS[platform()];
  return {
    solutionDir: solution ? solution.dir : rootDir(),
    cwd: rootDir() || undefined,
    config: configuration(),
    platform: platform(),
    target,
    compiler: target === 'windows' ? winCompiler : cfg().get('compiler') || 'g++',
    extraFlags: extra
  };
}

function log(message) {
  if (!output.channel) output.channel = vscode.window.createOutputChannel('Visual Studio C++ Solutions');
  output.channel.appendLine(message);
}

function updateStatus() {
  if (!statusItem) return;
  if (!solution) { statusItem.hide(); return; }
  const p = startupProject();
  statusItem.text = '$(gear) ' + configuration() + ' | ' + platform() + (p ? ' | ' + p.name : '');
  statusItem.show();
}

function needSolution() {
  if (solution) return true;
  vscode.window.showWarningMessage('Open a folder that contains a .slnx or .sln solution, or create one with "New Console App".');
  return false;
}

function fail(error) {
  log(String(error && error.stack ? error.stack : error));
  vscode.window.showErrorMessage(String(error && error.message ? error.message : error));
}

// ---------------------------------------------------------------------------------------
// Build and run

function runTask(label, commandLine, cwd) {
  const task = new vscode.Task(
    { type: 'vsproj', label },
    vscode.TaskScope.Workspace,
    label,
    'vsproj',
    new vscode.ShellExecution(commandLine, { cwd }),
    ['$vsproj-gcc']
  );
  task.group = vscode.TaskGroup.Build;
  task.presentationOptions = { reveal: vscode.TaskRevealKind.Always, clear: true, focus: false, panel: vscode.TaskPanelKind.Shared };
  return new Promise((resolve, reject) => {
    const sub = vscode.tasks.onDidEndTaskProcess((e) => {
      if (e.execution.task === task || (e.execution.task.name === label && e.execution.task.source === 'vsproj')) {
        sub.dispose();
        resolve(e.exitCode === 0);
      }
    });
    vscode.tasks.executeTask(task).then(undefined, (err) => { sub.dispose(); reject(err); });
  });
}

function warnUntracked(project) {
  const files = ws.untrackedFiles(project);
  if (!files.length) return '';
  return 'echo ' + shellQuote('Note: not part of the project and not built: ' + files.join(', ') + ' (right-click > Add to Project)') + ' ; ';
}

async function buildProject(project, opts) {
  const plan = planBuild(project, opts);
  const cmd = warnUntracked(project) +
    'echo ' + shellQuote('------ Build started: ' + project.name + ' (' + opts.config + ' ' + opts.platform + ') ------') + ' ; ' +
    '( ' + plan.commandLine + ' ) && echo ' + shellQuote('========== Build: 1 succeeded ==========') +
    ' || { echo ' + shellQuote('========== Build: 1 failed ==========') + ' ; exit 1 ; }';
  const ok = await runTask('Build ' + project.name, cmd, plan.cwd);
  return ok ? plan : null;
}

async function cmdBuild() {
  if (!needSolution()) return null;
  await vscode.workspace.saveAll(false);
  reload();
  let last = null;
  for (const p of solution.projects) {
    if (p.configurationType !== 'Application') { log('Skipped ' + p.name + ': only Application projects can be built.'); continue; }
    last = await buildProject(p, buildOpts('native'));
    if (!last) return null;
  }
  return last;
}

async function cmdRun() {
  if (!needSolution()) return;
  await vscode.workspace.saveAll(false);
  reload();
  const project = startupProject();
  if (project.configurationType !== 'Application') { vscode.window.showWarningMessage(project.name + ' is not an application project.'); return; }
  const plan = await buildProject(project, buildOpts('native'));
  if (!plan) return;
  if (runTerminal) runTerminal.dispose();
  const shims = path.join(context.extensionPath, 'shims');
  try { for (const f of fs.readdirSync(shims)) fs.chmodSync(path.join(shims, f), 0o755); } catch (e) { log('Could not make the shims executable: ' + e.message); }
  runTerminal = vscode.window.createTerminal({ name: project.name, cwd: project.dir, env: { PATH: shims + path.delimiter + (process.env.PATH || '') } });
  runTerminal.show(false);
  runTerminal.sendText('clear; ' + shellQuote(plan.outFile) + '; code=$?; echo; echo "[' + project.name + ' exited with code $code]"');
}

async function cmdClean() {
  if (!needSolution()) return;
  for (const p of solution.projects) {
    const dir = planBuild(p, buildOpts('native')).outDir;
    fs.rmSync(dir, { recursive: true, force: true });
  }
  vscode.window.showInformationMessage('Clean succeeded.');
}

async function cmdRebuild() {
  await cmdClean();
  await cmdBuild();
}

// ---------------------------------------------------------------------------------------
// Solution Explorer

class SolutionTree {
  constructor() {
    this._emitter = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._emitter.event;
  }

  refresh() {
    this._emitter.fire();
  }

  getTreeItem(node) {
    return node.item;
  }

  getChildren(node) {
    if (!solution) return [];
    if (!node) {
      const item = new vscode.TreeItem(
        "Solution '" + path.basename(solution.file, path.extname(solution.file)) + "' (" + solution.projects.length + ' project' + (solution.projects.length === 1 ? '' : 's') + ')',
        vscode.TreeItemCollapsibleState.Expanded
      );
      item.contextValue = 'solution';
      item.iconPath = new vscode.ThemeIcon('root-folder');
      return [{ kind: 'solution', item }];
    }
    if (node.kind === 'solution') return solution.projects.map((p) => this.projectNode(p));
    if (node.kind === 'project') return this.projectChildren(node.project);
    if (node.kind === 'filter') return node.files.map((f) => this.fileNode(node.project, f));
    return [];
  }

  projectNode(project) {
    const isStartup = startupProject() === project;
    const item = new vscode.TreeItem(project.name, vscode.TreeItemCollapsibleState.Expanded);
    item.contextValue = 'project';
    item.description = isStartup ? 'startup' : '';
    item.iconPath = new vscode.ThemeIcon(isStartup ? 'play-circle' : 'package');
    return { kind: 'project', project, item };
  }

  projectChildren(project) {
    const all = [...project.sources.map((s) => s.file), ...project.headers];
    const groups = new Map();
    for (const name of project.filters.names) groups.set(name, []);
    const loose = [];
    for (const f of all) {
      const g = project.filters.files[f];
      if (g) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(f);
      } else loose.push(f);
    }
    const nodes = [];
    for (const [name, files] of groups) {
      if (!files.length && !['Source Files', 'Header Files'].includes(name)) continue;
      const item = new vscode.TreeItem(name, vscode.TreeItemCollapsibleState.Expanded);
      item.contextValue = 'filter';
      item.iconPath = new vscode.ThemeIcon('folder');
      nodes.push({ kind: 'filter', project, files: files.sort((a, b) => a.localeCompare(b)), item });
    }
    for (const f of loose) nodes.push(this.fileNode(project, f));
    return nodes;
  }

  fileNode(project, rel) {
    const abs = path.resolve(project.dir, rel);
    const item = new vscode.TreeItem(path.basename(rel), vscode.TreeItemCollapsibleState.None);
    item.resourceUri = vscode.Uri.file(abs);
    item.contextValue = 'file';
    item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(abs)] };
    return { kind: 'file', project, rel, item };
  }
}

function projectOf(node) {
  if (node && node.project) return node.project;
  return startupProject();
}

// ---------------------------------------------------------------------------------------
// Items

async function cmdNewProject() {
  const defaultUri = vscode.Uri.file(require('os').homedir());
  const name = await vscode.window.showInputBox({
    title: 'New Console App',
    prompt: 'Project name',
    value: 'ConsoleApp1',
    validateInput: (v) => (ws.isValidProjectName(v) ? null : 'Use letters, digits, _ and - (start with a letter)')
  });
  if (!name) return;
  const picked = await vscode.window.showOpenDialog({
    canSelectFolders: true, canSelectFiles: false, canSelectMany: false, defaultUri, openLabel: 'Create here', title: 'Location for ' + name
  });
  if (!picked || !picked.length) return;
  try {
    const file = ws.createProject({ location: picked[0].fsPath, name, solutionFormat: cfg().get('solutionFormat') });
    await vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(path.dirname(file)), { forceNewWindow: false });
  } catch (e) { fail(e); }
}

async function cmdAddClass(node) {
  if (!needSolution()) return;
  const project = projectOf(node);
  const name = await vscode.window.showInputBox({
    title: 'Add Class', prompt: 'Class name', validateInput: (v) => (ws.isValidIdentifier(v) ? null : 'Not a valid C++ class name')
  });
  if (!name) return;
  try {
    const r = ws.addClass(project, name);
    reload();
    await vscode.window.showTextDocument(vscode.Uri.file(r.header));
  } catch (e) { fail(e); }
}

async function cmdAddNewItem(node) {
  if (!needSolution()) return;
  const project = projectOf(node);
  const kind = await vscode.window.showQuickPick(
    [{ label: 'C++ File (.cpp)', kind: 'source' }, { label: 'Header File (.h)', kind: 'header' }], { title: 'Add New Item' });
  if (!kind) return;
  const name = await vscode.window.showInputBox({ title: 'Add New Item', prompt: 'File name', value: kind.kind === 'source' ? 'Source' : 'Header' });
  if (!name) return;
  try {
    const abs = ws.addItem(project, kind.kind, name);
    reload();
    await vscode.window.showTextDocument(vscode.Uri.file(abs));
  } catch (e) { fail(e); }
}

async function cmdAddToProject(uri) {
  if (!needSolution() || !uri) return;
  const abs = uri.fsPath;
  const project = solution.projects.find((p) => !path.relative(p.dir, abs).startsWith('..')) || startupProject();
  try {
    const rel = ws.addFile(project, abs);
    reload();
    vscode.window.showInformationMessage('Added ' + rel + ' to ' + project.name + '.');
  } catch (e) { fail(e); }
}

async function cmdRemoveItem(node) {
  if (!node || node.kind !== 'file') return;
  const pick = await vscode.window.showWarningMessage('Remove ' + node.rel + ' from the project?', { modal: true }, 'Remove', 'Delete');
  if (!pick) return;
  try {
    ws.removeFile(node.project, node.rel, pick === 'Delete');
    reload();
  } catch (e) { fail(e); }
}

async function cmdSetStartup(node) {
  if (!node || !node.project) return;
  startupName = node.project.name;
  await context.workspaceState.update('startup', startupName);
  updateStatus();
  tree.refresh();
}

async function cmdSetConfiguration() {
  const options = [];
  for (const c of ['Debug', 'Release']) for (const p of ['x64', 'x86']) options.push({ label: c + ' | ' + p, c, p });
  const pick = await vscode.window.showQuickPick(options, { title: 'Select Configuration and Platform' });
  if (!pick) return;
  await context.workspaceState.update('configuration', pick.c);
  await context.workspaceState.update('platform', pick.p);
  reload();
}

async function cmdOpenProjectFile(node) {
  const project = projectOf(node);
  if (project) await vscode.window.showTextDocument(vscode.Uri.file(project.file));
}

// ---------------------------------------------------------------------------------------
// Package for submission

async function cmdPackage() {
  if (!needSolution()) return;
  let name = cfg().get('submission.name');
  if (!name) {
    name = await vscode.window.showInputBox({ title: 'Package for Submission', prompt: 'Name to use in the folder names', placeHolder: 'Your Name' });
    if (!name) return;
    await cfg().update('submission.name', name, vscode.ConfigurationTarget.Global);
  }
  await vscode.workspace.saveAll(false);
  reload();
  const project = startupProject();
  const opts = buildOpts('windows');
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: 'Packaging ' + project.name + '...' }, async () => {
    try {
      const r = packageSubmission({
        solution, project, outRoot: path.join(solution.dir, 'Submission'), name,
        sourceTemplate: cfg().get('submission.sourceFolder'), releaseTemplate: cfg().get('submission.releaseFolder'),
        solutionName: cfg().get('submission.solutionName'), platform: opts.platform, compiler: opts.compiler
      });
      log('Packaged:\n  ' + r.sourceDir + '\n  ' + r.releaseDir);
      const open = await vscode.window.showInformationMessage('Packaged to ' + path.join(solution.dir, 'Submission') + '. Edit Readme.txt in the release folder before handing it in.', 'Open Readme.txt', 'Show Folder');
      if (open === 'Open Readme.txt') await vscode.window.showTextDocument(vscode.Uri.file(path.join(r.releaseDir, 'Readme.txt')));
      if (open === 'Show Folder') await vscode.env.openExternal(vscode.Uri.file(path.dirname(r.releaseDir)));
    } catch (e) { fail(e); }
  });
}

// ---------------------------------------------------------------------------------------
// Updates

function latestRelease() {
  return new Promise((resolve, reject) => {
    const req = https.get({
      host: 'api.github.com', path: '/repos/' + REPO + '/releases/latest',
      headers: { 'User-Agent': 'vsproj-tools', Accept: 'application/vnd.github+json' }, timeout: 8000
    }, (res) => {
      let body = '';
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('GitHub answered ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timed out')));
    req.on('error', reject);
  });
}

function newer(a, b) {
  const x = a.replace(/^v/, '').split('.').map(Number);
  const y = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

async function cmdCheckForUpdates(silent) {
  try {
    const rel = await latestRelease();
    const current = context.extension.packageJSON.version;
    if (current === '0.0.0') {
      if (!silent) vscode.window.showInformationMessage('Installed from source. Run "ide update" to pull the latest (newest release: ' + rel.tag_name + ').');
      return;
    }
    if (newer(rel.tag_name, current)) {
      const pick = await vscode.window.showInformationMessage(
        'A newer version is available (' + rel.tag_name + ', you have ' + current + '). Run "ide update" in a terminal, then restart.', 'Release Page');
      if (pick) vscode.env.openExternal(vscode.Uri.parse(rel.html_url));
    } else if (!silent) vscode.window.showInformationMessage('You are up to date (' + current + ').');
  } catch (e) {
    if (!silent) vscode.window.showWarningMessage('Could not check for updates: ' + e.message);
  }
}

// ---------------------------------------------------------------------------------------

async function setClangdDefaults() {
  try {
    const c = vscode.workspace.getConfiguration('clangd');
    const inspected = c.inspect('arguments');
    if (inspected && inspected.globalValue === undefined) {
      await c.update('arguments', ['--compile-commands-dir=${workspaceFolder}/.vs', '--fallback-style=Microsoft', '--header-insertion=never', '--background-index'], vscode.ConfigurationTarget.Global);
    }
  } catch (e) { log('clangd settings not changed: ' + e.message); }
}

function activate(ctx) {
  context = ctx;
  tree = new SolutionTree();
  statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 10);
  statusItem.command = 'vsproj.setConfiguration';
  statusItem.tooltip = 'Select configuration and platform';

  const reg = (id, fn) => ctx.subscriptions.push(vscode.commands.registerCommand(id, fn));
  reg('vsproj.newProject', cmdNewProject);
  reg('vsproj.build', cmdBuild);
  reg('vsproj.rebuild', cmdRebuild);
  reg('vsproj.clean', cmdClean);
  reg('vsproj.run', cmdRun);
  reg('vsproj.addClass', cmdAddClass);
  reg('vsproj.addNewItem', cmdAddNewItem);
  reg('vsproj.addToProject', cmdAddToProject);
  reg('vsproj.removeItem', cmdRemoveItem);
  reg('vsproj.setStartupProject', cmdSetStartup);
  reg('vsproj.setConfiguration', cmdSetConfiguration);
  reg('vsproj.openProjectFile', cmdOpenProjectFile);
  reg('vsproj.refresh', reload);
  reg('vsproj.package', cmdPackage);
  reg('vsproj.checkForUpdates', () => cmdCheckForUpdates(false));

  ctx.subscriptions.push(statusItem, vscode.window.registerTreeDataProvider('vsprojSolution', tree));

  const watcher = vscode.workspace.createFileSystemWatcher('**/*.{vcxproj,filters,slnx,sln}');
  watcher.onDidChange(reload);
  watcher.onDidCreate(reload);
  watcher.onDidDelete(reload);
  ctx.subscriptions.push(watcher, vscode.workspace.onDidChangeWorkspaceFolders(reload));

  reload();
  setClangdDefaults();

  const day = 24 * 60 * 60 * 1000;
  const last = ctx.globalState.get('lastUpdateCheck') || 0;
  if (cfg().get('checkForUpdates') && Date.now() - last > day) {
    ctx.globalState.update('lastUpdateCheck', Date.now());
    cmdCheckForUpdates(true);
  }
}

function deactivate() {}

module.exports = { activate, deactivate };
