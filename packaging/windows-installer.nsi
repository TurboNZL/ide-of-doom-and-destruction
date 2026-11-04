; Installer for Windows (built on Linux with makensis by scripts/build-windows-installer.sh).
; Installs for the current user only (no administrator prompt) into %LOCALAPPDATA%\Programs, adds a Start menu entry and an
; uninstaller, then runs `ide setup` in a visible window to download the editor and the compiler.
; Usage: makensis -DVERSION=2026.11.0 -DSTAGE=<staged folder> -DOUTFILE=<installer.exe> windows-installer.nsi
Unicode true
!include "MUI2.nsh"

!ifndef VERSION
  !define VERSION "0.0.0"
!endif
!define NAME "IDE of Doom and Destruction"
!define APPDIR "ide-of-doom-and-destruction"
!define UNINST "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APPDIR}"

Name "${NAME}"
OutFile "${OUTFILE}"
RequestExecutionLevel user
InstallDir "$LOCALAPPDATA\Programs\${APPDIR}"
InstallDirRegKey HKCU "Software\${APPDIR}" "InstallDir"
SetCompressor /SOLID lzma
BrandingText "${NAME} ${VERSION}"

!define MUI_ICON "${STAGE}\packaging\ide-of-doom-and-destruction.ico"
!define MUI_UNICON "${STAGE}\packaging\ide-of-doom-and-destruction.ico"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_TEXT "The editor and the C++ compiler are downloaded in the window that opens next (about 400 MB, first time only). Start ${NAME} from the Start menu when it says Done."
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install"
  ; A running editor from an earlier install would keep its files locked.
  SetOutPath "$INSTDIR"
  File /r "${STAGE}\*.*"
  WriteUninstaller "$INSTDIR\uninstall.exe"
  WriteRegStr HKCU "Software\${APPDIR}" "InstallDir" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "DisplayName" "${NAME}"
  WriteRegStr HKCU "${UNINST}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINST}" "Publisher" "TurboNZL"
  WriteRegStr HKCU "${UNINST}" "DisplayIcon" "$INSTDIR\packaging\ide-of-doom-and-destruction.ico"
  WriteRegStr HKCU "${UNINST}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${UNINST}" "UninstallString" '"$INSTDIR\uninstall.exe"'
  WriteRegDWORD HKCU "${UNINST}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINST}" "NoRepair" 1

  ; Same shortcut `ide integrate` makes (same name, so it is replaced, not doubled).
  SetOutPath "$PROFILE"
  CreateShortCut "$SMPROGRAMS\${NAME}.lnk" "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" '-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "$INSTDIR\bin\ide.ps1"' "$INSTDIR\packaging\ide-of-doom-and-destruction.ico" 0

  ; Download the editor and the compiler, in a visible window, and wait for it.
  SetOutPath "$INSTDIR"
  ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "& \"$INSTDIR\bin\ide.ps1\" setup; if ($$LASTEXITCODE -ne 0) { Read-Host \"Setup failed. Press Enter to close\" } else { Start-Sleep -Seconds 3 }"'
SectionEnd

Section "Uninstall"
  Delete "$SMPROGRAMS\${NAME}.lnk"
  ; Everything lives in the install folder: the tool, the editor, its settings and extensions.
  RMDir /r "$INSTDIR"
  DeleteRegKey HKCU "${UNINST}"
  DeleteRegKey HKCU "Software\${APPDIR}"
SectionEnd
