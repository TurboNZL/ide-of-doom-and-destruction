'use strict';
// Finds the terminal window to run programs in: the user's choice, $TERMINAL, the desktop's own, or the first known one.
// Works on any distribution (Debian family, Arch family, ...): nothing here is tied to one package manager.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

// For each terminal: the arguments that come before "sh -c <script>" to run a command in a new window.
const KNOWN = {
  konsole: ['-e'],
  'gnome-terminal': ['--'],
  kgx: ['--'],
  ptyxis: ['--'],
  'xfce4-terminal': ['-x'],
  'mate-terminal': ['-x'],
  terminator: ['-x'],
  kitty: [],
  foot: [],
  alacritty: ['-e'],
  wezterm: ['start', '--'],
  lxterminal: ['-e'],
  qterminal: ['-e'],
  'x-terminal-emulator': ['-e'],
  xterm: ['-e'],
  'xdg-terminal-exec': []
};

const GNOME_FIRST = ['kgx', 'ptyxis', 'gnome-terminal'];
const GENERAL = ['xdg-terminal-exec', 'x-terminal-emulator', 'konsole', 'gnome-terminal', 'kgx', 'ptyxis', 'xfce4-terminal', 'kitty', 'alacritty', 'foot', 'wezterm', 'terminator', 'lxterminal', 'qterminal', 'mate-terminal', 'xterm'];

/** True when `bin` is an executable on PATH (or an executable path). */
function onPath(bin, env = process.env) {
  if (bin.includes('/')) {
    try { fs.accessSync(bin, fs.constants.X_OK); return true; } catch (e) { return false; }
  }
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    try { fs.accessSync(path.join(dir, bin), fs.constants.X_OK); return true; } catch (e) { /* next */ }
  }
  return false;
}

/** KDE's configured terminal (System Settings > Default Applications), or '' when not set or not KDE. */
function kdeTerminal(run = cp.spawnSync) {
  for (const tool of ['kreadconfig6', 'kreadconfig5']) {
    const r = run(tool, ['--file', 'kdeglobals', '--group', 'General', '--key', 'TerminalApplication'], { encoding: 'utf8' });
    if (!r.error && r.status === 0 && r.stdout.trim()) return r.stdout.trim().split(/\s+/)[0];
  }
  return '';
}

function split(command) {
  const parts = String(command).trim().split(/\s+/).filter(Boolean);
  return { bin: parts[0], args: parts.slice(1) };
}

/** A bare name gets the right arguments; a full command ("alacritty -e") is used as written. */
function fromCommand(command) {
  const c = split(command);
  return c.args.length ? { bin: c.bin, pre: c.args } : { bin: c.bin, pre: KNOWN[path.basename(c.bin)] || ['-e'] };
}

/**
 * Chooses a terminal and the command line that runs `script` (a /bin/sh script) in it.
 * opts: { custom (the user's setting), env, which, kde }. Returns { bin, args } or null when none exists.
 */
function launchFor(script, opts = {}) {
  const env = opts.env || process.env;
  const which = opts.which || ((b) => onPath(b, env));
  const kde = opts.kde || kdeTerminal;
  const tries = [];

  if (opts.custom && opts.custom.trim()) tries.push(fromCommand(opts.custom));
  if (env.TERMINAL && env.TERMINAL.trim()) tries.push(fromCommand(env.TERMINAL));

  const desktop = String(env.XDG_CURRENT_DESKTOP || '').toUpperCase();
  const names = [];
  if (desktop.includes('KDE')) {
    const k = kde();
    if (k) names.push(path.basename(k));
    names.push('konsole');
  } else if (desktop.includes('GNOME')) names.push(...GNOME_FIRST);
  names.push(...GENERAL);
  for (const n of [...new Set(names)]) if (KNOWN[n]) tries.push({ bin: n, pre: KNOWN[n] });

  for (const t of tries) {
    if (which(t.bin)) return { bin: t.bin, args: [...t.pre, 'sh', '-c', script] };
  }
  return null;
}

/** Runs `script` in a new terminal window. Resolves true when a window was started, false when no terminal exists. */
function runInTerminal(script, opts = {}) {
  const launch = launchFor(script, opts);
  if (!launch) return Promise.resolve(false);
  return new Promise((resolve) => {
    const child = cp.spawn(launch.bin, launch.args, { detached: true, stdio: 'ignore', cwd: opts.cwd });
    child.on('error', () => resolve(false));
    child.on('spawn', () => { child.unref(); resolve(true); });
  });
}

const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

/** What a terminal window runs for a program: run it, show the exit code, wait for Enter so the output can be read. */
function programScript({ name, cwd, command, pathPrefix, extra = '' }) {
  return (pathPrefix ? 'PATH=' + q(pathPrefix) + ':"$PATH"; export PATH; ' : '') +
    extra +
    'cd ' + q(cwd) + ' || exit 1; ' +
    command + '; code=$?; echo; echo ' + q('[' + name + ' exited with code ') + '"$code]"; ' +
    "printf 'Press Enter to close this window... '; read _";
}

module.exports = { KNOWN, onPath, kdeTerminal, launchFor, runInTerminal, programScript };
