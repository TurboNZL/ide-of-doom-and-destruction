# ide-of-doom-and-destruction: project handoff

Read this first. It is the running state and decision log: update it whenever a decision or the state changes.

## Engine
Pinned to TurboNZL/turboengine (see `.turboengine.json`). The engine is a **reference, not a dependency**. Only `release-pipeline` is used here: `auto-pr.yml` is copied as is; `release.yml` keeps its version scheme (`vYYYY.M.N`) and release-first job order but builds a `.vsix` and a `.tar.gz` instead of installers.

## What it is
A portable VS Code (downloaded by `bin/ide setup` into `./vscode`, portable via `vscode/data`) plus one extension (`extension/`) that treats a Visual Studio C++ solution as the project format: new Console App, Add Class / New Item, Solution Explorer, build, run, package a submission. No separate project format, no conversion step.

## Decisions made (don't re-ask)
| Topic | Decision |
|---|---|
| Project format | The `.vcxproj` is the source of truth; files are edited as text with small insertions so BOM, line endings and everything else stay byte-identical (tested). |
| Compiler | GCC/Clang on this machine for build and run; mingw-w64 (`-static`) for the Windows `.exe` in Package for Submission. |
| Debugger | None, on purpose. Build, run, Problems panel. |
| IntelliSense | clangd, reading `<solution>/.vs/compile_commands.json` (`.vs/` is already ignored by Visual Studio's `.gitignore`). Never write tool files into the user's repo. |
| Isolation | Never touch the user's normal VS Code. Portable mode only; keybindings, menus and defaults come from the extension (so an update replaces them), `config/settings.json` is copied only if absent. |
| Public repo hygiene | The repo is public and names nobody but the owner (TurboNZL). No personal, institutional or project-specific text in the code, docs or tests (tests build their own sample project). Anything that varies per user, such as submission folder names, is a setting with a neutral default. |
| Dependencies | None at runtime (the `.vsix` is packed by `scripts/pack-vsix.js`; no `vsce`). |

## Repo layout
- `bin/ide`: launcher (`setup`, `update`, open a folder).
- `extension/lib/`: all logic, no VS Code API (`vcxproj` edit/parse, `solution`, `templates`, `build`, `workspace`, `submission`, `zip`).
- `extension/extension.js`: commands, tree view, tasks, status bar.
- `extension/shims/`: `cls`, `pause`, `color` for programs that call `system(...)`.
- `scripts/`: `pack-vsix.js`, `make-sample.js` (CI).
- `test/`: `npm test`.
- `.github/workflows/`: `auto-pr`, `check` (tests + MSBuild on Windows), `release`.

## What exists and is tested
Everything under `extension/lib/`, the launcher (against a stand-in editor), the `.vsix` layout, extension start-up against a stand-in `vscode` module, and a real mingw cross-compile whose `.exe` ran under wine.

## Not tested (no real editor available when this was written)
The VS Code UI itself: tree view rendering, the task/problem-matcher wiring, keybinding precedence over built-ins, the clangd settings write, the real VS Code download. First thing to do with a real editor: run `ide setup`, open a project, press F5, break the code on purpose and check the Problems panel.

## Hard-won gotchas
- Node 22 `node --test` does not take a bare directory; the test script uses a glob.
- A `.vsix` entry loses its executable bit unless the zip records a Unix mode (`zip.js` does); the extension also `chmod`s the shims before use.
- MSBuild builds of a `.vcxproj` alone (not through the solution) put output under the project folder, not `$(SolutionDir)`.

## Session log
- First version: all of the above.
