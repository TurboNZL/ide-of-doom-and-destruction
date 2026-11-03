'use strict';
// Text for new projects and new items. Matches what Visual Studio 2026 writes for a C++ Console App.

const { BOM, withEol } = require('./text');

const CRLF = '\r\n';

/** The .vcxproj of a Console App with Debug/Release for Win32 and x64. */
function vcxproj(name, guid) {
  const cfgs = [['Debug', 'Win32'], ['Release', 'Win32'], ['Debug', 'x64'], ['Release', 'x64']];
  const configList = cfgs.map(([c, p]) =>
    '    <ProjectConfiguration Include="' + c + '|' + p + '">\n' +
    '      <Configuration>' + c + '</Configuration>\n' +
    '      <Platform>' + p + '</Platform>\n' +
    '    </ProjectConfiguration>\n').join('');
  const configProps = cfgs.map(([c, p]) => {
    const debug = c === 'Debug';
    return '  <PropertyGroup Condition="\'$(Configuration)|$(Platform)\'==\'' + c + '|' + p + '\'" Label="Configuration">\n' +
      '    <ConfigurationType>Application</ConfigurationType>\n' +
      '    <UseDebugLibraries>' + debug + '</UseDebugLibraries>\n' +
      '    <PlatformToolset>v145</PlatformToolset>\n' +
      (debug ? '' : '    <WholeProgramOptimization>true</WholeProgramOptimization>\n') +
      '    <CharacterSet>Unicode</CharacterSet>\n' +
      '  </PropertyGroup>\n';
  }).join('');
  const sheets = cfgs.map(([c, p]) =>
    '  <ImportGroup Label="PropertySheets" Condition="\'$(Configuration)|$(Platform)\'==\'' + c + '|' + p + '\'">\n' +
    '    <Import Project="$(UserRootDir)\\Microsoft.Cpp.$(Platform).user.props" Condition="exists(\'$(UserRootDir)\\Microsoft.Cpp.$(Platform).user.props\')" Label="LocalAppDataPlatform" />\n' +
    '  </ImportGroup>\n').join('');
  const defs = cfgs.map(([c, p]) => {
    const debug = c === 'Debug';
    const defines = (p === 'Win32' ? 'WIN32;' : '') + (debug ? '_DEBUG' : 'NDEBUG') + ';_CONSOLE;%(PreprocessorDefinitions)';
    return '  <ItemDefinitionGroup Condition="\'$(Configuration)|$(Platform)\'==\'' + c + '|' + p + '\'">\n' +
      '    <ClCompile>\n' +
      '      <WarningLevel>Level3</WarningLevel>\n' +
      (debug ? '' : '      <FunctionLevelLinking>true</FunctionLevelLinking>\n      <IntrinsicFunctions>true</IntrinsicFunctions>\n') +
      '      <SDLCheck>true</SDLCheck>\n' +
      '      <PreprocessorDefinitions>' + defines + '</PreprocessorDefinitions>\n' +
      '      <ConformanceMode>true</ConformanceMode>\n' +
      '      <LanguageStandard>stdcpp20</LanguageStandard>\n' +
      '    </ClCompile>\n' +
      '    <Link>\n' +
      '      <SubSystem>Console</SubSystem>\n' +
      '      <GenerateDebugInformation>true</GenerateDebugInformation>\n' +
      '    </Link>\n' +
      '    <Manifest>\n' +
      '      <EnableSegmentHeap>true</EnableSegmentHeap>\n' +
      '    </Manifest>\n' +
      '  </ItemDefinitionGroup>\n';
  }).join('');
  return withEol(
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<Project DefaultTargets="Build" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n' +
    '  <ItemGroup Label="ProjectConfigurations">\n' + configList + '  </ItemGroup>\n' +
    '  <PropertyGroup Label="Globals">\n' +
    '    <VCProjectVersion>18.0</VCProjectVersion>\n' +
    '    <Keyword>Win32Proj</Keyword>\n' +
    '    <ProjectGuid>{' + guid.toLowerCase() + '}</ProjectGuid>\n' +
    '    <RootNamespace>' + name + '</RootNamespace>\n' +
    '    <WindowsTargetPlatformVersion>10.0</WindowsTargetPlatformVersion>\n' +
    '  </PropertyGroup>\n' +
    '  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.Default.props" />\n' +
    configProps +
    '  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.props" />\n' +
    '  <ImportGroup Label="ExtensionSettings">\n  </ImportGroup>\n' +
    '  <ImportGroup Label="Shared">\n  </ImportGroup>\n' +
    sheets +
    '  <PropertyGroup Label="UserMacros" />\n' +
    defs +
    '  <ItemGroup>\n    <ClCompile Include="' + name + '.cpp" />\n  </ItemGroup>\n' +
    '  <Import Project="$(VCTargetsPath)\\Microsoft.Cpp.targets" />\n' +
    '  <ImportGroup Label="ExtensionTargets">\n  </ImportGroup>\n' +
    '</Project>', CRLF);
}

