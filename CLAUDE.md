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
| Packaging | One architecture-independent `.deb` (`scripts/build-deb.sh`, `packaging/`): the tool in `/opt/ide-of-doom-and-destruction`, `/usr/bin/ide`, a menu entry. It never ships VS Code; the editor is downloaded per user into `~/.local/share/ide-of-doom-and-destruction/` (read-only `/opt` selects that path in `bin/ide`). After a package update `bin/ide` reinstalls the extension when `data/.extension-version` differs from the package's version. |
| Updates | The engine's `updaters` rules, ported to `extension/lib/debInstall.js` + `updater.js` (find newest release incl. pre-releases, skip drafts; download; pkexec, then sudo terminal, `systemd-run --user` when `NoNewPrivs`; success only when `dpkg-query` shows the new version; always show the copyable command). The window is a webview panel (`extension/updateWindow.js`), not Electron, so there is no `latest-linux.yml`: the release's `.deb` asset is the manifest, and "release exists, `.deb` not attached yet" is the still-being-built state. |
| GitHub | VS Code's built-in Git and GitHub authentication, configured in `config/settings.json`, plus the Pull Requests extension and a `vsproj.signInGitHub` command. New projects get `git init -b main`. No tokens are stored by this tool. Git scanning is kept narrow (no parent-folder search, depth 1, no autofetch), and a start-menu launch opens an empty window, never the home folder. |
| No CLI for users | Everything a user does is reachable without a terminal: the menu entry (`bin/ide-desktop`, first-run progress window via `zenity`, `kdialog` popup fallback), the start page, the bottom-left **IDE of Doom** menu, Run/Build buttons in the editor title and status bar. Custom commands are all in the palette category **IDE of Doom** so they are recognisable. `bin/ide` stays as the script behind them. |
| Release file names | No version in the file names (`ide-of-doom-and-destruction.deb/.vsix/.tar.gz`): each release is its own page and `/releases/latest/download/<name>` keeps working. The updater picks any `.deb` asset. |
| App identity | Name "IDE of Doom and Destruction"; the editor is launched with `--class=ide-of-doom-and-destruction` and the desktop entry has the matching `StartupWMClass`, so the window groups under our entry instead of turning into plain VS Code. `window.restoreWindows` is `none` so a launch never reopens a previously opened home folder. |
| Running programs | In a separate terminal window, found by `extension/lib/terminal.js` (setting, `$TERMINAL`, KDE's configured terminal, then a list), because the target distros vary (Debian family and Arch family). `vsproj.runIn` can switch to the editor's terminal. Windows `.exe`s run under Wine in `<data dir>/wine-prefix` (`IDE_DATA_DIR`, exported by the launcher), never `~/.wine`. |
| Branding the editor | `scripts/brand-editor.js` edits only the private downloaded copy (`desktopName`, `nameShort/nameLong`, window icon; originals kept as `*.orig`), once per download (`data/.branded`). Do not do this to a user's normal VS Code. |
| Other distros | No package yet: the release tarball + `ide setup` (which also runs `ide integrate` for the menu entry). The Updates window updates such copies in place by running `IDE_BIN update`. |
| Windows | Per-user installer `ide-of-doom-and-destruction-setup.exe` (NSIS, `packaging/windows-installer.nsi`, `scripts/build-windows-installer.sh`, built on Linux by `makensis`; into `%LOCALAPPDATA%\Programs`, no admin, unsigned, uninstaller removes everything incl. the editor data; its last step runs `ide.ps1 setup`) (the zip was dropped; `scripts/stage-windows.js` lists the files the installer packs): `bin/ide.cmd` -> `bin/ide.ps1` (plain ASCII, PowerShell 5 compatible; uses the built-in `curl.exe`/`tar.exe`). Downloads portable VS Code win32-x64 and WinLibs MinGW-w64 (`g++`) into the data folder (`IDE_DATA_DIR`, `mingw64/`). Build tasks run in `cmd.exe` (`planBuild` with `shell: 'cmd'`), runs open a console window via a `run.cmd` (`extension/lib/windows.js`); Wine commands hidden (`!isWindows`). `config/settings.windows.json` is `settings.json` plus clangd `--query-driver`. Editor icon: `Set-Branding` in `ide.ps1` downloads rcedit (best effort, `IDE_RCEDIT_URL`) and replaces the icon of the private `Code.exe` once (`data/.branded`). The Start menu entry is `wscript bin/ide.vbs` so no console is ever tied to the editor. Updates run `ide.cmd update`, which downloads and silently runs the newest setup.exe over the install (`/S /D=<root>`; a git clone does `git pull`). |
| Dependencies | None at runtime (the `.vsix` is packed by `scripts/pack-vsix.js`; no `vsce`). |

## Repo layout
- `bin/ide`: launcher (`setup`, `update`, open a folder).
- `extension/lib/`: all logic, no VS Code API (`vcxproj` edit/parse, `solution`, `templates`, `build`, `workspace`, `submission`, `zip`).
- `extension/extension.js`: commands, tree view, tasks, status bar.
- `extension/shims/`: `cls`, `pause`, `color` for programs that call `system(...)`.
- `scripts/`: `pack-vsix.js`, `make-sample.js` (CI).
- `test/`: `npm test`.
- `extension/updateWindow.js`, `extension/lib/{updater,debInstall}.js`: the Updates window.
- `packaging/`, `scripts/build-deb.sh`, `bin/ide-desktop`: the `.deb`.
- `.github/workflows/`: `auto-pr`, `check` (tests + MSBuild on Windows), `release`.

## What exists and is tested
Everything under `extension/lib/`, the launcher (against a stand-in editor), the `.vsix` layout, extension start-up against a stand-in `vscode` module, and a real mingw cross-compile whose `.exe` ran under wine.

## Not tested (no real editor available when this was written)
The VS Code UI itself: tree view rendering, the task/problem-matcher wiring, keybinding precedence over built-ins, the clangd settings write, the real VS Code download. First thing to do with a real editor: run `ide setup`, open a project, press F5, break the code on purpose and check the Problems panel.

## Also untested on a real desktop
The Updates window rendering, the real polkit prompt and terminal fallback, GitHub sign-in through the browser and keyring, and Publish to GitHub. The `.deb` itself was built, installed, queried with `dpkg-query` and removed in a test container; the install helpers are tested with the system calls replaced.

## Windows port: partly confirmed
Confirmed on a real PC by the owner: installer, setup, Build and Run. Not yet confirmed: the rcedit icon, `ide.vbs`, update-via-installer. Written on Linux with no Windows machine: the unit tests (`test/windows.test.js`) and the installer build pass here, but `ide.ps1`, the WinLibs download (asset name regex), the portable VS Code zip, the Start menu shortcut, `cmd.exe` task quoting, the console window and the Updates window on Windows have never been executed, CI (`check.yml` job `windows-tool`) parses the launcher and builds+runs a sample with the real command line; first thing to do on a real Windows PC: `bin\ide.cmd setup`, open a project, F5, break the code, check Problems.

## Also untested (second round)
The external terminal windows on a real desktop, Wine prefix creation on first run, whether editing `desktopName` is what fixes the KDE window identity on Wayland and X11, and `ide integrate` on Arch.

## Hard-won gotchas
- Node 22 `node --test` does not take a bare directory; the test script uses a glob.
- A `.vsix` entry loses its executable bit unless the zip records a Unix mode (`zip.js` does); the extension also `chmod`s the shims before use.
- MSBuild builds of a `.vcxproj` alone (not through the solution) put output under the project folder, not `$(SolutionDir)`.

- The user's login shell may be fish (or anything non-POSIX). fish rejects `( ... )` and `{ ...; }` and its quoting differs from the `'\''` idiom, so build tasks pin `/bin/sh -c`, and anything typed into the user's own terminal is a short backslash-escaped `sh <file>` (`escapeArg`, `sendScript`); never type POSIX shell text into it directly.

## Session log
- Solution Explorer moved to the Secondary Side Bar (`viewsContainers.secondarySidebar`, right side, closed until opened) plus a right-hand status bar button. UNVERIFIED: the contribution key and the minimum VS Code version were written from memory (no docs access); if the view vanishes, revert to `activitybar`.
- Added Rename (right-click or F2) for files in Solution Explorer: renames on disk and in the `.vcxproj`/`.filters`; `#include` lines are not rewritten. UI untested in a real editor.
- Windows confirmed working by the owner (build + run). Dropped the zip; added editor icon (rcedit), wscript launcher, update via installer.
- Windows installer (NSIS) added next to the zip.
- Windows port (zip, PowerShell launcher, cmd-based build/run, WinLibs compiler). Untested on real Windows.
- First version: all of the above.
- Added the `.deb`, the Updates window and the GitHub setup.
- Fixed: the start-menu entry opened the home folder (git scan); git settings narrowed. GitHub sign-in turned out to work.
- Start-menu/Open With entry, GUI first run, start page, Run/Build buttons, unversioned release names.
- Removed the 120-column ruler (the white vertical line) and migrate it away. External terminal runs, Wine prefix, branding, `ide integrate`.
- Fixed: Build failed with exit 127 under fish (task ran in the user's shell). Tasks now use `/bin/sh`.
- Unverified: that the window keeps our icon in KDE after it opens (relies on `--class` / `StartupWMClass`; VS Code may still set its own icon).
