#!/usr/bin/env node
'use strict';
// Gives the downloaded copy of the editor this tool's name and icon, so the desktop shows "IDE of Doom and Destruction"
// instead of "Visual Studio Code": window class (desktopName), display name and window icon. Only this private copy is
// changed (the originals are kept next to it as *.orig); a normal VS Code install is never touched. Safe to run again.
// Usage: node brand-editor.js <editor folder> <icon.png>

const fs = require('fs');
const path = require('path');

const [dir, icon] = process.argv.slice(2);
if (!dir || !icon) {
  console.error('Usage: brand-editor.js <editor folder> <icon.png>');
  process.exit(2);
}
const NAME = 'IDE of Doom and Destruction';
const DESKTOP = 'ide-of-doom-and-destruction.desktop';
const app = path.join(dir, 'resources', 'app');

function backup(file) {
  if (fs.existsSync(file) && !fs.existsSync(file + '.orig')) fs.copyFileSync(file, file + '.orig');
}

function editJson(file, change) {
  if (!fs.existsSync(file)) return false;
  backup(file);
  const data = JSON.parse(fs.readFileSync(file + '.orig', 'utf8')); // always from the original, so it never stacks
  change(data);
  fs.writeFileSync(file, JSON.stringify(data, null, '\t') + '\n');
  return true;
}

const found = editJson(path.join(app, 'package.json'), (p) => { p.desktopName = DESKTOP; });
editJson(path.join(app, 'product.json'), (p) => { p.nameShort = NAME; p.nameLong = NAME; });
const target = path.join(app, 'resources', 'linux', 'code.png');
if (fs.existsSync(path.dirname(target)) && fs.existsSync(icon)) {
  backup(target);
  fs.copyFileSync(icon, target);
}
if (!found) {
  console.error('Not an editor folder (no resources/app/package.json): ' + dir);
  process.exit(1);
}
console.log('Branded ' + dir);
