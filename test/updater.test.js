'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const up = require('../extension/lib/updater');
const deb = require('../extension/lib/debInstall');

const release = (tag, extra = {}) => ({ tag_name: tag, draft: false, prerelease: false, body: 'notes', html_url: 'https://example.test/' + tag, assets: [], ...extra });

test('versions compare numerically, not as text', () => {
  assert.ok(up.isNewer('v2026.11.0', 'v2026.10.9'));
  assert.ok(up.isNewer('2026.11.10', '2026.11.9'));
  assert.ok(!up.isNewer('2026.11.0', '2026.11.0'));
  assert.ok(!up.isNewer('junk', '2026.11.0'));
});

test('the newest release wins, pre-releases count and drafts are skipped', () => {
  const r = up.pickRelease([
    release('v2026.11.1', { draft: true }),
    release('v2026.11.0'),
    release('v2026.10.5', { prerelease: false }),
    release('v2026.11.2', { prerelease: true, assets: [{ name: 'ide-of-doom-and-destruction.deb', browser_download_url: 'u1' }, { name: 'ide-of-doom-and-destruction-2026.11.2.deb', browser_download_url: 'u2', size: 5 }] })
  ]);
  assert.strictEqual(r.version, '2026.11.2');
  assert.strictEqual(r.prerelease, true);
  assert.strictEqual(r.asset.url, 'u2', 'the versioned file is preferred over the alias');
});

test('a release with one unversioned .deb uses it', () => {
  const r = up.pickRelease([release('v2026.11.3', { assets: [{ name: 'ide-of-doom-and-destruction.deb', browser_download_url: 'u', size: 9 }] })]);
  assert.strictEqual(r.asset.name, 'ide-of-doom-and-destruction.deb');
});

test('a release whose package is not attached yet has no asset (still being built)', () => {
  assert.strictEqual(up.pickRelease([release('v2026.11.0')]).asset, null);
  assert.strictEqual(up.pickRelease([]), null);
});

test('quoting survives an apostrophe in the path', () => {
  assert.strictEqual(deb.shQuote("/tmp/it's.deb"), "'/tmp/it'\\''s.deb'");
  assert.strictEqual(deb.manualInstallCommand('/tmp/a.deb'), "sudo apt install '/tmp/a.deb'");
});

test('pkexec results are explained', () => {
  assert.ok(deb.describePkexec(0).ok);
  assert.ok(deb.describePkexec(126).cancelled);
  assert.match(deb.describePkexec(127).message, /polkit/);
  assert.match(deb.describePkexec(1, 'line1\nboom').message, /boom/);
  assert.match(deb.describePkexec(null).message, /none/);
});

test('no_new_privs is read from /proc status text and the terminal is started outside the tree', () => {
  assert.ok(deb.hasNoNewPrivs('Name:\tx\nNoNewPrivs:\t1\nSeccomp:\t0\n'));
  assert.ok(!deb.hasNoNewPrivs('NoNewPrivs:\t0\n'));
  const run = deb.outsideTree('xterm', ['-e', 'sh'], { DISPLAY: ':0', HOME: '/x' });
  assert.strictEqual(run.bin, 'systemd-run');
  assert.ok(run.args.includes('--setenv=DISPLAY') && !run.args.some((a) => a.includes('HOME')));
});

// installDeb with the system calls replaced
const dpkgSays = (v) => ({ installedVersion: () => v });

test('install: pkexec works and dpkg confirms the version', async () => {
  const r = await up.installDeb('/f.deb', '2026.11.0', { readStatus: () => 'NoNewPrivs:\t0', pkexec: async () => ({ ok: true }), ...dpkgSays('2026.11.0') });
  assert.deepStrictEqual(r, { ok: true });
});

test('install: success is decided by dpkg, not by the exit code', async () => {
  const r = await up.installDeb('/f.deb', '2026.11.0', { readStatus: () => '', pkexec: async () => ({ ok: true }), ...dpkgSays('2026.10.0') });
  assert.strictEqual(r.ok, false);
  assert.match(r.command, /sudo apt install/);
});

test('install: a closed password prompt stops without trying a terminal', async () => {
  let terminalCalled = false;
  const r = await up.installDeb('/f.deb', '1.0.0', {
    readStatus: () => '', pkexec: async () => deb.describePkexec(126), terminal: async () => { terminalCalled = true; return true; }, ...dpkgSays('')
  });
  assert.strictEqual(r.ok, false);
  assert.ok(!terminalCalled);
  assert.ok(!r.command);
});

test('install: no polkit agent falls back to a sudo terminal', async () => {
  const calls = [];
  const r = await up.installDeb('/f.deb', '2026.11.0', {
    readStatus: () => '', pkexec: async () => deb.describePkexec(127),
    terminal: async (file, outside) => { calls.push(outside); return true; }, ...dpkgSays('2026.11.0')
  });
  assert.deepStrictEqual(r, { ok: true });
  assert.deepStrictEqual(calls, [false]);
});

test('install: no_new_privs goes straight to a terminal outside the process tree', async () => {
  const calls = [];
  let pkexecCalled = false;
  const r = await up.installDeb('/f.deb', '2026.11.0', {
    readStatus: () => 'NoNewPrivs:\t1', pkexec: async () => { pkexecCalled = true; return { ok: true }; },
    terminal: async (file, outside) => { calls.push(outside); return true; }, ...dpkgSays('2026.11.0')
  });
  assert.deepStrictEqual(r, { ok: true });
  assert.deepStrictEqual(calls, [true]);
  assert.ok(!pkexecCalled);
});

test('install: when every route fails the user gets the command to copy', async () => {
  const r = await up.installDeb('/tmp/my file.deb', '2026.11.0', {
    readStatus: () => '', pkexec: async () => deb.describePkexec(127), terminal: async () => false, ...dpkgSays('')
  });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.command, "sudo apt install '/tmp/my file.deb'");
  assert.ok(r.message.length > 0);
});

test('download follows a redirect and reports progress', async () => {
  const body = Buffer.alloc(200000, 7);
  const server = http.createServer((req, res) => {
    if (req.url === '/start') { res.writeHead(302, { Location: '/real' }); return res.end(); }
    res.writeHead(200, { 'Content-Length': body.length });
    res.end(body);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
    const seen = [];
    const dest = await up.download('http://127.0.0.1:' + server.address().port + '/start', path.join(dir, 'x.deb'), (p) => seen.push(p));
    assert.ok(fs.readFileSync(dest).equals(body));
    assert.strictEqual(seen[seen.length - 1], 100);
    assert.ok(!fs.existsSync(dest + '.part'));
  } finally { server.close(); }
});

test('a failed download is an error, not an empty file', async () => {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
    await assert.rejects(up.download('http://127.0.0.1:' + server.address().port + '/x', path.join(dir, 'x.deb')), /404/);
    assert.ok(!fs.existsSync(path.join(dir, 'x.deb')));
  } finally { server.close(); }
});

test('latestRelease reads GitHub\'s release list', async () => {
  const server = http.createServer((req, res) => {
    assert.match(req.url, /^\/repos\/TurboNZL\/ide-of-doom-and-destruction\/releases/);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify([release('v2026.11.0')]));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await up.latestRelease('http://127.0.0.1:' + server.address().port);
    assert.strictEqual(r.version, '2026.11.0');
  } finally { server.close(); }
});
