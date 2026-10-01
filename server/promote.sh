#!/usr/bin/env bash
# Pushes the test instance to production: copies exactly what is running at https://joshuaramsey.com/crows-test/
# to https://joshuaramsey.com/crows/, server-side, after the test instance passes server/test_instance.py smoke.
# The two instances run byte-identical files (see stage.sh), so nothing is rebuilt or rewritten on the way.
#
# Never copied: each instance's config.php, keys (mfa.key, sync.key), logs, test-accounts.json, seed_test.php,
# and sync/ change files. Live data is untouched; only the database schema is brought up to date (install.php).
# Before copying, the current production code is backed up to ~/crows-backups/<UTC time>/ (the last 10 are kept).
#
# Usage: server/promote.sh [--yes] [--skip-smoke]     --yes skips the confirmation prompt
#        server/promote.sh --dry-run                   smoke test, then list what would change; touches nothing
#        server/promote.sh --rollback [<backup>]       put a backup back (default: the newest)
#        server/promote.sh --status                    show what each instance is running
set -euo pipefail
# Reuse one SSH connection for every step: the host blocks port 22 for a while after a burst of new connections.
mkdir -p ~/.cache/crows-test && chmod 700 ~/.cache/crows-test
export RSYNC_RSH="ssh -o ControlMaster=auto -o ControlPath=$HOME/.cache/crows-test/ssh-%C -o ControlPersist=120"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${CROWS_HOST:-joshuara@shared178.accountservergroup.com}"
YES=0; SMOKE=1; MODE=promote; BACKUP=
while [ $# -gt 0 ]; do
  case "$1" in
    --yes) YES=1 ;;
    --skip-smoke) SMOKE=0 ;;
    --status) MODE=status ;;
    --dry-run) MODE=dryrun ;;
    --rollback) MODE=rollback; case "${2:-}" in ""|--*) ;; *) BACKUP=$2; shift ;; esac ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
  shift
done
remote() { $RSYNC_RSH -o LogLevel=ERROR "$HOST" "$@"; }
# Files that belong to one instance only (or are runtime state), never carried between them.
EXCL="--exclude=config.php --exclude='*.key' --exclude='*.log' --exclude=error_log --exclude=test-accounts.json --exclude=seed_test.php --exclude=sync/ --exclude=DEPLOYED.txt"

status() {
  remote 'for a in crows-test-app crows-app; do echo "== ~/$a"; cat ~/$a/DEPLOYED.txt 2>/dev/null || echo "(no DEPLOYED.txt)"; done'
}
confirm() {
  [ $YES = 1 ] && return
  read -r -p "$1 Type 'yes' to continue: " a
  [ "$a" = yes ] || { echo "Stopped; production unchanged."; exit 1; }
}
# Production must keep its own database and real email; the test instance must be on a different database.
# Prints only setting names and database names, never passwords.
preflight() {
  remote 'php -r '"'"'
    $p = require getenv("HOME") . "/crows-app/config.php"; $t = require getenv("HOME") . "/crows-test-app/config.php";
    printf("production db: %s, test db: %s\n", $p["db_name"], $t["db_name"]);
    $bad = [];
    if ($p["db_name"] === $t["db_name"]) $bad[] = "both instances use the same database";
    if (!empty($p["test_instance"]) || !empty($p["mail_log"])) $bad[] = "production config has test settings";
    if (($p["cookie_path"] ?? "") !== "/crows/") $bad[] = "production cookie_path is not /crows/";
    if ($bad) { fwrite(STDERR, "REFUSING: " . implode("; ", $bad) . "\n"); exit(1); }
    echo "preflight ok\n";'"'"
}
check_live() {
  local code; code=$(curl -s -o /dev/null -w '%{http_code}' -A promote.sh "https://joshuaramsey.com/crows/api.php?a=me")
  [ "$code" = 200 ] && echo "Production API answers (200)." || { echo "WARNING: production API answered $code" >&2; exit 1; }
}

case $MODE in
status) status ;;

dryrun)
  status
  preflight
  [ $SMOKE = 1 ] && { echo "== Smoke test on the test instance"; python3 "$ROOT/server/test_instance.py" smoke | tail -1; }
  echo "== Would change in ~/crows-app and ~/public_html/crows (nothing copied)"
  remote "rsync -rlti --dry-run --checksum $EXCL ~/crows-test-app/ ~/crows-app/; rsync -rlti --dry-run --checksum $EXCL ~/public_html/crows-test/ ~/public_html/crows/" | grep -v '^\.d' || echo "(nothing: production already matches the test instance)"
  ;;

promote)
  status
  preflight
  if [ $SMOKE = 1 ]; then
    echo "== Smoke test on the test instance"
    python3 "$ROOT/server/test_instance.py" smoke | tail -1
  fi
  confirm "Copy the test instance over PRODUCTION (https://joshuaramsey.com/crows/)?"
  remote "set -e
    ts=\$(date -u +%Y%m%d-%H%M%S); b=~/crows-backups/\$ts
    mkdir -p \$b; chmod 700 ~/crows-backups
    rsync -a $EXCL ~/crows-app/ \$b/crows-app/
    cp ~/crows-app/DEPLOYED.txt \$b/crows-app/ 2>/dev/null || true
    rsync -a $EXCL ~/public_html/crows/ \$b/public_html-crows/
    echo \"Backed up production to \$b\"
    rsync -rlt --chmod=D755,F644 $EXCL ~/crows-test-app/ ~/crows-app/
    rsync -rlt --chmod=D755,F644 $EXCL ~/public_html/crows-test/ ~/public_html/crows/
    { sed 's/^/test: /' ~/crows-test-app/DEPLOYED.txt; echo \"promoted: \$(date -u '+%Y-%m-%d %H:%M UTC') from the test instance\"; } > ~/crows-app/DEPLOYED.txt
    chmod 700 ~/crows-app; chmod 600 ~/crows-app/config.php
    php ~/crows-app/install.php
    ls -1d ~/crows-backups/*/ | head -n -10 | xargs -r rm -rf"
  check_live
  echo "Promoted. Undo with: server/promote.sh --rollback"
  ;;

rollback)
  B=${BACKUP:-$(remote 'ls -1 ~/crows-backups | tail -1')}
  [ -n "$B" ] || { echo "No backups in ~/crows-backups." >&2; exit 1; }
  remote "test -d ~/crows-backups/$B" || { echo "No backup named $B." >&2; exit 1; }
  remote "cat ~/crows-backups/$B/crows-app/DEPLOYED.txt 2>/dev/null || true"
  confirm "Put backup $B back on PRODUCTION?"
  remote "set -e
    rsync -rlt $EXCL ~/crows-backups/$B/crows-app/ ~/crows-app/
    cp ~/crows-backups/$B/crows-app/DEPLOYED.txt ~/crows-app/ 2>/dev/null || true
    rsync -rlt $EXCL ~/crows-backups/$B/public_html-crows/ ~/public_html/crows/
    php ~/crows-app/install.php"
  check_live
  echo "Rolled back to $B."
  ;;
esac
