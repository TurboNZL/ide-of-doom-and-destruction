'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { planBuild, compileCommands } = require('../extension/lib/build');
const { cmdQuote } = require('../extension/lib/text');
const win = require('../extension/lib/windows');
const ws = require('../extension/lib/workspace');

function sample() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'win-'));
  ws.createProject({ location: dir, name: 'Sample' });
  const solDir = path.join(dir, 'Sample');
  return { solDir, project: ws.loadSolution(solDir).projects[0] };
}

test('a Windows build line is cmd.exe syntax with the native compiler and a static .exe', () => {
  const { solDir, project } = sample();
  const plan = planBuild(project, { solutionDir: solDir, shell: 'cmd', platform: 'x64', config: 'Release' });
  assert.strictEqual(plan.compiler, 'g++');
  assert.ok(plan.outFile.endsWith('.exe'));
  assert.ok(plan.args.includes('-static'));
  assert.match(plan.commandLine, /^if not exist "x64\\Release" mkdir "x64\\Release" && "g\+\+" /);
  assert.ok(!/mkdir -p|'/.test(plan.commandLine), plan.commandLine);
});

test('the POSIX build line is unchanged', () => {
  const { solDir, project } = sample();
  const plan = planBuild(project, { solutionDir: solDir, config: 'Debug' });
  assert.match(plan.commandLine, /^mkdir -p /);
  assert.ok(!plan.outFile.endsWith('.exe'));
});

test('IntelliSense data on Windows has no -static and names the compiler', () => {
  const { solDir, project } = sample();
  const e = compileCommands(project, { solutionDir: solDir, shell: 'cmd', compiler: 'C:/x/g++.exe' });
  assert.strictEqual(e[0].arguments[0], 'C:/x/g++.exe');
  assert.ok(!e[0].arguments.includes('-static'));
});

test('cmdQuote doubles inner quotes', () => {
  assert.strictEqual(cmdQuote('a b"c'), '"a b""c"');
});

test('the downloaded compiler is found and put first on PATH', () => {
  const env = { IDE_DATA_DIR: path.join('C:', 'data'), Path: 'C:\\Windows' };
  const has = (f) => f === path.join(env.IDE_DATA_DIR, 'mingw64', 'bin', 'g++.exe');
  assert.strictEqual(win.mingwBin(env, has), path.join(env.IDE_DATA_DIR, 'mingw64', 'bin'));
  const built = win.buildEnv(env, has);
  assert.ok(built.Path.startsWith(path.join(env.IDE_DATA_DIR, 'mingw64', 'bin') + path.delimiter));
  assert.strictEqual(win.mingwBin(env, () => false), '');
  assert.strictEqual(win.pathLine(env, () => false), '');
});

test('the program batch file waits for a key and survives % in paths', () => {
  const b = win.programBatch({ name: 'My (App)', cwd: 'C:\\a%b\\x', exe: 'C:\\a%b\\x\\p.exe' });
  assert.match(b, /\r\n/);
  assert.match(b, /cd \/d "C:\\a%%b\\x"/);
  assert.match(b, /"C:\\a%%b\\x\\p\.exe"/);
  assert.match(b, /exited with code %code%\]/);
  assert.match(b, /\r\npause\r\n$/);
});

test('runInConsole writes run.cmd and opens it with cmd start', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'run-'));
  let call;
  const spawn = (bin, args, opts) => {
    call = { bin, args, opts };
    const h = {};
    return { on: (ev, fn) => { h[ev] = fn; if (ev === 'spawn') setImmediate(fn); }, unref() {} };
  };
  const ok = await win.runInConsole('@echo off\r\n', dir, spawn);
  assert.strictEqual(ok, true);
  assert.strictEqual(call.bin, 'cmd.exe');
  assert.deepStrictEqual(call.args.slice(0, 4), ['/d', '/c', 'start', '""']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'run.cmd'), 'utf8'), '@echo off\r\n');
});

test('the launcher scripts exist and the PowerShell one has no non-ASCII bytes (Windows PowerShell 5 reads BOM-less files as ANSI)', () => {
  const ps1 = fs.readFileSync(path.join(__dirname, '..', 'bin', 'ide.ps1'));
  assert.ok(ps1.every((b) => b < 128));
  const cmd = fs.readFileSync(path.join(__dirname, '..', 'bin', 'ide.cmd'), 'utf8');
  assert.match(cmd, /ide\.ps1/);
  assert.match(cmd, /\r\n/); // batch files need CRLF
});

test('the Windows zip has the launcher with CRLF line endings, the icon and no editor', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wz-'));
  const out = path.join(dir, 'w.zip');
  const r = require('child_process').spawnSync('node', [path.join(__dirname, '..', 'scripts', 'build-windows-zip.js'), out], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const names = require('child_process').spawnSync('unzip', ['-Z1', out], { encoding: 'utf8' });
  if (names.error) return; // no unzip on this machine
  const list = names.stdout.split('\n');
  for (const n of ['bin/ide.cmd', 'bin/ide.ps1', 'extension/extension.js', 'extension/lib/windows.js', 'config/settings.windows.json', 'packaging/ide-of-doom-and-destruction.ico', 'scripts/pack-vsix.js']) {
    assert.ok(list.includes(n), n);
  }
  assert.ok(!list.some((n) => /^vscode\//.test(n)));
  const ps1 = require('child_process').spawnSync('unzip', ['-p', out, 'bin/ide.ps1'], { encoding: 'buffer' }).stdout.toString('latin1');
  assert.ok(!/[^\r]\n/.test(ps1), 'every line ends with CRLF');
});

test('settings.windows.json is valid and only adds the clangd driver permission', () => {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config', f), 'utf8'));
  const a = read('settings.json');
  const b = read('settings.windows.json');
  assert.ok(b['clangd.arguments'].some((x) => x.startsWith('--query-driver=')));
  delete a['clangd.arguments'];
  delete b['clangd.arguments'];
  assert.deepStrictEqual(a, b);
});
