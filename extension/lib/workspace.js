'use strict';
// The things the editor does to solutions on disk: create a project, add and remove files,
// write IntelliSense data. No VS Code API in here, so it can be tested on its own.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { detectEol, withEol, splitBom, toSlash } = require('./text');
const vcx = require('./vcxproj');
const sln = require('./solution');
const tpl = require('./templates');
const { compileCommands } = require('./build');

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function isValidIdentifier(name) {
  return NAME_RE.test(name) && !['class', 'struct', 'int', 'main'].includes(name);
}

function isValidProjectName(name) {
  return /^[A-Za-z_][A-Za-z0-9_ -]*$/.test(name) && !/[ -]$/.test(name);
}

function readText(file) {
  return fs.readFileSync(file, 'utf8');
}

/** Loads the solution in `dir` (or one level below it) with every project parsed. Null when there is none. */
function loadSolution(dir, config = 'Debug', platform = 'x64') {
  const file = sln.findSolutionFile(dir);
  if (!file) return null;
  const solution = sln.readSolution(file);
  const projects = [];
  for (const p of solution.projects) {
    if (!fs.existsSync(p)) continue;
    projects.push(loadProject(p, config, platform));
  }
  return { ...solution, projects };
}

function loadProject(file, config = 'Debug', platform = 'x64') {
  const text = readText(file);
  const project = vcx.parseProject(text, file, config, platform);
  const filtersFile = file + '.filters';
  project.filtersFile = fs.existsSync(filtersFile) ? filtersFile : null;
  project.filters = project.filtersFile ? vcx.parseFilters(readText(filtersFile)) : { names: [], files: {} };
  return project;
}

/** Creates <location>/<name>/ with a solution, a Console App project and a main file. Returns the solution path. */
function createProject({ location, name, solutionFormat = 'slnx' }) {
  if (!isValidProjectName(name)) throw new Error('"' + name + '" is not a usable project name. Use letters, digits, _ and -.');
  const root = path.join(location, name);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error(root + ' already exists and is not empty.');
  const projDir = path.join(root, name);
  fs.mkdirSync(projDir, { recursive: true });
  const guid = crypto.randomUUID();
  fs.writeFileSync(path.join(projDir, name + '.vcxproj'), tpl.vcxproj(name.replace(/[ -]/g, '_'), guid));
  fs.writeFileSync(path.join(projDir, name + '.vcxproj.filters'), tpl.filters(name.replace(/[ -]/g, '_')));
  fs.writeFileSync(path.join(projDir, name + '.vcxproj.user'), tpl.vcxprojUser());
  fs.writeFileSync(path.join(projDir, name.replace(/[ -]/g, '_') + '.cpp'), tpl.mainCpp());
  const rel = name + '/' + name + '.vcxproj';
  let solutionFile;
  if (solutionFormat === 'sln') {
    solutionFile = path.join(root, name + '.sln');
    fs.writeFileSync(solutionFile, sln.makeSln([{ name, relPath: rel, guid }]));
  } else {
    solutionFile = path.join(root, name + '.slnx');
    fs.writeFileSync(solutionFile, sln.makeSlnx(rel, guid));
  }
  fs.writeFileSync(path.join(root, '.gitignore'), tpl.gitignore());
  fs.writeFileSync(path.join(root, '.gitattributes'), tpl.gitattributes());
  return solutionFile;
}

/** Reads a file, changes it, and writes it back with its byte order mark and line endings untouched. */
function editFile(file, change) {
  const raw = readText(file);
  const { bom, body } = splitBom(raw);
  const out = change(body);
  if (out !== body) fs.writeFileSync(file, bom + out);
}

/** Adds an existing file (absolute path, inside the project folder) to the project and its filters. */
function addFile(project, absFile) {
  const rel = toSlash(path.relative(project.dir, absFile));
  if (rel.startsWith('..')) throw new Error('The file must be inside the project folder (' + project.dir + ').');
  editFile(project.file, (t) => vcx.addFileToProject(t, rel));
  if (project.filtersFile) editFile(project.filtersFile, (t) => vcx.addFileToFilters(t, rel));
  return rel;
}

/** Removes a file from the project (and optionally deletes it). `rel` is relative to the project folder. */
function removeFile(project, rel, deleteFromDisk = false) {
  editFile(project.file, (t) => vcx.removeFileFromProject(t, rel));
  if (project.filtersFile) editFile(project.filtersFile, (t) => vcx.removeFileFromFilters(t, rel));
  if (deleteFromDisk) fs.rmSync(path.resolve(project.dir, rel), { force: true });
}

function writeNew(project, fileName, content) {
  const abs = path.join(project.dir, fileName);
  if (fs.existsSync(abs)) throw new Error(fileName + ' already exists.');
  const eol = detectEol(readText(project.file));
  fs.writeFileSync(abs, withEol(content, eol));
  addFile(project, abs);
  return abs;
}

/** Visual Studio's "Add > Class": NAME.h and NAME.cpp with a constructor and destructor. Returns both paths. */
function addClass(project, name) {
  if (!isValidIdentifier(name)) throw new Error('"' + name + '" is not a valid class name.');
  for (const f of [name + '.h', name + '.cpp']) {
    if (fs.existsSync(path.join(project.dir, f))) throw new Error(f + ' already exists.');
  }
  return { header: writeNew(project, name + '.h', tpl.classHeader(name)), source: writeNew(project, name + '.cpp', tpl.classSource(name)) };
}

/** "Add > New Item": an empty header or source file. kind is 'header' or 'source'. */
function addItem(project, kind, name) {
  if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name)) throw new Error('"' + name + '" is not a usable file name.');
  const stem = name.replace(/\.(h|hpp|cpp|c)$/i, '');
  if (kind === 'header') return writeNew(project, stem + (/\.hpp$/i.test(name) ? '.hpp' : '.h'), tpl.emptyHeader());
  return writeNew(project, stem + '.cpp', tpl.emptySource(stem));
}

/** C++ files that sit in the project folder but are not listed in the project. Relative to the project folder. */
function untrackedFiles(project) {
  const listed = new Set([...project.sources.map((s) => s.file), ...project.headers].map((f) => toSlash(f).toLowerCase()));
  const found = [];
  const skip = new Set(['.vs', 'x64', 'x86', 'debug', 'release', 'node_modules', '.git', 'submission']);
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || skip.has(e.name.toLowerCase())) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (vcx.itemKind(e.name)) {
        const rel = toSlash(path.relative(project.dir, abs));
        if (!listed.has(rel.toLowerCase())) found.push(rel);
      }
    }
  };
  walk(project.dir);
  return found;
}

/** Writes <solution>/.vs/compile_commands.json for IntelliSense. Returns its path. */
function writeCompileCommands(solution, opts) {
  const all = [];
  for (const p of solution.projects) all.push(...compileCommands(p, { ...opts, solutionDir: solution.dir }));
  const dir = path.join(solution.dir, '.vs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'compile_commands.json');
  const text = JSON.stringify(all, null, 2);
  if (!fs.existsSync(file) || readText(file) !== text) fs.writeFileSync(file, text);
  return file;
}

module.exports = {
  isValidIdentifier, isValidProjectName, loadSolution, loadProject, createProject, addFile, removeFile, addClass, addItem,
  untrackedFiles, writeCompileCommands
};
