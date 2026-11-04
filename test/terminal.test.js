'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const term = require('../extension/lib/terminal');
const wine = require('../extension/lib/wine');

const have = (...bins) => (b) => bins.includes(b);

test('KDE: the terminal set in System Settings wins, then konsole', () => {
  const r = term.launchFor('echo hi', { env: { XDG_CURRENT_DESKTOP: 'KDE' }, which: have('konsole', 'xterm', 'kitty'), kde: () => '/usr/bin/kitty' });
  assert.strictEqual(r.bin, 'kitty');
  const k = term.launchFor('echo hi', { env: { XDG_CURRENT_DESKTOP: 'KDE' }, which: have('konsole', 'xterm'), kde: () => '' });
  assert.deepStrictEqual(k, { bin: 'konsole', args: ['-e', 'sh', '-c', 'echo hi'] });
});

test('the setting beats $TERMINAL, which beats the desktop default', () => {
  const env = { TERMINAL: 'kitty', XDG_CURRENT_DESKTOP: 'KDE' };
  assert.strictEqual(term.launchFor('x', { custom: 'foot', env, which: have('foot', 'kitty', 'konsole'), kde: () => '' }).bin, 'foot');
  assert.strictEqual(term.launchFor('x', { env, which: have('kitty', 'konsole'), kde: () => '' }).bin, 'kitty');
});

test('a full command in the setting is used as written, a bare name gets its arguments', () => {
  assert.deepStrictEqual(term.launchFor('s', { custom: 'alacritty --hold -e', env: {}, which: have('alacritty') }).args, ['--hold', '-e', 'sh', '-c', 's']);
  assert.deepStrictEqual(term.launchFor('s', { custom: 'wezterm', env: {}, which: have('wezterm') }).args, ['start', '--', 'sh', '-c', 's']);
  assert.deepStrictEqual(term.launchFor('s', { custom: 'unknownterm', env: {}, which: have('unknownterm') }).args, ['-e', 'sh', '-c', 's']);
});

test('a terminal that is not installed is skipped; none installed gives null', () => {
  assert.strictEqual(term.launchFor('x', { custom: 'missing', env: {}, which: have('xterm') }).bin, 'xterm');
  assert.strictEqual(term.launchFor('x', { env: {}, which: () => false }), null);
});

test('GNOME prefers its own console over xterm', () => {
  assert.strictEqual(term.launchFor('x', { env: { XDG_CURRENT_DESKTOP: 'GNOME' }, which: have('gnome-terminal', 'xterm') }).bin, 'gnome-terminal');
});

test('the program script runs it, reports the exit code and waits, and survives odd paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "it's a dir-"));
  const prog = path.join(dir, 'p.sh');
  fs.writeFileSync(prog, '#!/bin/sh\necho "hello $PWD"\nexit 3\n', { mode: 0o755 });
  const script = term.programScript({ name: 'Demo', cwd: dir, command: "'" + prog.replace(/'/g, "'\\''") + "'", pathPrefix: '/nonexistent' });
  const r = cp.spawnSync('sh', ['-c', script], { input: '\n', encoding: 'utf8' });
  assert.match(r.stdout, /hello .*it's a dir/);
  assert.match(r.stdout, /\[Demo exited with code 3\]/);
  assert.match(r.stdout, /Press Enter/);
});

test('Wine uses a prefix inside the tool data folder, never ~/.wine', () => {
  assert.strictEqual(wine.prefixDir({ IDE_DATA_DIR: '/data/ide' }), '/data/ide/wine-prefix');
  assert.strictEqual(wine.prefixDir({ XDG_DATA_HOME: '/x' }), '/x/ide-of-doom-and-destruction/wine-prefix');
  const setup = wine.wineSetup({ IDE_DATA_DIR: '/data/ide' });
  assert.match(setup, /WINEPREFIX='\/data\/ide\/wine-prefix'/);
  assert.match(setup, /mscoree,mshtml=/);
  assert.strictEqual(wine.wineCommand('wine', "/a b/it's.exe"), "'wine' '/a b/it'\\''s.exe'");
  assert.strictEqual(wine.findWine(have('wine64')), 'wine64');
  assert.strictEqual(wine.findWine(() => false), null);
});

test('the package settings and commands for running are declared', () => {
  const pkg = require('../extension/package.json');
  const props = pkg.contributes.configuration.properties;
  assert.strictEqual(props['vsproj.runIn'].default, 'externalTerminal');
  assert.ok('vsproj.terminal' in props);
  const ids = pkg.contributes.commands.map((c) => c.command);
  assert.ok(ids.includes('vsproj.runWindowsBuild') && ids.includes('vsproj.runExeInPrefix'));
});

test('text typed into a terminal reads the same in sh, bash and fish', () => {
  const { escapeArg } = require('../extension/lib/text');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "it's a (dir) & $x-"));
  const file = path.join(dir, 'run.sh');
  fs.writeFileSync(file, 'echo built\n( echo sub ) || { echo failed ; exit 1 ; }\n');
  for (const shell of ['sh', 'bash', 'fish']) {
    if (cp.spawnSync('sh', ['-c', 'command -v ' + shell]).status !== 0) continue;
    const r = cp.spawnSync(shell, ['-c', 'sh ' + escapeArg(file)], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, shell + ': ' + r.stderr);
    assert.match(r.stdout, /built\nsub/, shell);
  }
});

test('the build task is pinned to /bin/sh so fish and other shells cannot break it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'extension', 'extension.js'), 'utf8');
  assert.match(src, /executable: '\/bin\/sh', shellArgs: \['-c'\]/);
  assert.match(src, /executable: 'cmd\.exe', shellArgs: \['\/d', '\/c'\]/); // Windows: cmd, never the user's PowerShell
  assert.ok(!/sendText\(plain/.test(src), 'no raw POSIX text is typed into the user\'s shell');
});
