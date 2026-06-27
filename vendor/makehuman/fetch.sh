#!/usr/bin/env bash
# Fetch MakeHuman CC0 assets (base mesh + morph targets + rigs + expressions) from MPFB2.
#
# Assets are CC0 (see LICENSE.ASSETS in the mpfb2 repo): base mesh, targets, skins, rigs.
# MPFB2 *code* is GPL/AGPL and is NOT vendored — only the CC0 data files are copied here.
# Source: https://github.com/makehumancommunity/mpfb2  (.target format: TargetsV2 wiki)
#
# Usage:
#   ./fetch.sh           # base mesh + facial target regions + rigs + expressions (default)
#   ./fetch.sh --full    # all 1,258 targets (~38 MB), incl. macrodetails + body
#
# Idempotent: re-running overwrites vendor/makehuman/{base.obj,targets,rigs,expressions}.
set -euo pipefail

PIN="4212e1d9d4d2e61bf2bcd8915b3a9d77909f35e6"   # mpfb2 master, pinned 2026-06-27
REPO="https://github.com/makehumancommunity/mpfb2.git"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA="src/mpfb/data"

FACIAL="nose ears cheek chin eyes eyebrows forehead mouth head neck"
FULL=0
[[ "${1:-}" == "--full" ]] && FULL=1

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

echo "==> Blobless partial clone of mpfb2 @ ${PIN:0:8}"
git clone --filter=blob:none --no-checkout --quiet "$REPO" "$TMP/mpfb2"
git -C "$TMP/mpfb2" sparse-checkout init --cone
git -C "$TMP/mpfb2" sparse-checkout set "$DATA/3dobjs" "$DATA/targets" "$DATA/rigs" "$DATA/expressions"
git -C "$TMP/mpfb2" checkout --quiet "$PIN"

SRC="$TMP/mpfb2/$DATA"

echo "==> Copying base mesh, rigs, expressions"
mkdir -p "$HERE/targets"
cp "$SRC/3dobjs/base.obj" "$HERE/base.obj"
rm -rf "$HERE/rigs" "$HERE/expressions"
cp -R "$SRC/rigs" "$HERE/rigs"
cp -R "$SRC/expressions" "$HERE/expressions"

if [[ "$FULL" == "1" ]]; then
  echo "==> Copying ALL target regions (this is ~38 MB)"
  rm -rf "$HERE/targets"
  cp -R "$SRC/targets" "$HERE/targets"
else
  echo "==> Copying facial target regions: $FACIAL"
  rm -rf "$HERE/targets"; mkdir -p "$HERE/targets"
  cp "$SRC/targets/target.json" "$HERE/targets/" 2>/dev/null || true
  for r in $FACIAL; do
    [[ -d "$SRC/targets/$r" ]] && cp -R "$SRC/targets/$r" "$HERE/targets/$r"
  done
fi

echo "==> Decompressing .target.gz -> .target"
find "$HERE/targets" -name '*.target.gz' -print0 | while IFS= read -r -d '' f; do
  gunzip -kf "$f" && rm -f "$f"
done

COUNT="$(find "$HERE/targets" -name '*.target' | wc -l | tr -d ' ')"
echo "==> Done. $COUNT .target files under vendor/makehuman/targets"
echo "    base mesh: vendor/makehuman/base.obj"
