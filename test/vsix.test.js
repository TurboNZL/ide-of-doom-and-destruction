'use strict';
const test = require('node:test');
const assert = require('node:assert');
const cp = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

test('pack-vsix writes a valid package with the requested version', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vsix-'));
  const out = path.join(dir, 'x.vsix');
  const r = cp.spawnSync('node', [path.join(__dirname, '..', 'scripts', 'pack-vsix.js'), out, 'v2026.11.3'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  const t = cp.spawnSync('unzip', ['-t', out], { encoding: 'utf8' });
  if (t.error) return; // no unzip on this machine
  assert.strictEqual(t.status, 0, t.stdout);
  const pkg = JSON.parse(cp.spawnSync('unzip', ['-p', out, 'extension/package.json'], { encoding: 'utf8' }).stdout);
  assert.strictEqual(pkg.version, '2026.11.3');
  const names = cp.spawnSync('unzip', ['-Z1', out], { encoding: 'utf8' }).stdout.split('\n');
  for (const n of ['[Content_Types].xml', 'extension.vsixmanifest', 'extension/extension.js', 'extension/shims/pause']) {
    assert.ok(names.includes(n), n);
  }
});
