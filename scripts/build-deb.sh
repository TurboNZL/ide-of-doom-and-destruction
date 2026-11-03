#!/usr/bin/env bash
# Builds the .deb. Usage: scripts/build-deb.sh <version> <output.deb>
# The package holds the tool (launcher, extension, config). The editor itself is downloaded per user on first run,
# so the package is architecture independent and never ships a copy of VS Code.
set -euo pipefail

version="${1:?version, for example 2026.11.0}"
out="${2:?output file}"
version="${version#v}"
root="$(cd "$(dirname "$0")/.." && pwd)"
pkg=ide-of-doom-and-destruction
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

opt="$stage/opt/$pkg"
mkdir -p "$opt" "$stage/usr/bin" "$stage/usr/share/applications" "$stage/usr/share/icons/hicolor/scalable/apps" "$stage/DEBIAN"
for item in bin config extension scripts package.json README.md LICENSE; do cp -r "$root/$item" "$opt/"; done
rm -f "$opt"/scripts/build-deb.sh
# the packaged extension carries the package's version, so the editor can tell when it is out of date
sed -i "0,/\"version\": *\"[^\"]*\"/s//\"version\": \"$version\"/" "$opt/extension/package.json"

ln -s "/opt/$pkg/bin/ide" "$stage/usr/bin/ide"
cp "$root/packaging/$pkg.desktop" "$stage/usr/share/applications/$pkg.desktop"
cp "$root/packaging/$pkg.svg" "$stage/usr/share/icons/hicolor/scalable/apps/$pkg.svg"

find "$stage" -type d -exec chmod 755 {} +
find "$opt" -type f -exec chmod 644 {} +
chmod 755 "$opt"/bin/* "$opt"/extension/shims/* "$opt"/scripts/*.js
chmod 644 "$stage/usr/share/applications/$pkg.desktop" "$stage/usr/share/icons/hicolor/scalable/apps/$pkg.svg"

installed_kb="$(du -sk "$stage" | cut -f1)"
sed -e "s/@VERSION@/$version/" -e "s/@SIZE@/$installed_kb/" "$root/packaging/control" > "$stage/DEBIAN/control"
(cd "$stage" && find opt usr -type f -exec md5sum {} + > DEBIAN/md5sums)
cp "$root/packaging/postinst" "$stage/DEBIAN/postinst"
chmod 755 "$stage/DEBIAN/postinst"
chmod 644 "$stage/DEBIAN/control" "$stage/DEBIAN/md5sums"

mkdir -p "$(dirname "$out")"
dpkg-deb --build --root-owner-group "$stage" "$out" >/dev/null
echo "Wrote $out ($version)"
