# Launcher for the portable editor on Windows (the counterpart of the "ide" script on Linux).
#   ide                 open the editor (in the current folder, unless that is your home folder)
#   ide <folder>        open the editor in a folder
#   ide setup           download the editor and the compiler and install the extensions (first time only)
#   ide update          get the newest version of this tool and its extension
#   ide integrate       add a Start menu shortcut
#   ide where           print where the editor is installed
#
# The editor lives in .\vscode next to this tool (or under %LOCALAPPDATA% when this folder is read-only), in portable
# mode: all of its settings and extensions are in vscode\data, so a normal VS Code install is never touched.
# Keep this file plain ASCII: Windows PowerShell 5 reads a file without a byte order mark as ANSI.
param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Rest)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$Repo = 'TurboNZL/ide-of-doom-and-destruction'
$AppName = 'ide-of-doom-and-destruction'

function Test-Writable([string]$dir) {
  try {
    $probe = Join-Path $dir ('.w' + [guid]::NewGuid().ToString('N'))
    [IO.File]::WriteAllText($probe, 'x')
    Remove-Item -Force $probe
    return $true
  } catch { return $false }
}

if ($env:IDE_HOME) { $HomeDir = $env:IDE_HOME }
elseif (Test-Writable $Root) { $HomeDir = Join-Path $Root 'vscode' }
else { $HomeDir = Join-Path $env:LOCALAPPDATA "$AppName\vscode" }
$DataDir = Split-Path -Parent $HomeDir
$Code = Join-Path $HomeDir 'Code.exe'
$CodeCli = Join-Path $HomeDir 'bin\code.cmd'
$MingwDir = Join-Path $DataDir 'mingw64'
# The editor and its extension find these (the extension looks for the compiler in the data folder; the Updates window runs the launcher).
$env:IDE_DATA_DIR = $DataDir
$env:IDE_BIN = Join-Path $Root 'bin\ide.cmd'

function Say([string]$text) { [Console]::Error.WriteLine($text) }
function Die([string]$text) { Say "ide: $text"; exit 1 }

# Runs a script with node if there is one, otherwise with the editor's own node (Code.exe is a GUI program, so wait for it explicitly).
function Invoke-Node([string]$script, [string[]]$scriptArgs) {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    & node $script @scriptArgs
    $code = $LASTEXITCODE
  } else {
    $env:ELECTRON_RUN_AS_NODE = '1'
    try {
      $quoted = @($script) + @($scriptArgs) | ForEach-Object { '"' + $_ + '"' }
      $p = Start-Process -Wait -PassThru -NoNewWindow -FilePath $Code -ArgumentList $quoted
      $code = $p.ExitCode
    } finally { Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue }
  }
  if ($code -ne 0) { Die "a helper script failed (exit code $code)" }
}

# Downloads with curl.exe (built into Windows 10 and 11, shows a progress bar), else with Invoke-WebRequest.
function Get-File([string]$url, [string]$dest) {
  Say "Downloading $url"
  if (Get-Command curl.exe -ErrorAction SilentlyContinue) {
    & curl.exe -fL --progress-bar -o $dest $url
    if ($LASTEXITCODE -ne 0) { Die "the download failed (curl exit code $LASTEXITCODE): $url" }
  } else {
    Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $dest
  }
}

# tar.exe (built into Windows 10 1803 and later) unpacks zip files much faster than Expand-Archive.
function Expand-Zip([string]$zip, [string]$dest) {
  New-Item -ItemType Directory -Force -Path $dest | Out-Null
  & tar.exe -xf $zip -C $dest
  if ($LASTEXITCODE -ne 0) { Die "could not unpack $zip" }
}

function Get-ToolVersion {
  $pkg = Get-Content -Raw (Join-Path $Root 'extension\package.json') | ConvertFrom-Json
  return [string]$pkg.version
}

