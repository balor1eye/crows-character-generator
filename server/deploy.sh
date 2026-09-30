#!/usr/bin/env bash
# Builds, stages, and uploads the accounts site to the cPanel host over SSH (key must be in your ssh-agent).
# ~/crows-app/config.php on the server is never touched. Usage: server/deploy.sh [user@host]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:-joshuara@shared178.accountservergroup.com}"
STAGE="$ROOT/build/out/site"
"$ROOT/server/stage.sh" "$STAGE"
rsync -rltv --chmod=D755,F644 --exclude config.php "$STAGE/crows-app/" "$HOST:crows-app/"
rsync -rltv --chmod=D755,F644 "$STAGE/public_html/crows/" "$HOST:public_html/crows/"
ssh "$HOST" 'chmod 700 ~/crows-app; test -f ~/crows-app/config.php && chmod 600 ~/crows-app/config.php; php ~/crows-app/install.php'
