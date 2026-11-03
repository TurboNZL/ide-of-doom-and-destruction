'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const ws = require('../extension/lib/workspace');

const have = (c) => cp.spawnSync('sh', ['-c', 'command -v ' + c]).status === 0;

test('the .deb has the launcher, extension, desktop entry and the package version', { skip: !have('dpkg-deb') }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deb-'));
  const out = path.join(dir, 'x.deb');
  const b = cp.spawnSync('bash', [path.join(__dirname, '..', 'scripts', 'build-deb.sh'), 'v2026.11.4', out], { encoding: 'utf8' });
  assert.strictEqual(b.status, 0, b.stderr);
  const info = cp.spawnSync('dpkg-deb', ['-f', out], { encoding: 'utf8' }).stdout;
  assert.match(info, /^Package: ide-of-doom-and-destruction$/m);
  assert.match(info, /^Version: 2026\.11\.4$/m);
  assert.match(info, /^Architecture: all$/m);
  const list = cp.spawnSync('dpkg-deb', ['-c', out], { encoding: 'utf8' }).stdout;
  assert.match(list, /-rwxr-xr-x root\/root .* \.\/opt\/ide-of-doom-and-destruction\/bin\/ide$/m);
  assert.match(list, /\.\/usr\/bin\/ide -> \/opt\/ide-of-doom-and-destruction\/bin\/ide/);
  assert.match(list, /\.\/usr\/share\/applications\/ide-of-doom-and-destruction\.desktop/);
  assert.match(list, /extension\/shims\/pause/);
  assert.ok(!/build-deb/.test(list));
  const dest = path.join(dir, 'root');
  cp.spawnSync('dpkg-deb', ['-x', out, dest]);
  const pkg = JSON.parse(fs.readFileSync(path.join(dest, 'opt/ide-of-doom-and-destruction/extension/package.json'), 'utf8'));
  assert.strictEqual(pkg.version, '2026.11.4');
});

test('a new project starts a git repository on main', { skip: !have('git') }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'git-'));
  ws.createProject({ location: root, name: 'G' });
  assert.ok(ws.gitInit(path.join(root, 'G')));
  const head = fs.readFileSync(path.join(root, 'G', '.git', 'HEAD'), 'utf8').trim();
  assert.strictEqual(head, 'ref: refs/heads/main');
  assert.strictEqual(ws.gitInit(path.join(root, 'G')), false, 'does not touch an existing repository');
});

test('the launcher is present in the package scripts and desktop entry points at an existing script', () => {
  const desktop = fs.readFileSync(path.join(__dirname, '..', 'packaging', 'ide-of-doom-and-destruction.desktop'), 'utf8');
  const exec = /^Exec=\/opt\/ide-of-doom-and-destruction\/(\S+)/m.exec(desktop)[1];
  assert.ok(fs.existsSync(path.join(__dirname, '..', exec)), exec);
});

test('the desktop entry can be chosen for folders and C++ files, and its window class matches the launcher', () => {
  const root = path.join(__dirname, '..');
  const desktop = fs.readFileSync(path.join(root, 'packaging', 'ide-of-doom-and-destruction.desktop'), 'utf8');
  assert.match(desktop, /^MimeType=.*inode\/directory;.*text\/x-c\+\+src;/m);
  assert.match(desktop, /^Name=IDE of Doom and Destruction$/m);
  const cls = /^StartupWMClass=(\S+)$/m.exec(desktop)[1];
  assert.ok(fs.readFileSync(path.join(root, 'bin', 'ide'), 'utf8').includes('--class=' + cls));
});

test('a start-menu launch never opens a folder by itself', () => {
  const ide = fs.readFileSync(path.join(__dirname, '..', 'bin', 'ide'), 'utf8');
  assert.match(ide, /\[ \$# -eq 0 \] && \[ -t 0 \]/);
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.json'), 'utf8'));
  assert.strictEqual(settings['window.restoreWindows'], 'none');
});

test('the default settings have no vertical ruler', () => {
  const settings = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', 'settings.json'), 'utf8'));
  assert.ok(!('editor.rulers' in settings));
});

test('the launcher removes the old ruler, adds new defaults and can add the menu entry', { skip: !have('bash') }, () => {
  const root = path.join(__dirname, '..');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ih-'));
  const xdg = fs.mkdtempSync(path.join(os.tmpdir(), 'xdg-'));
  fs.mkdirSync(path.join(home, 'data', 'user-data', 'User'), { recursive: true });
  const settings = path.join(home, 'data', 'user-data', 'User', 'settings.json');
  fs.writeFileSync(settings, '{\n  "editor.rulers": [120],\n  "editor.tabSize": 4\n}\n');
  const env = { ...process.env, IDE_HOME: home, XDG_DATA_HOME: xdg };
  const src = fs.readFileSync(path.join(root, 'bin', 'ide'), 'utf8');
  const fn = (name) => new RegExp('^' + name + '\\(\\) \\{[\\s\\S]*?^\\}', 'm').exec(src)[0];
  const script = [fn('add_setting'), fn('migrate_settings'), fn('cmd_integrate'), 'say() { :; }', 'HOME_DIR="$IDE_HOME"', 'ROOT="' + root + '"', 'migrate_settings', 'cmd_integrate'].join('\n');
  const r = cp.spawnSync('bash', ['-c', script], { env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const after = fs.readFileSync(settings, 'utf8');
  assert.ok(!after.includes('rulers'));
  assert.match(after, /"window.restoreWindows": "none"/);
  const desktop = fs.readFileSync(path.join(xdg, 'applications', 'ide-of-doom-and-destruction.desktop'), 'utf8');
  assert.ok(desktop.includes('Exec=' + root + '/bin/ide-desktop'));
  assert.ok(fs.existsSync(path.join(xdg, 'icons', 'hicolor', '512x512', 'apps', 'ide-of-doom-and-destruction.png')));
});

test('branding the editor copy changes only the private copy and is repeatable', () => {
  const root = path.join(__dirname, '..');
  const ed = fs.mkdtempSync(path.join(os.tmpdir(), 'ed-'));
  const app = path.join(ed, 'resources', 'app');
  fs.mkdirSync(path.join(app, 'resources', 'linux'), { recursive: true });
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"code","desktopName":"code-url-handler.desktop"}');
  fs.writeFileSync(path.join(app, 'product.json'), '{"nameShort":"Code","nameLong":"Visual Studio Code","applicationName":"code"}');
  fs.writeFileSync(path.join(app, 'resources', 'linux', 'code.png'), 'old');
  for (let i = 0; i < 2; i++) {
    const r = cp.spawnSync('node', [path.join(root, 'scripts', 'brand-editor.js'), ed, path.join(root, 'packaging', 'ide-of-doom-and-destruction.png')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  }
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(app, 'package.json'), 'utf8')).desktopName, 'ide-of-doom-and-destruction.desktop');
  const product = JSON.parse(fs.readFileSync(path.join(app, 'product.json'), 'utf8'));
  assert.strictEqual(product.nameLong, 'IDE of Doom and Destruction');
  assert.strictEqual(product.applicationName, 'code', 'the command name stays as it was');
  assert.strictEqual(fs.readFileSync(path.join(app, 'resources', 'linux', 'code.png.orig'), 'utf8'), 'old');
  assert.strictEqual(fs.readFileSync(path.join(app, 'package.json.orig'), 'utf8').includes('code-url-handler'), true);
});
