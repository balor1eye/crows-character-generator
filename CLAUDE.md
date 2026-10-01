# Project rules

## Deploying the accounts site (server/)

- **Deploy only to the test instance** (https://joshuaramsey.com/crows-test/) unless the user explicitly says to
  deploy to production for that change. `server/deploy.sh` does this by default.
- **Production** (https://joshuaramsey.com/crows/) gets changes by promoting the tested instance:
  1. `server/deploy.sh` (test instance)
  2. `python3 server/test_instance.py smoke` (and any checks specific to the change)
  3. `server/promote.sh --dry-run` to see what would change
  4. `server/promote.sh` only when the user asks to promote or push to production. It smoke-tests again, backs
     production up to `~/crows-backups/`, copies the test instance over, and checks the live API.
     `server/promote.sh --rollback` restores the newest backup.
- `server/deploy.sh --production` deploys straight to production without the test instance. Use it only when the
  user asks for exactly that.
- Never create test accounts on production. The test accounts (`test_admin`, `test_ref`, `test_player`,
  `test_player2`) exist only on the test instance. Use them through `server/test_instance.py`, not by typing their
  passwords into a browser.
- Rebuild `dist/` (build/build.py and ref/build/build.py) before deploying after any change to src/ or ref/src/.
