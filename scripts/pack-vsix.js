#!/usr/bin/env node
'use strict';
// Packs ./extension into a .vsix (a zip VS Code installs), with no dependencies.
// Usage: node scripts/pack-vsix.js <output.vsix> [version]

const fs = require('fs');
const path = require('path');
const { makeZip } = require('../extension/lib/zip');

const root = path.join(__dirname, '..', 'extension');
const out = process.argv[2];
if (!out) {
  console.error('Usage: pack-vsix.js <output.vsix> [version]');
  process.exit(2);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = (process.argv[3] || process.env.IDE_VERSION || pkg.version).replace(/^v/, '');
pkg.version = version;

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const manifest =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">\n' +
  '  <Metadata>\n' +
  '    <Identity Language="en-US" Id="' + esc(pkg.name) + '" Version="' + esc(version) + '" Publisher="' + esc(pkg.publisher) + '" />\n' +
  '    <DisplayName>' + esc(pkg.displayName) + '</DisplayName>\n' +
  '    <Description xml:space="preserve">' + esc(pkg.description) + '</Description>\n' +
  '    <Tags></Tags>\n' +
  '    <Categories>Other</Categories>\n' +
  '    <GalleryFlags>Public</GalleryFlags>\n' +
  '    <Properties>\n' +
  '      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="' + esc(pkg.engines.vscode) + '" />\n' +
  '      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />\n' +
  '      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />\n' +
  '      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />\n' +
  '      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />\n' +
  '    </Properties>\n' +
  '  </Metadata>\n' +
  '  <Installation>\n    <InstallationTarget Id="Microsoft.VisualStudio.Code" />\n  </Installation>\n' +
  '  <Dependencies />\n' +
  '  <Assets>\n    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />\n  </Assets>\n' +
  '</PackageManifest>\n';

const contentTypes =
  '<?xml version="1.0" encoding="utf-8"?>\n' +
  '<Types xmlns="http://schemas.openxmlformats.org/package/2006/Content-Types">' +
  '<Default Extension=".json" ContentType="application/json" />' +
  '<Default Extension=".js" ContentType="application/javascript" />' +
  '<Default Extension=".svg" ContentType="image/svg+xml" />' +
  '<Default Extension=".md" ContentType="text/markdown" />' +
  '<Default Extension=".vsixmanifest" ContentType="text/xml" />' +
  '<Default Extension="" ContentType="text/plain" />' +
  '</Types>\n';

function walk(dir, base = '') {
  const found = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) found.push(...walk(path.join(dir, e.name), rel));
    else found.push(rel);
  }
  return found;
}

const entries = [
  { name: '[Content_Types].xml', data: contentTypes },
  { name: 'extension.vsixmanifest', data: manifest },
  { name: 'extension/package.json', data: JSON.stringify(pkg, null, 2) + '\n' }
];
for (const rel of walk(root)) {
  if (rel === 'package.json') continue;
  const mode = fs.statSync(path.join(root, rel)).mode & 0o777;
  entries.push({ name: 'extension/' + rel, data: fs.readFileSync(path.join(root, rel)), mode });
}
const license = path.join(__dirname, '..', 'LICENSE');
if (fs.existsSync(license)) entries.push({ name: 'extension/LICENSE.txt', data: fs.readFileSync(license) });

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, makeZip(entries));
console.log('Wrote ' + out + ' (version ' + version + ', ' + entries.length + ' files)');
