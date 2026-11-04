#!/usr/bin/env node
'use strict';
// Packs the tool for Windows: a zip to unpack anywhere, then run bin\ide.cmd setup (downloads the editor and the compiler).
// Like the .deb it never ships VS Code. Usage: node scripts/build-windows-zip.js <output.zip>

const fs = require('fs');
const path = require('path');
const { makeZip } = require('../extension/lib/zip');

const out = process.argv[2];
if (!out) {
  console.error('Usage: build-windows-zip.js <output.zip>');
  process.exit(2);
}
const root = path.join(__dirname, '..');
const FILES = [
  'bin/ide.cmd', 'bin/ide.ps1', 'package.json', 'README.md', 'LICENSE',
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
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, makeZip(entries));
console.log('Wrote ' + out + ' (' + entries.length + ' files)');
