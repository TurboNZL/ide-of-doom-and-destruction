#!/usr/bin/env bash
# Builds the Windows installer (a per-user setup .exe) with makensis. Usage: scripts/build-windows-installer.sh <version> <output.exe>
# Needs: nodejs and nsis (Debian/Ubuntu: sudo apt install nsis).
set -euo pipefail
version="${1:?version}"; out="$(realpath -m "${2:?output .exe}")"
here="$(cd "$(dirname "$0")/.." && pwd)"
command -v makensis >/dev/null || { echo "makensis not found (sudo apt install nsis)" >&2; exit 1; }
stage="$(mktemp -d)"; trap 'rm -rf "$stage"' EXIT
node "$here/scripts/stage-windows.js" "$stage/files"
mkdir -p "$(dirname "$out")"
makensis -V2 -DVERSION="$version" -DSTAGE="$stage/files" -DOUTFILE="$out" "$here/packaging/windows-installer.nsi"
echo "Wrote $out"
