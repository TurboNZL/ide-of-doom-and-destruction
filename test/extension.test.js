'use strict';
// Loads extension.js against a stand-in for the "vscode" module and checks that it starts and
// registers everything package.json promises. (The real editor is not started here.)
const test = require('node:test');
const assert = require('node:assert');
const Module = require('module');
const path = require('path');

function fakeVscode(registered) {
  const noop = () => {};
  const disposable = { dispose: noop };
  const emitter = class { constructor() { this.event = () => disposable; } fire() {} };
  return {
    commands: { registerCommand: (id) => { registered.push(id); return disposable; }, executeCommand: async () => {} },
    window: {
      createStatusBarItem: () => ({ show: noop, hide: noop, dispose: noop }),
      registerTreeDataProvider: () => disposable,
      createOutputChannel: () => ({ appendLine: noop })
    },
    workspace: {
      workspaceFolders: undefined,
      getConfiguration: () => ({ get: () => undefined, inspect: () => undefined, update: async () => {} }),
      createFileSystemWatcher: () => ({ onDidChange: noop, onDidCreate: noop, onDidDelete: noop, dispose: noop }),
      onDidChangeWorkspaceFolders: () => disposable
    },
    StatusBarAlignment: { Left: 1 },
    EventEmitter: emitter,
    TreeItem: class { constructor(label) { this.label = label; } },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class {},
    ConfigurationTarget: { Global: 1 },
    Uri: { file: (f) => ({ fsPath: f }), parse: (s) => s }
  };
}

test('the extension activates and registers every command it declares', () => {
  const registered = [];
  const fake = fakeVscode(registered);
  const origLoad = Module._load;
  Module._load = function (request, ...rest) {
    return request === 'vscode' ? fake : origLoad.call(this, request, ...rest);
  };
  try {
    const ext = require('../extension/extension.js');
    const ctx = {
      subscriptions: [], extensionPath: path.join(__dirname, '..', 'extension'),
      workspaceState: { get: () => undefined, update: async () => {} },
      globalState: { get: () => Date.now(), update: async () => {} },
      extension: { packageJSON: { version: '1.0.0' } }
    };
    ext.activate(ctx);
    const declared = require('../extension/package.json').contributes.commands.map((c) => c.command).sort();
    assert.deepStrictEqual(registered.sort(), declared);
  } finally {
    Module._load = origLoad;
  }
});

test('every command used by a keybinding or menu is declared', () => {
  const pkg = require('../extension/package.json');
  const declared = new Set(pkg.contributes.commands.map((c) => c.command));
  const used = [
    ...pkg.contributes.keybindings.map((k) => k.command),
    ...Object.values(pkg.contributes.menus).flat().map((m) => m.command)
  ].filter((c) => c.startsWith('vsproj.'));
  for (const c of used) assert.ok(declared.has(c), c + ' is not declared');
});
