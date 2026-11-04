#!/usr/bin/env node
'use strict';
// CI on a Windows runner: builds a sample solution with exactly the command line the extension runs (cmd.exe syntax,
// g++ from PATH) and checks the .exe prints what it should. Usage: node scripts/check-windows-build.js <folder>
const cp = require('child_process');
const fs = require('fs');
const path = require('path');

const out = path.resolve(process.argv[2] || 'sample');
const made = cp.spawnSync('node', [path.join(__dirname, 'make-sample.js'), out], { stdio: 'inherit' });
if (made.status !== 0) process.exit(1);

const ws = require('../extension/lib/workspace');
const { planBuild } = require('../extension/lib/build');
const solDir = path.join(out, 'Sample');
const project = ws.loadSolution(solDir).projects[0];
const plan = planBuild(project, { solutionDir: solDir, cwd: solDir, shell: 'cmd', config: 'Release', platform: 'x64' });
console.log(plan.commandLine);
const r = cp.spawnSync('cmd.exe', ['/d', '/c', '"' + plan.commandLine + '"'], { cwd: plan.cwd, windowsVerbatimArguments: true, stdio: 'inherit' });
if (r.status !== 0) { console.error('build failed'); process.exit(1); }
const run = cp.spawnSync(plan.outFile, [], { encoding: 'utf8' });
if (String(run.stdout).trim() !== 'board 10') { console.error('unexpected output: ' + run.stdout); process.exit(1); }
console.log('ok: ' + plan.outFile + ' printed ' + run.stdout.trim());
