'use strict';
// Reads and edits Visual C++ project files (.vcxproj) and their .filters file as text.
// Edits are small insertions and removals, so everything else in the file (comments,
// property sheets, line endings, byte order mark) is left exactly as it was.

const path = require('path');
const { detectEol, splitBom, xmlEscape, xmlUnescape, toSlash, toBackslash } = require('./text');

const COMPILE_EXT = ['.cpp', '.c', '.cc', '.cxx'];
const HEADER_EXT = ['.h', '.hpp', '.hh', '.hxx', '.inl'];

// What MSVC's /std setting means for GCC/Clang. MSVC's own default is C++14.
const STANDARDS = { stdcpp14: 'c++14', stdcpp17: 'c++17', stdcpp20: 'c++20', stdcpp23: 'c++23', stdcpplatest: 'c++23' };

const FILTER_IDS = {
  'Source Files': { id: '{4FC737F1-C7A5-4376-A066-2A32D752A2FF}', ext: 'cpp;c;cc;cxx;c++;cppm;ixx;def;odl;idl;hpj;bat;asm;asmx' },
  'Header Files': { id: '{93995380-89BD-4b04-88EB-625FBE52EBFB}', ext: 'h;hh;hpp;hxx;h++;hm;inl;inc;ipp;xsd' },
  'Resource Files': { id: '{67DA6AB6-F800-4c08-8B7A-83BB121AAD01}', ext: 'rc;ico;cur;bmp;dlg;rc2;rct;bin;rgs;gif;jpg;jpeg;jpe;resx;tiff;tif;png;wav;mfcribbon-ms' }
};

/** "ClCompile" for source files, "ClInclude" for headers, null for anything else. */
function itemKind(file) {
  const ext = path.extname(file).toLowerCase();
  if (COMPILE_EXT.includes(ext)) return 'ClCompile';
  if (HEADER_EXT.includes(ext)) return 'ClInclude';
  return null;
}

function filterNameFor(kind) {
  return kind === 'ClCompile' ? 'Source Files' : 'Header Files';
}

/** Finds every <TAG Include="..."> element: its text range and the Include value. */
function findItems(text, tag) {
  const re = new RegExp('<' + tag + '\\s+Include="([^"]*)"\\s*(?:/>|>[\\s\\S]*?</' + tag + '>)', 'g');
  const items = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    items.push({ include: toSlash(xmlUnescape(m[1])), start: m.index, end: m.index + m[0].length, text: m[0] });
  }
  return items;
}

/** Value of the first <name>..</name> inside `block`, or undefined. */
function tagValue(block, name) {
  const m = new RegExp('<' + name + '>([^<]*)</' + name + '>').exec(block);
  return m ? xmlUnescape(m[1].trim()) : undefined;
}

/** All blocks <tag Condition="...">...</tag> with their condition text ('' when unconditional). */
function conditionBlocks(text, tag) {
  const re = new RegExp('<' + tag + '((?:\\s+[A-Za-z]+="[^"]*")*)\\s*>([\\s\\S]*?)</' + tag + '>', 'g');
  const blocks = [];
  let m;
  while ((m = re.exec(text)) !== null) {
    const cond = /Condition="([^"]*)"/.exec(m[1]);
    const label = /Label="([^"]*)"/.exec(m[1]);
    blocks.push({ condition: cond ? xmlUnescape(cond[1]) : '', label: label ? label[1] : '', body: m[2] });
  }
  return blocks;
}

/** True when a Condition such as '$(Configuration)|$(Platform)'=='Debug|x64' applies. */
function conditionApplies(condition, config, platform) {
  if (!condition) return true;
  const m = /'\$\(Configuration\)\|\$\(Platform\)'\s*==\s*'([^']*)'/.exec(condition);
  if (m) return m[1] === config + '|' + platform;
  const c = /'\$\(Configuration\)'\s*==\s*'([^']*)'/.exec(condition);
  if (c) return c[1] === config;
  const p = /'\$\(Platform\)'\s*==\s*'([^']*)'/.exec(condition);
  if (p) return p[1] === platform;
  return true;
}

/** Visual Studio calls the 32-bit platform "Win32" in C++ projects and "x86" in the solution. */
function projectPlatform(platform) {
  return platform === 'x86' ? 'Win32' : platform;
}

/**
 * Reads a project file. `file` is its path, used for the default project name.
 * Returns the sources, headers and the settings for one configuration.
 */
