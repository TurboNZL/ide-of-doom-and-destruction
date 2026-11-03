'use strict';
// Builds the two folders a project hands in: the source folder (code, solution, project files
// and nothing else) and the release folder (the Windows .exe and a Readme.txt).

const fs = require('fs');
const path = require('path');
const cp = require('child_process');
const { toSlash } = require('./text');
const sln = require('./solution');
const vcx = require('./vcxproj');
const tpl = require('./templates');
const { planBuild } = require('./build');

/** Makes a name safe to use as a folder name. */
function safeName(name) {
  return String(name).replace(/[\\/:*?"<>|]/g, '_').trim();
}

/** "Source - {name}" with the placeholders filled in. */
function folderName(template, values) {
  return safeName(template.replace(/\{(\w+)\}/g, (m, k) => (values[k] !== undefined ? values[k] : m)));
}

function copyInto(destRoot, srcRoot, absFile) {
  const rel = path.relative(srcRoot, absFile);
  if (rel.startsWith('..')) throw new Error(absFile + ' is outside the solution folder, so it cannot be packaged.');
  const dest = path.join(destRoot, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(absFile, dest);
  return rel;
}

function resetDir(root, dir) {
  const rel = path.relative(root, dir);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Refusing to clear ' + dir);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

/**
 * opts: { solution (from workspace.loadSolution), project (the one to build), outRoot, name,
 *         sourceTemplate, releaseTemplate, solutionName, platform, compiler, run }
 * `run(compiler, args, cwd)` runs a command and returns { status, output }; defaults to spawnSync.
 * Returns { sourceDir, releaseDir, exe, files }.
 */
function packageSubmission(opts) {
  const { solution, project, outRoot } = opts;
  const values = { name: opts.name || 'Student', project: project.name };
  const sourceDir = path.join(outRoot, folderName(opts.sourceTemplate || 'Source - {name}', values));
  const releaseDir = path.join(outRoot, folderName(opts.releaseTemplate || 'Release - {name}', values));
  if (sourceDir === releaseDir) throw new Error('The source and release folders need different names.');
  fs.mkdirSync(outRoot, { recursive: true });

  // 1. Release build first, so a compile error stops before anything is written.
  const platform = opts.platform || 'x64';
  const exeName = project.targetName + '.exe';
  const exe = path.join(releaseDir, exeName);
  const plan = planBuild(project, {
    solutionDir: solution.dir, config: 'Release', platform, target: 'windows', compiler: opts.compiler, outFile: path.join(outRoot, '.build', exeName)
  });
  fs.mkdirSync(path.dirname(plan.outFile), { recursive: true });
  const result = (opts.run || defaultRun)(plan.compiler, plan.args, plan.cwd);
  if (result.status !== 0) {
    const e = new Error('The release build failed:\n' + result.output);
    e.output = result.output;
    throw e;
  }

  // 2. Source folder: solution, projects, filters, and the listed code files.
  resetDir(outRoot, sourceDir);
  const files = [];
  const solBase = opts.solutionName ? safeName(opts.solutionName) : path.basename(solution.file, path.extname(solution.file));
  const eolFor = '\r\n';
  const projectRefs = [];
  for (const p of solution.projects) {
    files.push(copyInto(sourceDir, solution.dir, p.file));
    if (p.filtersFile) files.push(copyInto(sourceDir, solution.dir, p.filtersFile));
    for (const f of [...p.sources.map((s) => s.file), ...p.headers]) {
      const abs = path.resolve(p.dir, f);
      if (fs.existsSync(abs)) files.push(copyInto(sourceDir, solution.dir, abs));
    }
    projectRefs.push({ name: p.name, relPath: toSlash(path.relative(solution.dir, p.file)), guid: p.guid || '00000000-0000-0000-0000-000000000000' });
  }
  if (solution.format === 'slnx') {
    fs.copyFileSync(solution.file, path.join(sourceDir, solBase + '.slnx'));
    files.push(solBase + '.slnx');
    fs.writeFileSync(path.join(sourceDir, solBase + '.sln'), sln.makeSln(projectRefs, solution.platforms, eolFor));
    files.push(solBase + '.sln');
  } else {
    fs.copyFileSync(solution.file, path.join(sourceDir, solBase + '.sln'));
    files.push(solBase + '.sln');
  }

  // 3. Release folder: the exe and a Readme.txt.
  resetDir(outRoot, releaseDir);
  fs.copyFileSync(plan.outFile, exe);
  const readmeSrc = path.join(solution.dir, 'Readme.txt');
  if (fs.existsSync(readmeSrc)) fs.copyFileSync(readmeSrc, path.join(releaseDir, 'Readme.txt'));
  else fs.writeFileSync(path.join(releaseDir, 'Readme.txt'), tpl.releaseReadme(project.name));
  fs.rmSync(path.join(outRoot, '.build'), { recursive: true, force: true });

  return { sourceDir, releaseDir, exe, files };
}

function defaultRun(compiler, args, cwd) {
  const r = cp.spawnSync(compiler, args, { cwd, encoding: 'utf8' });
  if (r.error) {
    const missing = r.error.code === 'ENOENT';
    return { status: 127, output: missing ? compiler + ' was not found. On Debian/Ubuntu: sudo apt install g++-mingw-w64-x86-64-posix' : String(r.error) };
  }
  return { status: r.status, output: (r.stdout || '') + (r.stderr || '') };
}

module.exports = { packageSubmission, folderName, safeName };
