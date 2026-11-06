'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const ws = require('../extension/lib/workspace');
const vcx = require('../extension/lib/vcxproj');
const sln = require('../extension/lib/solution');
const { planBuild, compileCommands } = require('../extension/lib/build');
const { packageSubmission } = require('../extension/lib/submission');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'vsproj-test-'));
}

function have(cmd) {
  return cp.spawnSync('sh', ['-c', 'command -v ' + cmd]).status === 0;
}

function newSolution(name = 'Demo', format = 'slnx') {
  const root = tmp();
  ws.createProject({ location: root, name, solutionFormat: format });
  return ws.loadSolution(path.join(root, name));
}

test('a new console app has the Visual Studio layout', () => {
  const s = newSolution();
  assert.strictEqual(s.format, 'slnx');
  assert.strictEqual(s.projects.length, 1);
  const p = s.projects[0];
  assert.strictEqual(p.name, 'Demo');
  assert.strictEqual(p.settings.standard, 'c++20');
  assert.deepStrictEqual(p.sources.map((x) => x.file), ['Demo.cpp']);
  assert.ok(fs.existsSync(path.join(s.dir, 'Demo', 'Demo.vcxproj.filters')));
  assert.ok(fs.existsSync(path.join(s.dir, '.gitignore')));
  assert.match(fs.readFileSync(p.file, 'utf8'), /\r\n/);
  assert.ok(fs.readFileSync(p.filtersFile, 'utf8').startsWith('﻿'), 'filters keep the byte order mark');
});

test('the project can be created as a classic .sln too', () => {
  const s = newSolution('Old', 'sln');
  assert.strictEqual(s.format, 'sln');
  assert.strictEqual(s.projects.length, 1);
});

test('names that are not usable are refused', () => {
  assert.throws(() => ws.createProject({ location: tmp(), name: '1bad' }));
  assert.throws(() => ws.createProject({ location: tmp(), name: 'a/b' }));
  assert.ok(!ws.isValidIdentifier('my class'));
  assert.ok(ws.isValidIdentifier('Player'));
});

test('Add Class adds both files to the project and filters, in order', () => {
  const s = newSolution();
  const p = s.projects[0];
  ws.addClass(p, 'Zebra');
  ws.addClass(ws.loadProject(p.file), 'Alpha');
  const again = ws.loadProject(p.file);
  assert.deepStrictEqual(again.sources.map((x) => x.file), ['Alpha.cpp', 'Demo.cpp', 'Zebra.cpp']);
  assert.deepStrictEqual(again.headers, ['Alpha.h', 'Zebra.h']);
  assert.strictEqual(again.filters.files['Alpha.h'], 'Header Files');
  assert.strictEqual(again.filters.files['Zebra.cpp'], 'Source Files');
  assert.match(fs.readFileSync(path.join(p.dir, 'Alpha.h'), 'utf8'), /class Alpha/);
  assert.throws(() => ws.addClass(again, 'Alpha'), /already exists/);
});

test('adding then removing restores the project files exactly', () => {
  const s = newSolution();
  const p = s.projects[0];
  const before = [p.file, p.filtersFile].map((f) => fs.readFileSync(f));
  ws.addClass(p, 'Temp');
  ws.removeFile(ws.loadProject(p.file), 'Temp.h', true);
  ws.removeFile(ws.loadProject(p.file), 'Temp.cpp', true);
  const after = [p.file, p.filtersFile].map((f) => fs.readFileSync(f));
  assert.ok(before[0].equals(after[0]), 'vcxproj identical');
  assert.ok(before[1].equals(after[1]), 'filters identical');
  assert.ok(!fs.existsSync(path.join(p.dir, 'Temp.h')));
});

test('a project with no header group gets one', () => {
  const s = newSolution();
  const p = s.projects[0];
  const text = fs.readFileSync(p.file, 'utf8');
  assert.ok(!/ClInclude/.test(text));
  const out = vcx.addFileToProject(text, 'Thing.h');
  assert.match(out, /<ItemGroup>\r\n {4}<ClInclude Include="Thing.h" \/>\r\n {2}<\/ItemGroup>/);
  assert.ok(out.indexOf('ClInclude') < out.indexOf('Microsoft.Cpp.targets'));
});

