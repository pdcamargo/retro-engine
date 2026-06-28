#!/usr/bin/env bash
# Fetch MakeHuman CC0 assets (base mesh + morph targets + rigs + expressions + skin) from MPFB2
# and the makehuman-assets release repo.
#
# Assets are CC0: base mesh / targets / rigs come from MPFB2's data dir; the skin texture comes
# from makehumancommunity/makehuman-assets (CC0 since 2020, LICENSE.txt). MPFB2 *code* is GPL/AGPL
# and is NOT vendored — only the CC0 data files are copied here.
# Sources: https://github.com/makehumancommunity/mpfb2          (.target format: TargetsV2 wiki)
#          https://github.com/makehumancommunity/makehuman-assets (skins/clothes/eyes/hair, CC0)
#
# Usage:
#   ./fetch.sh           # base mesh + facial target regions + rigs + expressions + skin (default)
#   ./fetch.sh --full    # all 1,258 targets (~38 MB), incl. macrodetails + body (skin still staged)
#
# Idempotent: re-running overwrites vendor/makehuman/{base.obj,targets,rigs,expressions,skins}.
set -euo pipefail

PIN="4212e1d9d4d2e61bf2bcd8915b3a9d77909f35e6"   # mpfb2 master, pinned 2026-06-27
REPO="https://github.com/makehumancommunity/mpfb2.git"
DATA="src/mpfb/data"

ASSETS_PIN="8cf9645b975a98eea056b140df11a1d278da0d10"   # makehuman-assets master, pinned 2026-06-27
ASSETS_REPO="https://github.com/makehumancommunity/makehuman-assets.git"
# Default skin staged from makehuman-assets. The skin *material* folder is named by ethnicity;
# its diffuse texture is named by skin tone, so the script reads the .mhmat's `diffuseTexture`
# key rather than guessing the PNG name. Clothes/eyes/hair live in sibling base/* folders in the
# same repo — add their paths to the sparse-checkout below to stage them too.
SKIN="young_caucasian_male"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

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

echo "==> Staging CC0 skin '$SKIN' from makehuman-assets @ ${ASSETS_PIN:0:8}"
# Fetch by raw URL pinned at the commit — no clone needed. The .mhmat is plain text (served by
# raw.githubusercontent.com); the diffuse PNG is Git LFS in this repo, so it comes from the
# media.githubusercontent.com endpoint, which resolves the LFS pointer to real bytes. The skin
# *material* folder is named by ethnicity but its texture by skin tone, so the diffuse filename
# is read from the .mhmat rather than guessed.
ASSETS_RAW="https://raw.githubusercontent.com/makehumancommunity/makehuman-assets/$ASSETS_PIN"
ASSETS_MEDIA="https://media.githubusercontent.com/media/makehumancommunity/makehuman-assets/$ASSETS_PIN"
rm -rf "$HERE/skins"; mkdir -p "$HERE/skins"
if curl -fsSL "$ASSETS_RAW/base/skins/$SKIN/$SKIN.mhmat" -o "$HERE/skins/$SKIN.mhmat"; then
  DIFF_REL="$(grep -iE '^[[:space:]]*diffuseTexture' "$HERE/skins/$SKIN.mhmat" | head -n1 | tr -d '\r' | awk '{print $2}')"
  DIFF_NAME="$(basename "$DIFF_REL")"
  if [[ -n "$DIFF_NAME" ]] && curl -fsSL "$ASSETS_MEDIA/base/skins/textures/$DIFF_NAME" -o "$HERE/skins/$DIFF_NAME"; then
    # Sanity-check we got real image bytes, not a leftover LFS pointer (~130 B of ASCII).
    BYTES="$(wc -c <"$HERE/skins/$DIFF_NAME" | tr -d ' ')"
    if [[ "$BYTES" -lt 1024 ]]; then
      echo "!! '$DIFF_NAME' is only $BYTES bytes — likely an unresolved LFS pointer" >&2
    else
      echo "    skin albedo: vendor/makehuman/skins/$DIFF_NAME ($BYTES bytes)"
    fi
  else
    echo "!! skin texture fetch failed for '$DIFF_NAME' — skipping" >&2
  fi
else
  echo "!! skin material fetch failed — skipping skin staging" >&2
fi

COUNT="$(find "$HERE/targets" -name '*.target' | wc -l | tr -d ' ')"
echo "==> Done. $COUNT .target files under vendor/makehuman/targets"
echo "    base mesh: vendor/makehuman/base.obj"
echo "    skin:      vendor/makehuman/skins/"
