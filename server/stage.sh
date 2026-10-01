#!/usr/bin/env bash
# Lays out the accounts site the way it sits in the cPanel home folder:
#   <out>/crows-app/            PHP code, schema, tools, the Ref Screen (outside the web root)
#   <out>/public_html/crows/    the portal, API entry points, and the Character Generator
# With CROWS_INSTANCE=test it lays out the test instance instead: crows-test-app/ and public_html/crows-test/
# (https://joshuaramsey.com/crows-test/), which also gets seed_test.php. Every other file is identical in both,
# which is what lets server/promote.sh copy the test instance to production as is.
# Usage: server/stage.sh [out dir]   (default build/out/site). Run build/build.py and ref/build/build.py first.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-$ROOT/build/out/site}"
case "${CROWS_INSTANCE:-}" in
  "") WEB=crows; APP=crows-app ;;
  test) WEB=crows-test; APP=crows-test-app ;;
  *) echo "unknown CROWS_INSTANCE '$CROWS_INSTANCE' (use test, or leave it unset for the live site)" >&2; exit 1 ;;
esac
rm -rf "$OUT/$APP" "$OUT/public_html/$WEB"
mkdir -p "$OUT/$APP" "$OUT/public_html/$WEB"
cp "$ROOT"/server/app/*.php "$ROOT"/server/app/schema.sql "$OUT/$APP/"
rm -f "$OUT/$APP/config.php"
cp "$ROOT/dist/Crows_Ref_Screen.html" "$OUT/$APP/"
cp -r "$ROOT/server/public/." "$OUT/public_html/$WEB/"
cp "$ROOT/src/theme.js" "$OUT/public_html/$WEB/"   # shared with the apps, which inline it
cp "$ROOT/dist/Crows_Character_Generator.html" "$OUT/public_html/$WEB/"
[ "$APP" = crows-app ] && rm "$OUT/$APP/seed_test.php"   # test-only tool
python3 "$ROOT/server/csp.py" "$OUT/public_html/$WEB" "$OUT/$APP"
echo "staged $OUT ($WEB, $APP)"