test('files in a sub folder use backslashes in the project and are found again', () => {
  const s = newSolution();
  const p = s.projects[0];
  const out = vcx.addFileToProject(fs.readFileSync(p.file, 'utf8'), 'src/Util.cpp');
  assert.match(out, /Include="src\\Util.cpp"/);
  assert.ok(vcx.parseProject(out, p.file).sources.some((x) => x.file === 'src/Util.cpp'));
});

test('files the project does not list are reported', () => {
  const s = newSolution();
  const p = s.projects[0];
  fs.writeFileSync(path.join(p.dir, 'Loose.cpp'), '// x\n');
  assert.deepStrictEqual(ws.untrackedFiles(p), ['Loose.cpp']);
  ws.addFile(p, path.join(p.dir, 'Loose.cpp'));
  assert.deepStrictEqual(ws.untrackedFiles(ws.loadProject(p.file)), []);
});

test('settings come from the matching configuration', () => {
  const text = fs.readFileSync(newSolution().projects[0].file, 'utf8');
  const dbg = vcx.parseProject(text, 'X.vcxproj', 'Debug', 'x64');
  const rel32 = vcx.parseProject(text, 'X.vcxproj', 'Release', 'x86');
  assert.ok(dbg.settings.defines.includes('_DEBUG'));
  assert.ok(!dbg.settings.defines.includes('WIN32'));
  assert.ok(rel32.settings.defines.includes('NDEBUG'));
  assert.ok(rel32.settings.defines.includes('WIN32'));
  assert.strictEqual(dbg.configs.length, 4);
});

test('the build plan maps Visual Studio settings to compiler flags', () => {
  const s = newSolution();
  const plan = planBuild(s.projects[0], { solutionDir: s.dir, config: 'Debug', platform: 'x64' });
  for (const flag of ['-std=c++20', '-Wall', '-Wextra', '-g', '-O0', '-D_DEBUG']) assert.ok(plan.args.includes(flag), flag);
  assert.ok(plan.outFile.endsWith(path.join('x64', 'Debug', 'Demo')));
  const rel = planBuild(s.projects[0], { solutionDir: s.dir, config: 'Release', platform: 'x64', target: 'windows' });
  assert.ok(rel.args.includes('-O2') && rel.args.includes('-static') && rel.args.includes('-DUNICODE'));
  assert.ok(rel.outFile.endsWith('Demo.exe'));
  const entries = compileCommands(s.projects[0], { solutionDir: s.dir });
  assert.strictEqual(entries.length, 1);
  assert.ok(entries[0].arguments.includes('-c'));
});

test('IntelliSense data is written inside .vs', () => {
  const s = newSolution();
  const file = ws.writeCompileCommands(s, {});
  assert.ok(file.endsWith(path.join('.vs', 'compile_commands.json')));
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1);
});

test('the generated build command compiles and the program runs', { skip: !have('g++') }, () => {
  const s = newSolution();
  const p = s.projects[0];
  const plan = planBuild(p, { solutionDir: s.dir });
  const b = cp.spawnSync('sh', ['-c', plan.commandLine], { cwd: plan.cwd, encoding: 'utf8' });
  assert.strictEqual(b.status, 0, b.stderr);
  const r = cp.spawnSync(plan.outFile, { encoding: 'utf8' });
  assert.strictEqual(r.stdout, 'Hello World!\n');
});

test('compile errors are reported as file:line:column for the Problems panel', { skip: !have('g++') }, () => {
  const s = newSolution();
  const p = s.projects[0];
  fs.writeFileSync(path.join(p.dir, 'Demo.cpp'), 'int main() { return missing; }\n');
  const plan = planBuild(p, { solutionDir: s.dir });
  const b = cp.spawnSync('sh', ['-c', plan.commandLine], { cwd: plan.cwd, encoding: 'utf8' });
  assert.notStrictEqual(b.status, 0);
  const re = new RegExp('^(.*?):(\\d+):(\\d+):\\s+(warning|error|fatal error):\\s+(.*)$', 'm'); // the matcher in package.json
  const m = re.exec(b.stderr);
  assert.ok(m, b.stderr);
  assert.strictEqual(m[1], path.join('Demo', 'Demo.cpp'));
  assert.strictEqual(m[4], 'error');
});

test('the problem matcher in package.json is the one tested above', () => {
  const pkg = require('../extension/package.json');
  assert.strictEqual(pkg.contributes.problemMatchers[0].pattern.regexp, '^(.*?):(\\d+):(\\d+):\\s+(warning|error|fatal error):\\s+(.*)$');
});