function filters(name) {
  return BOM + withEol(
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<Project ToolsVersion="4.0" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n' +
    '  <ItemGroup>\n' +
    '    <Filter Include="Source Files">\n' +
    '      <UniqueIdentifier>{4FC737F1-C7A5-4376-A066-2A32D752A2FF}</UniqueIdentifier>\n' +
    '      <Extensions>cpp;c;cc;cxx;c++;cppm;ixx;def;odl;idl;hpj;bat;asm;asmx</Extensions>\n' +
    '    </Filter>\n' +
    '    <Filter Include="Header Files">\n' +
    '      <UniqueIdentifier>{93995380-89BD-4b04-88EB-625FBE52EBFB}</UniqueIdentifier>\n' +
    '      <Extensions>h;hh;hpp;hxx;h++;hm;inl;inc;ipp;xsd</Extensions>\n' +
    '    </Filter>\n' +
    '    <Filter Include="Resource Files">\n' +
    '      <UniqueIdentifier>{67DA6AB6-F800-4c08-8B7A-83BB121AAD01}</UniqueIdentifier>\n' +
    '      <Extensions>rc;ico;cur;bmp;dlg;rc2;rct;bin;rgs;gif;jpg;jpeg;jpe;resx;tiff;tif;png;wav;mfcribbon-ms</Extensions>\n' +
    '    </Filter>\n' +
    '  </ItemGroup>\n' +
    '  <ItemGroup>\n' +
    '    <ClCompile Include="' + name + '.cpp">\n' +
    '      <Filter>Source Files</Filter>\n' +
    '    </ClCompile>\n' +
    '  </ItemGroup>\n' +
    '</Project>', CRLF);
}

function vcxprojUser() {
  return BOM + withEol(
    '<?xml version="1.0" encoding="utf-8"?>\n' +
    '<Project ToolsVersion="Current" xmlns="http://schemas.microsoft.com/developer/msbuild/2003">\n' +
    '  <PropertyGroup />\n' +
    '</Project>', CRLF);
}

function mainCpp() {
  return withEol(
    '#include <iostream>\n\nint main()\n{\n    std::cout << "Hello World!\\n";\n}\n', CRLF);
}

function classHeader(name) {
  return withEol('#pragma once\n\nclass ' + name + '\n{\npublic:\n    ' + name + '();\n    ~' + name + '();\n};\n', CRLF);
}

function classSource(name) {
  return withEol('#include "' + name + '.h"\n\n' + name + '::' + name + '()\n{\n}\n\n' + name + '::~' + name + '()\n{\n}\n', CRLF);
}

function emptyHeader() {
  return withEol('#pragma once\n', CRLF);
}

function emptySource(name) {
  return withEol('#include "' + name + '.h"\n', CRLF);
}

function gitignore() {
  return withEol(
    '# Visual Studio and build output\n.vs/\nx64/\nx86/\nDebug/\nRelease/\n*.obj\n*.ilk\n*.pdb\n*.idb\n*.tlog\n*.log\n' +
    '\n# Packaged submissions\nSubmission/\n', '\n');
}

function gitattributes() {
  return '* text=auto\n*.sln text eol=crlf\n*.slnx text eol=crlf\n*.vcxproj text eol=crlf\n*.filters text eol=crlf\n*.user text eol=crlf\n';
}

/** A starting Readme.txt for a release folder. `title` is the program's name. */
function releaseReadme(title) {
  return withEol(
    title + '\n' + '='.repeat(title.length) + '\n\n' +
    'Version: 1.0\n\n' +
    'How to run\n----------\nDouble-click ' + title + '.exe. It opens in a console window.\n\n' +
    'Controls\n--------\nDescribe the controls and menu options here.\n\n' +
    'Notes\n-----\nAnything the person running the program needs to know.\n', '\r\n');
}

module.exports = { vcxproj, filters, vcxprojUser, mainCpp, classHeader, classSource, emptyHeader, emptySource, gitignore, gitattributes, releaseReadme };