function parseProject(text, file, config = 'Debug', platform = 'x64') {
  const { body } = splitBom(text);
  const plat = projectPlatform(platform);
  const sources = findItems(body, 'ClCompile').map((i) => ({
    file: i.include,
    excluded: /<ExcludedFromBuild[^>]*>\s*true\s*</.test(i.text)
  }));
  const headers = findItems(body, 'ClInclude').map((i) => i.include);

  const flat = {}; // later settings override earlier ones, like MSBuild
  const apply = (block, tag) => {
    for (const name of ['WarningLevel', 'PreprocessorDefinitions', 'LanguageStandard', 'AdditionalIncludeDirectories',
      'TreatWarningAsError', 'ConformanceMode', 'AdditionalOptions']) {
      const m = new RegExp('<' + tag + '>([\\s\\S]*?)</' + tag + '>').exec(block);
      if (!m) return;
      const v = tagValue(m[1], name);
      if (v !== undefined) flat[name] = v;
    }
  };
  for (const b of conditionBlocks(body, 'ItemDefinitionGroup')) {
    if (conditionApplies(b.condition, config, plat)) apply(b.body, 'ClCompile');
  }

  const props = {};
  for (const b of conditionBlocks(body, 'PropertyGroup')) {
    if (!conditionApplies(b.condition, config, plat)) continue;
    for (const name of ['ConfigurationType', 'PlatformToolset', 'CharacterSet', 'TargetName', 'ProjectName', 'RootNamespace',
      'ProjectGuid', 'OutDir', 'UseDebugLibraries']) {
      const v = tagValue(b.body, name);
      if (v !== undefined) props[name] = v;
    }
  }

  let subSystem;
  for (const b of conditionBlocks(body, 'ItemDefinitionGroup')) {
    if (!conditionApplies(b.condition, config, plat)) continue;
    const link = /<Link>([\s\S]*?)<\/Link>/.exec(b.body);
    if (link) subSystem = tagValue(link[1], 'SubSystem') || subSystem;
  }

  const configs = [];
  const re = /<ProjectConfiguration\s+Include="([^"|]+)\|([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) configs.push({ config: m[1], platform: m[2] });

  const baseName = path.basename(file, path.extname(file));
  return {
    file,
    dir: path.dirname(file),
    name: props.ProjectName || baseName,
    targetName: props.TargetName || props.ProjectName || baseName,
    guid: props.ProjectGuid ? props.ProjectGuid.replace(/[{}]/g, '') : '',
    configurationType: props.ConfigurationType || 'Application',
    toolset: props.PlatformToolset || '',
    unicode: (props.CharacterSet || '') === 'Unicode',
    subSystem: subSystem || 'Console',
    configs,
    sources,
    headers,
    settings: {
      warningLevel: flat.WarningLevel || 'Level3',
      defines: splitList(flat.PreprocessorDefinitions),
      standard: STANDARDS[flat.LanguageStandard] || 'c++14',
      includeDirs: splitList(flat.AdditionalIncludeDirectories),
      warningsAsErrors: /^true$/i.test(flat.TreatWarningAsError || ''),
      additionalOptions: flat.AdditionalOptions || ''
    }
  };
}

function splitList(value) {
  if (!value) return [];
  return value.split(';').map((s) => s.trim()).filter((s) => s && !s.startsWith('%('));
}

// ---------------------------------------------------------------------------------------
// Editing

function lineIndent(text, pos) {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const m = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return m ? m[0] : '';
}

