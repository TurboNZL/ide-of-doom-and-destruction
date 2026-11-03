# ide-of-doom-and-destruction

A portable VS Code bundle that works with **Visual Studio C++ solutions** (`.slnx` / `.sln` / `.vcxproj`) on Linux, so a project you edit here opens, builds and runs unchanged in Visual Studio on Windows.

It is not a new editor and it does not convert anything. It runs next to your normal VS Code (its own settings and extensions live in a folder inside this tool) and adds the Visual Studio workflow on top:

| Visual Studio | Here |
|---|---|
| File > New > Project > Console App | `Ctrl+Shift+N` or the Solution Explorer button: **New Console App** |
| Solution Explorer | **Solution Explorer** view, with the project's Source Files / Header Files filters |
| Add > Class | `Shift+Alt+C`: creates `Name.h` and `Name.cpp` and lists them in the `.vcxproj` and `.filters` |
| Add > New Item | `Ctrl+Shift+A` |
| Build Solution | `F7` or `Ctrl+Shift+B` |
| Start (F5 / Ctrl+F5) | `F5` or `Ctrl+F5`: builds, then runs in the terminal |
| Error List | the **Problems** panel (`Ctrl+Shift+M`), filled from compiler output |
| Configuration / platform picker | the status bar item (`Debug \| x64`) |
| `system("cls")`, `system("pause")` | work, via small stand-ins on the program's PATH |

The `.vcxproj` is the source of truth: the file list, language standard, warning level, defines and include folders are read from it each time you build. Nothing is generated beside it except IntelliSense data in `.vs/` (which Visual Studio already ignores).

## Install

Needs `bash`, `curl`, `tar` and a C++ compiler (`g++`). For the Windows `.exe` in **Package for Submission**, also `g++-mingw-w64-x86-64-posix`.

```bash
git clone https://github.com/TurboNZL/ide-of-doom-and-destruction
./ide-of-doom-and-destruction/bin/ide setup
```

Then open any folder that holds a solution:

```bash
./ide-of-doom-and-destruction/bin/ide path/to/project
```

Add `bin/` to your `PATH` to type just `ide`.

Debian/Ubuntu: `sudo apt install g++ g++-mingw-w64-x86-64-posix`.

## Using it

1. **New project:** `Ctrl+Shift+N`, pick a name and a folder. You get the same layout Visual Studio makes: `Name.slnx` at the top, the project in `Name/`, a `.gitignore` and a `.gitattributes`.
2. **Existing project:** open the folder that holds the `.slnx` or `.sln`. A file added in the normal file explorer is not built until you right-click it > **Add to Project** (the build output says when something is left out).
3. **Build and run:** `F5`. Compiler messages appear in Problems and the program runs in a terminal tab.
4. **Package for Submission** (command palette): builds a Release `.exe` for Windows (statically linked, so no extra DLLs) and writes two folders into `Submission/`:
   - `Source - {name}`: only the `.cpp`/`.h` files, the project files and a solution (both `.slnx` and a classic `.sln`).
   - `Release - {name}`: the `.exe` and a `Readme.txt` (your own `Readme.txt` from the solution folder if there is one, otherwise a template).

   The folder names, the name used in them, and the solution's file name are settings (`vsproj.submission.*`), so they can match whatever your hand-in rules ask for.

IntelliSense, completion and formatting come from [clangd](https://clangd.llvm.org/), installed by `ide setup`.

## Updates

```bash
ide update
```

pulls the newest version (`git pull` for a clone, or the latest release for a download) and reinstalls the extension. The editor also checks once a day and says when a newer release exists (setting `vsproj.checkForUpdates`).

Every merge to `main` becomes a release (`vYYYY.M.N`) with the extension (`.vsix`) and the whole tool (`.tar.gz`) attached.

## What it does not do

- No debugger (breakpoints, stepping). Run and read the output.
- Console `Application` projects only; no libraries, no project references, no property sheets, no precompiled headers, no resource files.
- The compiler is GCC, not MSVC, so the odd thing MSVC accepts or rejects will differ. Before handing something in, build it once in Visual Studio, or let the CI in a private copy of your project do it with `msbuild` on a Windows runner.
- Linux only (x64 and arm64).

## Developing

```bash
npm test
```

runs the tests: project editing, build commands, packaging (including a real cross-compile when the mingw compiler is present), the `.vsix`, and a start-up check of the extension against a stand-in for the VS Code API. CI also builds a generated sample project with Microsoft's MSBuild on a Windows runner.

`extension/lib/` has no VS Code dependency; `extension/extension.js` is the thin VS Code side. See `CLAUDE.md` for the layout and decisions.

## License

MIT, see `LICENSE`.