function Install-Editor {
  $url = $env:IDE_VSCODE_URL
  if (-not $url) { $url = 'https://update.code.visualstudio.com/latest/win32-x64-archive/stable' }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('ide-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Get-File $url (Join-Path $tmp 'code.zip')
    Say 'Unpacking the editor...'
    $new = "$HomeDir.new"
    if (Test-Path $new) { Remove-Item -Recurse -Force $new }
    Expand-Zip (Join-Path $tmp 'code.zip') $new
    # Keep the existing settings and extensions when the editor itself is replaced.
    if (Test-Path (Join-Path $HomeDir 'data')) { Move-Item (Join-Path $HomeDir 'data') (Join-Path $new 'data') }
    if (Test-Path $HomeDir) { Remove-Item -Recurse -Force $HomeDir }
    Move-Item $new $HomeDir
    # This folder is what makes it portable.
    New-Item -ItemType Directory -Force -Path (Join-Path $HomeDir 'data\user-data\User'), (Join-Path $HomeDir 'data\extensions') | Out-Null
  } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}

# The compiler: MinGW-w64 from the WinLibs project, kept in the data folder. Skipped when a g++ is already on PATH.
function Install-Compiler {
  if (Test-Path (Join-Path $MingwDir 'bin\g++.exe')) { return }
  if (Get-Command g++ -ErrorAction SilentlyContinue) { return }
  $url = $env:IDE_MINGW_URL
  if (-not $url) {
    try {
      $rel = Invoke-RestMethod -UseBasicParsing -Headers @{ 'User-Agent' = 'ide-of-doom-and-destruction' } -Uri 'https://api.github.com/repos/brechtsanders/winlibs_mingw/releases/latest'
      $asset = $rel.assets | Where-Object { $_.name -match '^winlibs-x86_64-posix-seh-gcc-[0-9.]+-mingw-w64ucrt-[0-9.]+-r[0-9]+\.zip$' } | Select-Object -First 1
      if ($asset) { $url = $asset.browser_download_url }
    } catch { }
  }
  if (-not $url) {
    Say 'Note: could not find the compiler download. Install a MinGW-w64 g++ (for example from https://winlibs.com or MSYS2),'
    Say '      put it on PATH, and Build and Run will use it. Or set IDE_MINGW_URL to a WinLibs zip and run: ide setup'
    return
  }
  $tmp = Join-Path ([IO.Path]::GetTempPath()) ('ide-' + [guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  try {
    Say 'Downloading the C++ compiler (about 300 MB, first time only)...'
    Get-File $url (Join-Path $tmp 'mingw.zip')
    Say 'Unpacking the compiler...'
    Expand-Zip (Join-Path $tmp 'mingw.zip') $tmp
    if (Test-Path $MingwDir) { Remove-Item -Recurse -Force $MingwDir }
    Move-Item (Join-Path $tmp 'mingw64') $MingwDir
  } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
}

function Install-Extensions {
  $dist = Join-Path $DataDir 'dist'
  New-Item -ItemType Directory -Force -Path $dist | Out-Null
  $vsix = Join-Path $dist "$AppName.vsix"
  Say 'Building the extension...'
  Invoke-Node (Join-Path $Root 'scripts\pack-vsix.js') @($vsix)
  & $CodeCli --install-extension $vsix --force
  foreach ($line in Get-Content (Join-Path $Root 'config\extensions.txt')) {
    $ext = $line.Trim()
    if (-not $ext -or $ext.StartsWith('#')) { continue }
    & $CodeCli --install-extension $ext
    if ($LASTEXITCODE -ne 0) { Say "Could not install $ext (you can add it later from the Extensions view)." }
  }
  Set-Content -NoNewline -Path (Join-Path $HomeDir 'data\.extension-version') -Value (Get-ToolVersion)
}

# Copied only when absent, so the user's own choices are kept. The Windows file adds what clangd needs to find MinGW's headers.
function Set-Settings {
  $target = Join-Path $HomeDir 'data\user-data\User\settings.json'
  if (Test-Path $target) { return }
  $source = Join-Path $Root 'config\settings.windows.json'
  if (-not (Test-Path $source)) { $source = Join-Path $Root 'config\settings.json' }
  Copy-Item $source $target
}

# After the tool was updated (a new zip over the old one) the extension inside the editor is the old one: install the new one.
function Sync-Extension {
  $marker = Join-Path $HomeDir 'data\.extension-version'
  $have = ''
  if (Test-Path $marker) { $have = (Get-Content -Raw $marker).Trim() }
  if ($have -eq (Get-ToolVersion)) { return }
  Say "Updating the editor's extension to $(Get-ToolVersion)..."
  Install-Extensions
}

function Invoke-Integrate {
  $programs = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'
  $link = Join-Path $programs 'IDE of Doom and Destruction.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $s = $shell.CreateShortcut($link)
  $s.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $s.Arguments = '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Root 'bin\ide.ps1') + '"'
  $s.WorkingDirectory = $env:USERPROFILE
  $s.Description = 'Edit and build Visual Studio C++ solutions'
  $ico = Join-Path $Root 'packaging\ide-of-doom-and-destruction.ico'
  if (Test-Path $ico) { $s.IconLocation = $ico }
  $s.Save()
  Say 'Added "IDE of Doom and Destruction" to the Start menu.'
}

function Invoke-Setup {
  if (-not (Test-Path $Code)) { Install-Editor }
  Set-Settings
  Install-Extensions
  Install-Compiler
  Invoke-Integrate
  Say "Done. Start the editor from the Start menu, or with: $env:IDE_BIN <folder>"
}

function Invoke-Update {
  if (Test-Path (Join-Path $Root '.git')) {
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Die 'git is required to update a clone.' }
    & git -C $Root pull --ff-only
    if ($LASTEXITCODE -ne 0) { Die 'git pull failed.' }
  } else {
    if (-not (Test-Writable $Root)) { Die "This folder is read-only; download the newest zip from https://github.com/$Repo/releases/latest and unpack it again." }
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ('ide-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    try {
      Get-File "https://github.com/$Repo/releases/latest/download/$AppName-windows.zip" (Join-Path $tmp 'tool.zip')
      Expand-Zip (Join-Path $tmp 'tool.zip') (Join-Path $tmp 'x')
      # The running ide.cmd is left alone (cmd reads a batch file while it runs; it only ever calls ide.ps1).
      Get-ChildItem -Recurse -File (Join-Path $tmp 'x') | ForEach-Object {
        $rel = $_.FullName.Substring((Join-Path $tmp 'x').Length).TrimStart('\')
        if ($rel -ieq 'bin\ide.cmd') { return }
        $to = Join-Path $Root $rel
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $to) | Out-Null
        Copy-Item -Force $_.FullName $to
      }
    } finally { Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue }
  }
  if (-not (Test-Path $Code)) { Die 'The editor is not installed yet. Run: ide setup' }
  Install-Extensions
  Say 'Updated. Restart the editor to use the new version.'
}

switch ($(if ($Rest -and $Rest.Count -gt 0) { $Rest[0] } else { '' })) {
  'setup' { Invoke-Setup }
  'update' { Invoke-Update }
  'integrate' { Invoke-Integrate }
  'where' { Write-Output $HomeDir }
  { $_ -in 'help', '-h', '--help' } { Get-Content $PSCommandPath | Select-Object -Skip 1 -First 8 | ForEach-Object { $_ -replace '^# ?', '' } }
  default {
    if (-not (Test-Path $Code)) {
      # Started from the Start menu there is no console: run the setup in a visible window and wait for it.
      $self = $PSCommandPath
      $p = Start-Process -Wait -PassThru -FilePath 'powershell.exe' -ArgumentList @('-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', "& '$self' setup; if (`$LASTEXITCODE -ne 0) { Read-Host 'Setup failed. Press Enter to close' } else { Start-Sleep -Seconds 2 }")
      if (-not (Test-Path $Code)) { exit 1 }
    }
    Sync-Extension
    $targets = @($Rest | Where-Object { $_ })
    # Like the Linux launcher: with no folder given, open the current folder, but never the home folder (the editor would watch everything in it).
    if ($targets.Count -eq 0) {
      $here = (Get-Location).ProviderPath.TrimEnd('\')
      if ($here -ine $env:USERPROFILE.TrimEnd('\') -and $here -ine (Join-Path $Root 'bin').TrimEnd('\')) { $targets = @($here) }
    }
    $argList = @($targets | ForEach-Object { '"' + $_ + '"' })
    if ($argList.Count -gt 0) { Start-Process -FilePath $Code -ArgumentList $argList } else { Start-Process -FilePath $Code }
  }
}