/** Compares names the way an explorer would: case-insensitive, then plain. */
function compareNames(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? -1 : x > y ? 1 : a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Adds `<tag Include="include">inner</tag>` to the item group that already holds `tag` items,
 * keeping the group alphabetical. Creates a group before the Microsoft.Cpp.targets import when
 * there is none. `inner` is XML for the child elements, or null for a self-closing element.
 */
function insertItem(text, tag, include, inner) {
  const eol = detectEol(text);
  const items = findItems(text, tag);
  const inc = xmlEscape(toBackslash(include));
  if (items.some((i) => i.include === toSlash(include))) return text; // already there

  const make = (indent) => {
    if (inner === null) return indent + '<' + tag + ' Include="' + inc + '" />';
    const child = indent + '  ';
    return indent + '<' + tag + ' Include="' + inc + '">' + eol + child + inner + eol + indent + '</' + tag + '>';
  };

  if (items.length) {
    const indent = lineIndent(text, items[0].start);
    const after = items.find((i) => compareNames(i.include, toSlash(include)) > 0);
    if (after) {
      const lineStart = text.lastIndexOf('\n', after.start - 1) + 1;
      return text.slice(0, lineStart) + make(indent) + eol + text.slice(lineStart);
    }
    const last = items[items.length - 1];
    return text.slice(0, last.end) + eol + make(indent) + text.slice(last.end);
  }

  const group = '  <ItemGroup>' + eol + make('    ') + eol + '  </ItemGroup>' + eol;
  const anchors = [/^[ \t]*<Import Project="\$\(VCTargetsPath\)\\Microsoft\.Cpp\.targets"/m, /^[ \t]*<\/Project>/m];
  for (const a of anchors) {
    const m = a.exec(text);
    if (m) return text.slice(0, m.index) + group + text.slice(m.index);
  }
  return text + group;
}

/** Removes `<tag Include="include">` and the line it sat on; drops an item group left empty. */
function removeItem(text, tag, include) {
  const target = toSlash(include);
  const item = findItems(text, tag).find((i) => i.include === target);
  if (!item) return text;
  let start = text.lastIndexOf('\n', item.start - 1) + 1;
  let end = item.end;
  if (text.slice(start, item.start).trim() !== '') start = item.start;
  const nl = /^[ \t]*\r?\n/.exec(text.slice(end));
  if (nl) end += nl[0].length;
  let result = text.slice(0, start) + text.slice(end);
  result = result.replace(/^[ \t]*<ItemGroup>\s*<\/ItemGroup>[ \t]*\r?\n/gm, '');
  return result;
}

/** Adds a file to the project text. Returns the new text (unchanged when it is already listed). */
function addFileToProject(text, relPath) {
  const kind = itemKind(relPath);
  if (!kind) throw new Error('Only C++ source and header files can be added to the project: ' + relPath);
  return insertItem(text, kind, relPath, null);
}

function removeFileFromProject(text, relPath) {
  let t = text;
  for (const tag of ['ClCompile', 'ClInclude']) t = removeItem(t, tag, relPath);
  return t;
}

/** Adds a file to the filters text under "Source Files" or "Header Files", defining the filter if needed. */
function addFileToFilters(text, relPath) {
  const kind = itemKind(relPath);
  if (!kind) throw new Error('Only C++ source and header files can be added to the project: ' + relPath);
  const filter = filterNameFor(kind);
  let t = ensureFilter(text, filter);
  t = insertItem(t, kind, relPath, '<Filter>' + filter + '</Filter>');
  return t;
}

function removeFileFromFilters(text, relPath) {
  return removeFileFromProject(text, relPath);
}

function ensureFilter(text, name) {
  if (new RegExp('<Filter\\s+Include="' + name + '"').test(text)) return text;
  const eol = detectEol(text);
  const def = FILTER_IDS[name];
  const entry = '    <Filter Include="' + name + '">' + eol +
    '      <UniqueIdentifier>' + def.id + '</UniqueIdentifier>' + eol +
    '      <Extensions>' + def.ext + '</Extensions>' + eol +
    '    </Filter>' + eol;
  const closing = /^[ \t]*<\/ItemGroup>/m;
  const firstGroup = /<ItemGroup>\s*<Filter\s/.exec(text);
  if (firstGroup) {
    const end = text.indexOf('</ItemGroup>', firstGroup.index);
    const lineStart = text.lastIndexOf('\n', end - 1) + 1;
    return text.slice(0, lineStart) + entry + text.slice(lineStart);
  }
  const group = '  <ItemGroup>' + eol + entry + '  </ItemGroup>' + eol;
  const m = /^[ \t]*<\/Project>/m.exec(text) || closing.exec(text);
  return m ? text.slice(0, m.index) + group + text.slice(m.index) : text + group;
}

/** The filter each file sits under: { 'Player.cpp': 'Source Files', ... } and the filter names in order. */
function parseFilters(text) {
  const { body } = splitBom(text);
  const names = [];
  const re = /<Filter\s+Include="([^"]+)"/g;
  let m;
  while ((m = re.exec(body)) !== null) names.push(xmlUnescape(m[1]));
  const files = {};
  for (const tag of ['ClCompile', 'ClInclude', 'None', 'ResourceCompile', 'Image']) {
    for (const item of findItems(body, tag)) {
      const f = tagValue(item.text, 'Filter');
      if (f) files[item.include] = f;
    }
  }
  return { names, files };
}

module.exports = {
  COMPILE_EXT, HEADER_EXT, STANDARDS, itemKind, filterNameFor, findItems, parseProject, projectPlatform,
  addFileToProject, removeFileFromProject, addFileToFilters, removeFileFromFilters, parseFilters, compareNames
};
