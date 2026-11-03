'use strict';
// Self-update from GitHub releases, the same shape as the engine's `updaters` module: find the newest release (pre-releases
// included, drafts skipped), download its .deb, install it as root without freezing the editor, and only call it a success when
// dpkg reports the new version. The install rules and their reasons are in debInstall.js and the engine's updaters/MODULE.md.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const cp = require('child_process');
const deb = require('./debInstall');

const REPO = 'TurboNZL/ide-of-doom-and-destruction';
const PACKAGE = 'ide-of-doom-and-destruction';

function versionParts(tag) {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(String(tag));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when version `a` is newer than `b` (tags like v2026.11.0 or plain 2026.11.0). */
function isNewer(a, b) {
  const x = versionParts(a);
  const y = versionParts(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

/**
 * The newest usable release from GitHub's /releases list: drafts are skipped, pre-releases count.
 * Returns { tag, version, notes, url, prerelease, asset } or null; `asset` is null while the .deb is not attached yet.
 */
function pickRelease(releases) {
  const usable = (releases || []).filter((r) => r && !r.draft && versionParts(r.tag_name));
  usable.sort((a, b) => (isNewer(a.tag_name, b.tag_name) ? -1 : isNewer(b.tag_name, a.tag_name) ? 1 : 0));
  const r = usable[0];
  if (!r) return null;
  const version = String(r.tag_name).replace(/^v/, '');
  const debs = (r.assets || []).filter((a) => /\.deb$/i.test(a.name));
  const a = debs.find((x) => x.name.includes(version)) || debs[0];
  return {
    tag: r.tag_name,
    version,
    notes: r.body || '',
    url: r.html_url || '',
    prerelease: !!r.prerelease,
    asset: a ? { name: a.name, url: a.browser_download_url, size: a.size || 0 } : null
  };
}

/** GET with redirects. Calls `onResponse(res)` for the final response. */
function get(url, headers, onResponse, onError, redirects = 6) {
  const lib = url.startsWith('http:') ? http : https;
  const req = lib.get(url, { headers: { 'User-Agent': 'vsproj-tools', ...headers }, timeout: 15000 }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
      res.resume();
      get(new URL(res.headers.location, url).toString(), headers, onResponse, onError, redirects - 1);
      return;
    }
    onResponse(res);
  });
  req.on('timeout', () => req.destroy(new Error('The connection timed out.')));
  req.on('error', onError);
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    get(url, { Accept: 'application/vnd.github+json' }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (body += d));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error('GitHub answered ' + res.statusCode));
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    }, reject);
  });
}

/** The newest release of this tool (see pickRelease). `api` is only overridden in tests. */
async function latestRelease(api = 'https://api.github.com') {
  return pickRelease(await fetchJson(api + '/repos/' + REPO + '/releases?per_page=20'));
}

/** Downloads `url` to `dest` (through a .part file), reporting 0-100 to `onProgress`. */
function download(url, dest, onProgress = () => {}) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = dest + '.part';
    get(url, {}, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('The download failed (' + res.statusCode + ').')); }
      const total = Number(res.headers['content-length']) || 0;
      let got = 0;
      const out = fs.createWriteStream(part);
      res.on('data', (d) => {
        got += d.length;
        if (total) onProgress(Math.min(100, Math.round((got / total) * 100)));
      });
      res.pipe(out);
      out.on('finish', () => { fs.renameSync(part, dest); onProgress(100); resolve(dest); });
      out.on('error', reject);
      res.on('error', reject);
    }, reject);
  });
}

/** The version dpkg reports for this tool, or '' when the .deb is not installed. */
function installedVersion(exec = cp.execFileSync) {
  try {
    return String(exec('dpkg-query', ['-W', '-f=${Version}', PACKAGE], { encoding: 'utf8' })).trim();
  } catch (e) {
    return '';
  }
}

/** Runs the install script in the first terminal emulator that exists; resolves true when one opened and has closed again. */
async function installInTerminal(file, outside, spawn = cp.spawn) {
  const script = deb.terminalInstallScript(file);
  for (const t of deb.TERMINALS) {
    const opened = await new Promise((resolve) => {
      let started = false;
      const run = outside ? deb.outsideTree(t.bin, t.args(script)) : { bin: t.bin, args: t.args(script) };
      const child = spawn(run.bin, run.args, { stdio: 'ignore' });
      child.on('spawn', () => { started = true; });
      child.on('error', () => resolve(false));
      child.on('close', () => resolve(started));
    });
    if (opened) return true;
  }
  return false;
}

function runPkexec(file, spawn = cp.spawn) {
  return new Promise((resolve) => {
    let err = '';
    const child = spawn('pkexec', ['/bin/sh', '-c', deb.debInstallScript(file)], { stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', (d) => { err += String(d); });
    child.on('error', (e) => resolve({ ok: false, cancelled: false, message: 'pkexec could not be started (' + e.message + '). Install it from a terminal instead:' }));
    child.on('close', (code) => resolve(deb.describePkexec(code, err)));
  });
}

/**
 * Installs `file` (a .deb of version `wanted`). Resolves { ok: true } or { ok: false, message, command? }, in the order the
 * engine's rules give: terminal outside the process tree when no_new_privs is set; else pkexec; else a terminal with sudo.
 * `d` replaces the system calls in tests.
 */
async function installDeb(file, wanted, d = {}) {
  const readStatus = d.readStatus || (() => fs.readFileSync('/proc/self/status', 'utf8'));
  const terminal = d.terminal || installInTerminal;
  const pkexec = d.pkexec || runPkexec;
  const version = d.installedVersion || installedVersion;
  const command = deb.manualInstallCommand(file);
  let status = '';
  try { status = readStatus(); } catch (e) { /* unreadable: try the normal way */ }

  if (deb.hasNoNewPrivs(status)) {
    const ran = await terminal(file, true);
    if (ran && deb.installedMatches(version(), wanted)) return { ok: true };
    return { ok: false, message: deb.NO_NEW_PRIVS_MESSAGE, command };
  }
  const result = await pkexec(file);
  if (result.ok) return deb.installedMatches(version(), wanted) ? { ok: true } : { ok: false, message: 'The installer finished but the new version is not installed. Install it from a terminal instead:', command };
  if (result.cancelled) return { ok: false, message: result.message };
  const ran = await terminal(file, false);
  if (ran && deb.installedMatches(version(), wanted)) return { ok: true };
  return { ok: false, message: ran ? 'The terminal closed before the update was installed. Install it from a terminal instead:' : result.message, command };
}

/** Where downloads go and how to clear old ones. */
function updateDir(base) {
  const dir = path.join(base || os.tmpdir(), 'updates');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function clearOld(dir, keep) {
  for (const f of fs.readdirSync(dir)) if (path.join(dir, f) !== keep) fs.rmSync(path.join(dir, f), { force: true });
}

module.exports = { REPO, PACKAGE, isNewer, pickRelease, latestRelease, download, installedVersion, installDeb, installInTerminal, updateDir, clearOld };
