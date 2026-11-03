'use strict';
// Turns a parsed .vcxproj into a compiler command. One command compiles every source file,
// which is plenty for the small console programs this is made for.

const path = require('path');
const { shellQuote } = require('./text');

const WARNING_FLAGS = {
  TurnOffAllWarnings: ['-w'],
  Level1: [],
  Level2: ['-Wall'],
  Level3: ['-Wall', '-Wextra'],
  Level4: ['-Wall', '-Wextra', '-Wpedantic'],
  EnableAllWarnings: ['-Wall', '-Wextra', '-Wpedantic']
};

const CROSS_COMPILERS = { x64: 'x86_64-w64-mingw32-g++', x86: 'i686-w64-mingw32-g++' };

/** Where Visual Studio puts the output: <solution>/x64/Debug, or <solution>/Debug for 32-bit. */
function outputDir(solutionDir, config, platform) {
  return platform === 'x86' ? path.join(solutionDir, config) : path.join(solutionDir, platform, config);
}

/** $(ProjectDir) style macros in include paths and defines. */
function expandMacros(value, ctx) {
  return value
    .replace(/\$\(ProjectDir\)/g, ctx.projectDir.replace(/\/?$/, '/'))
    .replace(/\$\(SolutionDir\)/g, ctx.solutionDir.replace(/\/?$/, '/'))
    .replace(/\$\(Configuration\)/g, ctx.config)
    .replace(/\$\(Platform\)/g, ctx.platform)
    .replace(/\\/g, '/');
}

/**
 * Works out how to build one project.
 * opts: { solutionDir, config, platform, target: 'native' | 'windows', compiler, extraFlags, cwd, outFile }
 * Returns { compiler, args, cwd, outDir, outFile, commandLine, sources }.
 */
function planBuild(project, opts) {
  const config = opts.config || 'Debug';
  const platform = opts.platform || 'x64';
  const target = opts.target || 'native';
  const solutionDir = opts.solutionDir;
  const s = project.settings;
  const ctx = { projectDir: project.dir, solutionDir, config, platform };
  const windows = target === 'windows';
  const compiler = opts.compiler || (windows ? CROSS_COMPILERS[platform] : 'g++');
  const outDir = outputDir(solutionDir, config, platform);
  const outFile = opts.outFile || path.join(outDir, project.targetName + (windows ? '.exe' : ''));

  const sources = project.sources.filter((x) => !x.excluded).map((x) => path.resolve(project.dir, x.file));
  const args = ['-std=' + s.standard, '-fdiagnostics-color=never'];
  args.push(...(WARNING_FLAGS[s.warningLevel] || WARNING_FLAGS.Level3));
  if (s.warningsAsErrors) args.push('-Werror');
  if (config === 'Debug') args.push('-g', '-O0'); else args.push('-O2');

  for (const d of s.defines) {
    if (!windows && /^(WIN32|_WINDOWS)$/.test(d)) continue; // would make portable code reach for windows.h
    args.push('-D' + d);
  }
  if (project.unicode && windows) args.push('-DUNICODE', '-D_UNICODE');
  for (const dir of s.includeDirs) {
    const abs = path.resolve(project.dir, expandMacros(dir, ctx));
    args.push('-I' + abs);
  }
  args.push('-I' + project.dir);
  if (opts.extraFlags) args.push(...opts.extraFlags);
  if (windows) args.push('-static'); // no extra DLLs to ship next to the exe
  args.push(...sources, '-o', outFile);

  const cwd = opts.cwd || solutionDir; // relative paths in the output are relative to this
  const rel = (p) => path.relative(cwd, p) || '.';
  const shown = args.map((a, i) => (sources.includes(a) ? rel(a) : a));
  const commandLine =
    'mkdir -p ' + shellQuote(rel(path.dirname(outFile))) + ' && ' + shellQuote(compiler) + ' ' + shown.map((a) => shellQuote(a)).join(' ');
  return { compiler, args, cwd, outDir, outFile, sources, commandLine, shownArgs: shown };
}

/** One entry per source file for compile_commands.json (what clangd reads for IntelliSense). */
function compileCommands(project, opts) {
  const plan = planBuild(project, opts);
  const flags = plan.args.filter((a) => !plan.sources.includes(a) && a !== '-o' && a !== plan.outFile && a !== '-static');
  const entries = plan.sources.map((file) => ({
    directory: opts.solutionDir,
    file,
    arguments: [plan.compiler, ...flags, '-c', file]
  }));
  // Headers get their commands from the nearest source file in clangd, so nothing more is needed.
  return entries;
}

module.exports = { planBuild, compileCommands, outputDir, CROSS_COMPILERS, WARNING_FLAGS };
