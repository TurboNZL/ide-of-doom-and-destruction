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

### .deb (Debian, Ubuntu and friends)

Download `ide-of-doom-and-destruction.deb` from the [latest release](https://github.com/TurboNZL/ide-of-doom-and-destruction/releases/latest) and install it:

```bash
sudo apt install ./ide-of-doom-and-destruction.deb
```

Open **C++ Solutions Editor** from the application menu, or run `ide <folder>`. The first start downloads the editor into your own data folder (`~/.local/share/ide-of-doom-and-destruction`), so each user gets a private copy and the package never touches a normal VS Code install. Removing the package leaves that folder alone.

### From a clone

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

## GitHub

- **Sign in:** the Accounts icon (bottom left) > *Sign in with GitHub*, or the command **VS: Sign in to GitHub**. It opens your browser; the login is kept in your system keyring (`gnome-keyring` or KWallet).
- **Source control:** a new project starts as a git repository on `main`. Use the Source Control view to commit, and **Publish to GitHub** to create the repository. Pushing and pulling use the signed-in account, no tokens to paste.
- **Pull requests and issues:** the GitHub Pull Requests extension is installed with the editor.

## Updates

Command palette > **VS: Updates...** opens the Updates window: installed and latest version, the release notes, **Download** and **Install**. Installing asks for your password through the desktop's prompt, and falls back to a terminal running `sudo` when there is no prompt. It only reports success once `dpkg` shows the new version, and if nothing works it shows the one command to copy. **Restart now** reopens the editor on the same folder with the new extension.

The editor checks once a day and offers to open the window when a newer release exists (setting `vsproj.checkForUpdates`). A copy installed from a clone updates with `ide update` (`git pull` and a reinstall of the extension).

Every merge to `main` becomes a release (`vYYYY.M.N`) with the `.deb`, the extension (`.vsix`) and the whole tool (`.tar.gz`) attached.

## What it does not do

- No debugger (breakpoints, stepping). Run and read the output.
- Console `Application` projects only; no libraries, no project references, no property sheets, no precompiled headers, no resource files.
- The compiler is GCC, not MSVC, so the odd thing MSVC accepts or rejects will differ. Before handing something in, build it once in Visual Studio, or let the CI in a private copy of your project do it with `msbuild` on a Windows runner.
- Linux only (x64 and arm64). The package is for Debian-family systems; other distributions use the clone.

## Developing

```bash
npm test
```

runs the tests: project editing, build commands, packaging (including a real cross-compile when the mingw compiler is present), the `.vsix`, and a start-up check of the extension against a stand-in for the VS Code API. CI also builds a generated sample project with Microsoft's MSBuild on a Windows runner.

`extension/lib/` has no VS Code dependency; `extension/extension.js` is the thin VS Code side. See `CLAUDE.md` for the layout and decisions.

## License

MIT, see `LICENSE`.
