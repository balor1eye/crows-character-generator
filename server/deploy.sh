#!/usr/bin/env bash
# Builds, stages, and uploads the accounts site to the cPanel host over SSH (key must be in your ssh-agent).
# Deploys to the TEST instance (https://joshuaramsey.com/crows-test/) unless --production is given. The normal
# way to production is server/promote.sh, which copies the tested instance over; --production skips that.
# The app folder's config.php and keys on the server are never touched.
# Usage: server/deploy.sh [--production] [user@host]
set -euo pipefail
# Reuse one SSH connection for every step: the host blocks port 22 for a while after a burst of new connections.
mkdir -p ~/.cache/crows-test && chmod 700 ~/.cache/crows-test
export RSYNC_RSH="ssh -o ControlMaster=auto -o ControlPath=$HOME/.cache/crows-test/ssh-%C -o ControlPersist=120"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROD=0
[ "${1:-}" = --production ] && { PROD=1; shift; }
HOST="${1:-joshuara@shared178.accountservergroup.com}"
if [ $PROD = 1 ]; then
  WEB=crows; APP=crows-app; export CROWS_INSTANCE=
  echo "Deploying straight to PRODUCTION (https://joshuaramsey.com/crows/), not through the test instance."
else
  WEB=crows-test; APP=crows-test-app; export CROWS_INSTANCE=test
fi
STAGE="$ROOT/build/out/site"
"$ROOT/server/stage.sh" "$STAGE"
# What's deployed, for promote.sh to show (kept outside the web root).
{ echo "commit: $(git -C "$ROOT" rev-parse --short HEAD)$(git -C "$ROOT" diff --quiet HEAD -- . && echo '' || echo ' + uncommitted changes')"
  echo "deployed: $(date -u '+%Y-%m-%d %H:%M UTC') from $(hostname)"; } > "$STAGE/$APP/DEPLOYED.txt"
EXCL=(--exclude config.php --exclude test-accounts.json --exclude '*.log' --exclude '*.key')
rsync -rltv --chmod=D755,F644 "${EXCL[@]}" "$STAGE/$APP/" "$HOST:$APP/"
rsync -rltv --chmod=D755,F644 "$STAGE/public_html/$WEB/" "$HOST:public_html/$WEB/"
$RSYNC_RSH "$HOST" "chmod 700 ~/$APP; test -f ~/$APP/config.php && chmod 600 ~/$APP/config.php; php ~/$APP/install.php"
echo "Deployed to https://joshuaramsey.com/$WEB/"
