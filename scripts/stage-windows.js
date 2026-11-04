#!/usr/bin/env node
'use strict';
// Writes the files of the Windows tool to a folder; scripts/build-windows-installer.sh packs them into the installer.
// Like the .deb it never ships VS Code (the launcher downloads it). Usage: node scripts/stage-windows.js <folder>

const fs = require('fs');
const path = require('path');

const stageDir = process.argv[2];
if (!stageDir) {
  console.error('Usage: stage-windows.js <folder>');
  process.exit(2);
}
const root = path.join(__dirname, '..');
const FILES = [
  'bin/ide.cmd', 'bin/ide.ps1', 'bin/ide.vbs', 'package.json', 'README.md', 'LICENSE',
  'config', 'extension', 'scripts', 'packaging/ide-of-doom-and-destruction.ico', 'packaging/ide-of-doom-and-destruction.png'
];

function walk(rel, list) {
  const abs = path.join(root, rel);
  if (fs.statSync(abs).isDirectory()) {
    for (const name of fs.readdirSync(abs).sort()) if (name !== 'node_modules') walk(rel + '/' + name, list);
  } else list.push(rel);
  return list;
}

const entries = [];
for (const f of FILES) for (const rel of walk(f, [])) {
  let data = fs.readFileSync(path.join(root, rel));
  // Batch files and PowerShell scripts want Windows line endings; a checkout on Linux has LF.
  if (/\.(cmd|ps1)$/.test(rel)) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
  entries.push({ name: rel, data });
}
fs.rmSync(stageDir, { recursive: true, force: true });
for (const e of entries) {
  const to = path.join(stageDir, e.name);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, e.data);
}
console.log('Staged ' + entries.length + ' files in ' + stageDir);
