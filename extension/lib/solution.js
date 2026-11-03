'use strict';
// Finds and reads Visual Studio solutions: the new .slnx format and the classic .sln.
// Also writes a classic .sln from a .slnx for places that still expect one.

const fs = require('fs');
const path = require('path');
const { splitBom, toSlash, toBackslash, withEol } = require('./text');

const CPP_PROJECT_TYPE = '8BC9CEB8-8B4A-11D0-9F6B-00AA00A5C5B9';

/** Looks for a solution in `dir`, then one level down. Returns its path or null. .slnx wins over .sln. */
function findSolutionFile(dir) {
  const inDir = (d) => {
    let names;
    try { names = fs.readdirSync(d); } catch (e) { return null; }
    return names.find((n) => /\.slnx$/i.test(n)) || names.find((n) => /\.sln$/i.test(n)) || null;
  };
  const here = inDir(dir);
  if (here) return path.join(dir, here);
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return null; }
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith('.') || e.name === 'node_modules') continue;
    const sub = inDir(path.join(dir, e.name));
    if (sub) return path.join(dir, e.name, sub);
  }
  return null;
}

/** Reads a solution file: { file, dir, format, platforms, projects: [absolute .vcxproj paths] }. */
function readSolution(file) {
  const text = splitBom(fs.readFileSync(file, 'utf8')).body;
  const dir = path.dirname(file);
  const format = /\.slnx$/i.test(file) ? 'slnx' : 'sln';
  const projects = [];
  const platforms = [];
  if (format === 'slnx') {
    for (const m of text.matchAll(/<Project\s+[^>]*?Path="([^"]+)"/g)) projects.push(m[1]);
    for (const m of text.matchAll(/<Platform\s+Name="([^"]+)"/g)) platforms.push(m[1]);
  } else {
    for (const m of text.matchAll(/^Project\("\{[^}]+\}"\)\s*=\s*"[^"]*",\s*"([^"]+)"/gm)) projects.push(m[1]);
    for (const m of text.matchAll(/^\s*[A-Za-z]+\|([A-Za-z0-9]+)\s*=/gm)) if (!platforms.includes(m[1])) platforms.push(m[1]);
  }
  return {
    file,
    dir,
    format,
    platforms: platforms.length ? platforms : ['x64', 'x86'],
    projects: projects.map((p) => path.resolve(dir, toSlash(p))).filter((p) => /\.vcxproj$/i.test(p))
  };
}

/** The text of a new .slnx holding one project. */
function makeSlnx(projectRelPath, guid, eol = '\r\n') {
  return withEol(
    '<Solution>\n' +
    '  <Configurations>\n' +
    '    <Platform Name="x64" />\n' +
    '    <Platform Name="x86" />\n' +
    '  </Configurations>\n' +
    '  <Project Path="' + toSlash(projectRelPath) + '" Id="' + guid.toLowerCase() + '" />\n' +
    '</Solution>\n', eol);
}

/**
 * A classic .sln for the given projects ({ name, relPath, guid }). Platforms are the solution's
 * names ("x64", "x86"); the project side calls 32-bit "Win32".
 */
function makeSln(projects, platforms = ['x64', 'x86'], eol = '\r\n') {
  const configs = ['Debug', 'Release'];
  const out = [];
  out.push('', 'Microsoft Visual Studio Solution File, Format Version 12.00', '# Visual Studio Version 18',
    'VisualStudioVersion = 18.0.0.0', 'MinimumVisualStudioVersion = 10.0.40219.1');
  for (const p of projects) {
    out.push('Project("{' + CPP_PROJECT_TYPE + '}") = "' + p.name + '", "' + toBackslash(p.relPath) + '", "{' + p.guid.toUpperCase() + '}"', 'EndProject');
  }
  out.push('Global', '\tGlobalSection(SolutionConfigurationPlatforms) = preSolution');
  for (const c of configs) for (const pl of platforms) out.push('\t\t' + c + '|' + pl + ' = ' + c + '|' + pl);
  out.push('\tEndGlobalSection', '\tGlobalSection(ProjectConfigurationPlatforms) = postSolution');
  for (const p of projects) {
    for (const c of configs) {
      for (const pl of platforms) {
        const target = pl === 'x86' ? 'Win32' : pl;
        const g = '{' + p.guid.toUpperCase() + '}';
        out.push('\t\t' + g + '.' + c + '|' + pl + '.ActiveCfg = ' + c + '|' + target,
          '\t\t' + g + '.' + c + '|' + pl + '.Build.0 = ' + c + '|' + target);
      }
    }
  }
  out.push('\tEndGlobalSection', '\tGlobalSection(SolutionProperties) = preSolution', '\t\tHideSolutionNode = FALSE',
    '\tEndGlobalSection', 'EndGlobal', '');
  return out.join(eol);
}

module.exports = { findSolutionFile, readSolution, makeSlnx, makeSln, CPP_PROJECT_TYPE };
