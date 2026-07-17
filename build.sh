#!/usr/bin/env bash
# Assembles per-browser builds from the shared src/ tree and packages them.
#
#   dist/chrome/                unpacked Chrome/Edge extension  (Load unpacked)
#   dist/firefox/               unpacked Firefox extension      (about:debugging)
#   dist/element-blocker.xpi           Firefox package (unsigned)
#   dist/element-blocker-chrome.zip    Chrome Web Store upload
#
# Usage: ./build.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SRC="$ROOT/src"
DIST="$ROOT/dist"

build_target() {
  local target="$1"                       # chrome | firefox
  local manifest="$ROOT/manifests/manifest.$target.json"
  local out="$DIST/$target"

  [ -f "$manifest" ] || { echo "missing manifest: $manifest" >&2; exit 1; }

  rm -rf "$out"
  mkdir -p "$out"
  cp -R "$SRC/." "$out/"
  cp "$manifest" "$out/manifest.json"
  echo "built  $out"
}

package_zip() {
  local dir="$1" outfile="$2"
  command -v zip >/dev/null 2>&1 || { echo "zip not found — skipping $outfile" >&2; return; }
  rm -f "$outfile"
  # -FS keeps the archive in sync; run from inside the dir so the manifest sits
  # at the archive ROOT, which Firefox requires for a valid XPI.
  ( cd "$dir" && zip -r -FS "$outfile" . -x '*.DS_Store' >/dev/null )
  echo "packed $outfile"
}

build_target chrome
build_target firefox

package_zip "$DIST/chrome"  "$DIST/element-blocker-chrome.zip"
package_zip "$DIST/firefox" "$DIST/element-blocker.xpi"

echo "done."
