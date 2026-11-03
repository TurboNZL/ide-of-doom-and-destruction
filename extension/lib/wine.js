'use strict';
// Runs Windows programs (the .exe from a Windows build or a packaged submission) with Wine, in a Wine prefix kept in
// the tool's own data folder so nothing is written to ~/.wine.

const os = require('os');
const path = require('path');
const { onPath } = require('./terminal');

const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

/** The tool's data folder: set by the launcher, else the default under XDG_DATA_HOME. */
function dataDir(env = process.env) {
  if (env.IDE_DATA_DIR) return env.IDE_DATA_DIR;
  return path.join(env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'ide-of-doom-and-destruction');
}

function prefixDir(env = process.env) {
  return path.join(dataDir(env), 'wine-prefix');
}

/** 'wine' or 'wine64' if installed, else null. */
function findWine(which = (b) => onPath(b)) {
  return ['wine', 'wine64'].find((w) => which(w)) || null;
}

const INSTALL_HINT = 'Wine is not installed. Arch family: sudo pacman -S wine. Debian family: sudo apt install wine64. Fedora: sudo dnf install wine.';

/** Shell text that points Wine at the saved prefix (to go before the command). Mono and Gecko prompts are skipped: console programs do not need them. */
function wineSetup(env = process.env) {
  const prefix = prefixDir(env);
  return 'export WINEPREFIX=' + q(prefix) + ' WINEDEBUG=-all WINEDLLOVERRIDES="mscoree,mshtml="; ' +
    '[ -d ' + q(prefix) + ' ] || echo ' + q('Setting up the Windows prefix in ' + prefix + ' (first run only)...') + '; ';
}

function wineCommand(wine, exe) {
  return q(wine) + ' ' + q(exe);
}

module.exports = { dataDir, prefixDir, findWine, wineSetup, wineCommand, INSTALL_HINT };
