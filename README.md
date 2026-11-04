# ide-of-doom-and-destruction

A portable VS Code bundle that works with **Visual Studio C++ solutions** (`.slnx` / `.sln` / `.vcxproj`) on Linux and Windows, so a project you edit here opens, builds and runs unchanged in Visual Studio on Windows.

It is not a new editor and it does not convert anything. It runs next to your normal VS Code (its own settings and extensions live in a folder inside this tool) and adds the Visual Studio workflow on top:

| Visual Studio | Here |
|---|---|
| File > New > Project > Console App | `Ctrl+Shift+N` or the Solution Explorer button: **New Console App** |
| Solution Explorer | **Solution Explorer** view, with the project's Source Files / Header Files filters |
| Add > Class | `Shift+Alt+C`: creates `Name.h` and `Name.cpp` and lists them in the `.vcxproj` and `.filters` |
| Add > New Item | `Ctrl+Shift+A` |
| Build Solution | `F7` or `Ctrl+Shift+B` |
| Start (F5 / Ctrl+F5) | the **play button** in the top bar of any `.cpp`/`.h` file, **Run** in the bottom bar, or `F5`: builds, then runs the program in a **separate terminal window** (your default terminal: the one set in KDE's System Settings, `$TERMINAL`, Konsole, GNOME Console, kitty, alacritty, foot, xterm...). Setting `vsproj.terminal` picks another; `vsproj.runIn` can send it to the editor's own terminal panel instead |
| Error List | the **Problems** panel (`Ctrl+Shift+M`), filled from compiler output |
| Configuration / platform picker | the status bar item (`Debug \| x64`) |
| `system("cls")`, `system("pause")` | work, via small stand-ins on the program's PATH |

The `.vcxproj` is the source of truth: the file list, language standard, warning level, defines and include folders are read from it each time you build. Nothing is generated beside it except IntelliSense data in `.vs/` (which Visual Studio already ignores).

## Install

### Windows 10 and 11 (x64)

Download `ide-of-doom-and-destruction-setup.exe` from the [latest release](https://github.com/TurboNZL/ide-of-doom-and-destruction/releases/latest) and run it. It installs for your user only (no administrator prompt) into `%LOCALAPPDATA%\Programs\ide-of-doom-and-destruction`, adds the Start menu entry, then opens a window that downloads the editor and compiler (below). Windows may show a SmartScreen warning because the installer is not code-signed: *More info* > *Run anyway*. Uninstall from *Settings > Apps*; that removes the editor and its settings and extensions too.

Prefer no installer? Download `ide-of-doom-and-destruction-windows.zip` instead, unpack it somewhere you keep (for example `C:\Tools`; not under `Program Files`, the editor is downloaded next to it), and double-click `bin\ide.cmd` or run:

```
bin\ide.cmd setup
```

Setup downloads the editor (portable, so your normal VS Code is untouched), a MinGW-w64 `g++` from the WinLibs project (about 300 MB, kept in `%LOCALAPPDATA%` or next to the tool; skipped when a `g++` is already on `PATH`), installs the extensions and adds **IDE of Doom and Destruction** to the Start menu. Needs only what Windows already has (`curl`, `tar`, PowerShell). Build and Run use `g++` and open the program in its own console window; the **Wine** commands are Linux-only and hidden. **Package for Submission** uses the same compiler, no cross compiler needed. The Updates window updates the copy in place (`bin\ide.cmd update`).

### .deb (Debian, Ubuntu and friends)

Download `ide-of-doom-and-destruction.deb` from the [latest release](https://github.com/TurboNZL/ide-of-doom-and-destruction/releases/latest) and install it:

```bash
sudo apt install ./ide-of-doom-and-destruction.deb
```

Open **IDE of Doom and Destruction** from the application menu, or right-click a folder or a `.cpp`/`.h` file > *Open With*. No terminal is involved. The first start shows a progress window while it downloads the editor into your own data folder (`~/.local/share/ide-of-doom-and-destruction`), so each user gets a private copy and the package never touches a normal VS Code install. Removing the package leaves that folder alone.

If the entry is missing from the menu or *Open With* right after installing, log out and in once (or run `kbuildsycoca6`); the package already asks the desktop to refresh.

### Arch family and other distributions

There is no package for them yet; use the download. Get `ide-of-doom-and-destruction.tar.gz` from the latest release, unpack it somewhere you keep (for example `~/Applications`), and start `bin/ide setup` once. It downloads the editor and adds **IDE of Doom and Destruction** to your application menu and *Open With* list (`ide integrate` does just that part). From then on everything is in the GUI, and the Updates window updates the copy in place.

Packages you need, Arch family: `sudo pacman -S git curl zenity gcc mingw-w64-gcc wine` (`kdialog` can replace `zenity`).

### From a clone

Needs `bash`, `curl`, `tar`, `git` and a C++ compiler (`g++`). For the Windows `.exe` in **Package for Submission**, also the mingw-w64 cross compiler, and `wine` to try that `.exe` out.

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

## Windows programs in Wine

**IDE of Doom: Run the Windows Build in Wine** builds the Windows `.exe` with the cross compiler and runs it under Wine. **Run an .exe in the Wine Prefix...** (also in the file explorer's right-click menu on any `.exe`, and offered after **Package for Submission**) runs a finished `.exe`, for example the one you are about to hand in. They all use one Wine prefix kept in the tool's own data folder (`~/.local/share/ide-of-doom-and-destruction/wine-prefix`, or `wine-prefix/` next to a clone), so `~/.wine` is never used. Delete that folder to reset it.

## Where the custom features are

Everything this tool adds is labelled **IDE of Doom**:
- The **start page** opens in an empty window with *New Console App*, *Open a project folder*, *Sign in to GitHub* and *Updates*.
- The **IDE of Doom** button in the bottom-left corner lists every custom action.
- The **Solution Explorer** icon in the left activity bar, and **Run** / **Build** in the bottom bar and the top bar of C++ files.
- In the command palette (`Ctrl+Shift+P`) type `IDE of Doom`.

Anything not labelled that way is regular VS Code.

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

- **Sign in:** the Accounts icon (bottom left) > *Sign in with GitHub*, or the command **IDE of Doom: Sign in to GitHub**. It opens your browser; the login is kept in your system keyring (`gnome-keyring` or KWallet).
- **Source control:** a new project starts as a git repository on `main`. Use the Source Control view to commit, and **Publish to GitHub** to create the repository. Pushing and pulling use the signed-in account, no tokens to paste.
- **Pull requests and issues:** the GitHub Pull Requests extension is installed with the editor.

## Updates

Command palette > **IDE of Doom: Updates...** opens the Updates window: installed and latest version, the release notes, **Download** and **Install**. Installing asks for your password through the desktop's prompt, and falls back to a terminal running `sudo` when there is no prompt. It only reports success once `dpkg` shows the new version, and if nothing works it shows the one command to copy. **Restart now** reopens the editor on the same folder with the new extension.

The editor checks once a day and offers to open the window when a newer release exists (setting `vsproj.checkForUpdates`). A copy installed from a clone updates with `ide update` (`git pull` and a reinstall of the extension).

Every merge to `main` becomes a release (`vYYYY.M.N`) with the `.deb`, the extension (`.vsix`), the whole tool (`.tar.gz`) and the Windows installer and zip attached.

## What it does not do

- No debugger (breakpoints, stepping). Run and read the output.
- Console `Application` projects only; no libraries, no project references, no property sheets, no precompiled headers, no resource files.
- The compiler is GCC, not MSVC, so the odd thing MSVC accepts or rejects will differ. Before handing something in, build it once in Visual Studio, or let the CI in a private copy of your project do it with `msbuild` on a Windows runner.
- Linux (x64 and arm64) and Windows (x64). Only Debian-family systems have a package; others use the download (see above). On Windows the window keeps the stock editor icon and the x86 platform builds 64-bit (MinGW x64 only).

## Developing

```bash
npm test
```

runs the tests: project editing, build commands, packaging (including a real cross-compile when the mingw compiler is present), the `.vsix`, and a start-up check of the extension against a stand-in for the VS Code API. CI also builds a generated sample project with Microsoft's MSBuild on a Windows runner.

`extension/lib/` has no VS Code dependency; `extension/extension.js` is the thin VS Code side. See `CLAUDE.md` for the layout and decisions.

## License

MIT, see `LICENSE`.
