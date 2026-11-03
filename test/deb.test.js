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
