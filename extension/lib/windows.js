'use strict';
// Everything specific to running on a Windows computer: where the MinGW compiler lives, the PATH to build with, the
// console window a program runs in, and the update command. No VS Code API in here, so it is testable anywhere.

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const isWindows = () => process.platform === 'win32';

/** The tool's data folder: set by the launcher (IDE_DATA_DIR), else %LOCALAPPDATA%\ide-of-doom-and-destruction. */
function dataDir(env = process.env) {
  if (env.IDE_DATA_DIR) return env.IDE_DATA_DIR;
  return path.join(env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'ide-of-doom-and-destruction');
}

/** The compiler `ide setup` downloads (WinLibs MinGW-w64), kept next to the editor. Returns its bin folder or ''. */
function mingwBin(env = process.env, exists = fs.existsSync) {
  const bin = path.join(dataDir(env), 'mingw64', 'bin');
  return exists(path.join(bin, 'g++.exe')) ? bin : '';
}

/** An environment whose PATH starts with the downloaded compiler (if there is one). */
function buildEnv(env = process.env, exists = fs.existsSync) {
  const bin = mingwBin(env, exists);
  if (!bin) return { ...env };
  const key = Object.keys(env).find((k) => k.toLowerCase() === 'path') || 'PATH';
  return { ...env, [key]: bin + path.delimiter + (env[key] || '') };
}

/** `set "PATH=..."` text for a batch file or a cmd line, so the downloaded compiler is found. */
function pathLine(env = process.env, exists = fs.existsSync) {
  const bin = mingwBin(env, exists);
  return bin ? 'set "PATH=' + bin + ';%PATH%"' : '';
}

const crlf = (lines) => lines.join('\r\n') + '\r\n';

/**
 * The batch file a console window runs for a program: go to the folder, run it, show the exit code, wait for a key.
 * `%` in a batch file must be doubled, so paths with a percent sign survive.
 */
function programBatch({ name, cwd, exe }) {
  const lit = (s) => String(s).replace(/%/g, '%%');
  return crlf([
    '@echo off',
    'chcp 65001 >nul',
    'title ' + lit(name).replace(/[&|<>^]/g, ' '),
    'cd /d "' + lit(cwd) + '" || exit /b 1',
    '"' + lit(exe) + '"',
    'set "code=%ERRORLEVEL%"',
    'echo.',
    'echo [' + lit(name).replace(/[&|<>^()]/g, ' ') + ' exited with code %code%]',
    'pause'
  ]);
}

/** Writes the batch file under `dir` and opens it in a new console window. Resolves true when the window was started. */
function runInConsole(batch, dir, spawn = cp.spawn) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'run.cmd');
  fs.writeFileSync(file, batch);
  return new Promise((resolve) => {
    // "start" opens a new window; the empty "" is the window title it would otherwise take from the first quoted argument.
    const child = spawn('cmd.exe', ['/d', '/c', 'start', '""', '"' + file + '"'], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true });
    child.on('error', () => resolve(false));
    child.on('spawn', () => { child.unref(); resolve(true); });
  });
}

/** How to run the launcher's own update on Windows (ide.cmd, which the launcher exports as IDE_BIN). */
function updateCommand(env = process.env) {
  const bin = env.IDE_BIN || 'ide';
  return { bin: 'cmd.exe', args: ['/d', '/c', '"' + bin + '" update'], options: { windowsVerbatimArguments: true } };
}

module.exports = { isWindows, dataDir, mingwBin, buildEnv, pathLine, programBatch, runInConsole, updateCommand };
