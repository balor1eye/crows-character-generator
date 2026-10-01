#!/usr/bin/env bash
# Lays out the accounts site the way it sits in the cPanel home folder:
#   <out>/crows-app/            PHP code, schema, tools, the Ref Screen (outside the web root)
#   <out>/public_html/crows/    the portal, API entry points, and the Character Generator
# Usage: server/stage.sh [out dir]   (default build/out/site). Run build/build.py and ref/build/build.py first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/build/out/site}"
rm -rf "$OUT/crows-app" "$OUT/public_html/crows"
mkdir -p "$OUT/crows-app" "$OUT/public_html/crows"
cp "$ROOT"/server/app/*.php "$ROOT"/server/app/schema.sql "$OUT/crows-app/"
rm -f "$OUT/crows-app/config.php"
cp "$ROOT/dist/Crows_Ref_Screen.html" "$OUT/crows-app/"
cp -r "$ROOT/server/public/." "$OUT/public_html/crows/"
cp "$ROOT/src/theme.js" "$OUT/public_html/crows/"   # shared with the apps, which inline it
cp "$ROOT/dist/Crows_Character_Generator.html" "$OUT/public_html/crows/"
python3 "$ROOT/server/csp.py" "$OUT/public_html/crows" "$OUT/crows-app"
echo "staged $OUT"