test('a classic .sln can be made from a project and read back', () => {
  const s = newSolution();
  const p = s.projects[0];
  const text = sln.makeSln([{ name: p.name, relPath: 'Demo/Demo.vcxproj', guid: p.guid }], s.platforms);
  assert.match(text, /Format Version 12\.00/);
  assert.match(text, /Debug\|x86\.ActiveCfg = Debug\|Win32/);
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'Demo'));
  fs.writeFileSync(path.join(dir, 'Demo', 'Demo.vcxproj'), '');
  fs.writeFileSync(path.join(dir, 'Demo.sln'), text);
  const back = sln.readSolution(path.join(dir, 'Demo.sln'));
  assert.deepStrictEqual(back.projects, [path.join(dir, 'Demo', 'Demo.vcxproj')]);
});

test('packaging makes a source folder and a release folder with an exe', { skip: !have('x86_64-w64-mingw32-g++') }, () => {
  const s = newSolution();
  const p = s.projects[0];
  ws.addClass(p, 'Board');
  fs.writeFileSync(path.join(p.dir, 'Notes.txt'), 'not for submission');
  fs.mkdirSync(path.join(s.dir, 'x64', 'Debug'), { recursive: true });
  fs.writeFileSync(path.join(s.dir, 'x64', 'Debug', 'Demo.pdb'), 'junk');
  const out = path.join(s.dir, 'Submission');
  const r = packageSubmission({
    solution: ws.loadSolution(s.dir), project: ws.loadProject(p.file), outRoot: out, name: 'Sam Example',
    sourceTemplate: 'Source - {name}', releaseTemplate: 'Release - {name}', solutionName: 'Final'
  });
  assert.strictEqual(path.basename(r.sourceDir), 'Source - Sam Example');
  assert.strictEqual(path.basename(r.releaseDir), 'Release - Sam Example');
  const listed = fs.readdirSync(r.sourceDir, { recursive: true }).map((f) => f.split(path.sep).join('/')).sort();
  assert.deepStrictEqual(listed.filter((f) => !f.endsWith('/') && fs.statSync(path.join(r.sourceDir, f)).isFile()),
    ['Demo/Board.cpp', 'Demo/Board.h', 'Demo/Demo.cpp', 'Demo/Demo.vcxproj', 'Demo/Demo.vcxproj.filters', 'Final.sln', 'Final.slnx']);
  assert.deepStrictEqual(fs.readdirSync(r.releaseDir).sort(), ['Demo.exe', 'Readme.txt']);
  const exe = fs.readFileSync(r.exe);
  assert.strictEqual(exe.subarray(0, 2).toString(), 'MZ', 'a Windows executable');
  assert.ok(!fs.existsSync(path.join(out, '.build')));
});

test('a failed release build stops before any folder is written', () => {
  const s = newSolution();
  const out = path.join(s.dir, 'Submission');
  assert.throws(() => packageSubmission({
    solution: s, project: s.projects[0], outRoot: out, name: 'X',
    run: () => ({ status: 1, output: 'Demo.cpp:1:1: error: boom' })
  }), /boom/);
  assert.ok(!fs.existsSync(path.join(out, 'Source - X')));
});

test('folder names cannot escape the submission folder', () => {
  const { folderName } = require('../extension/lib/submission');
  assert.strictEqual(folderName('Source - {name}', { name: '../evil' }), 'Source - .._evil');
});

test('renameFile renames on disk, in the project and in the filters', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rename-'));
  const slnPath = ws.createProject({ location: dir, name: 'Ren' });
  const p = { file: path.join(path.dirname(slnPath), 'Ren', 'Ren.vcxproj') };
  const proj = ws.loadProject(p.file);
  ws.addClass(proj, 'Old');
  ws.renameFile(ws.loadProject(p.file), 'Old.h', 'New.h');
  assert.ok(fs.existsSync(path.join(proj.dir, 'New.h')));
  assert.ok(!fs.existsSync(path.join(proj.dir, 'Old.h')));
  assert.match(fs.readFileSync(p.file, 'utf8'), /ClInclude Include="New\.h"/);
  assert.doesNotMatch(fs.readFileSync(p.file, 'utf8'), /Old\.h/);
  assert.throws(() => ws.renameFile(ws.loadProject(p.file), 'New.h', 'Old.cpp'), /already exists/);
});
