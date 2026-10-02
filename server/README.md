# The Nest: accounts site

Accounts, a home page, and server-side saves for the two apps, hosted on the cPanel site at
**https://joshuaramsey.com/crows/**. It's plain PHP 8.3 + MySQL with no packages or build step.

- **Visitors** can create an account, log in, reset a forgotten password by email, change their email or
  password, log out other devices, and delete their account. They can also skip all of that and use the
  apps as a guest, which keeps today's browser-only behavior.
- **Signing up** takes a code emailed to the new address; the account is made only once it's entered. If the
  address already has an account, its owner is emailed that instead and no code works, so the sign-up page never
  shows whether an email is in use. Changing a password or email cancels any reset link still out there.
- **Two-step login** is part of every account. While signing up, people pick an authenticator app (QR code,
  recommended) or a code emailed at each login, confirm it with a code, and save ten one-time recovery codes.
  Accounts made before this set it up at their next login. The Account page shows the method, switches it, and
  makes new recovery codes; an admin can reset it for someone who lost their phone and codes.
- **Home page** (after login): My characters (where new characters are created), Play, and for Refs the Ref Screen
  (campaigns), plus Manage accounts for admins.
- **Players** keep characters in their account (open, play, copy, download as .json, upload .json, delete).
  My characters also shows where each crow stands in campaigns: in play, sitting out, dead, retired, or lost
  (read from the Ref's party), asked to join, or recently declined.
  The Character Generator loads the character from the account and autosaves every change about a second
  later. A new character (Create a character in My characters, Random crow, Start over, Load file) isn't saved until the player
  presses **Save character** in the right column; from then on it autosaves too. Save file / Load file still work.
- **Refs** do the same with campaigns in the Ref Screen. `ref.php` only serves the Ref Screen to Refs and admins.
- **Sharing with a Ref:** a player opens **Share** on a character and sends the link to their Ref. The Ref opens
  it (or pastes it into the Ref Screen's Party tab) to add the crow to a campaign. The crow stays tied to the
  player's sheet. The Party tab's **Party status** shows each linked crow's live Play mode vitals, using the
  sheet's own buttons (Stamina, AD, damage and healing, wounds, conditions, cruelty, coins), and **Open sheet**
  shows the whole character. Either way the Ref can change only those vitals, equipment, notes, and XP (pending
  XP the Ref Screen awards, its history, and total XP when it's applied), plus what ending a dungeon turn or the party's
  rest changes on the sheet (the dungeon turn, expertise uses, lore book uses, pet Stamina, the last rest) and which of
  the player's XP claims the Ref has answered. The server applies just those fields,
  and only if they haven't changed underneath (log and XP history entries from both sides are combined).
  The player sees which Refs have access and can remove any of them, or turn the link off or replace it.
- **Handing a crow to someone else:** **Delegate Control** on a character in My characters gives control of it to another
  account (another player, or the Ref), say for a session the player will miss. If the crow is in a campaign, the
  player picks its Ref or one of the other players there (crows in play or sitting out) from a list; "Someone
  else…" (or no campaign) means typing a username, with Refs with access suggested. It shows up under **Handed to you** on their My characters and Play pages, and they can edit and play
  it and act with it in the Ref's fights, saving straight to the owner's sheet. They can't delete, copy, share, or
  pass it on. The owner keeps full access, sees "Handed to …" on the crow, and can **Take back control** any time;
  the other player can also **Hand back**. Each side is told in News, and a sheet still open on the other player's
  page stops saving within a second or two of being taken back (it never saves a copy). One account at a time.
  A Ref can also **Take control** of a linked crow that's in play or sitting out in one of their own campaigns
  (Party status tile, or More on its party card), without waiting to be handed it, but only once the player has ticked
  **Can take control of the whole sheet** next to that Ref in the crow's Share panel (off by default): the sheet opens for them as if
  the player had handed it over, and the player (and anyone it was handed to, who loses it) is told. The player
  takes it back as usual.
- **Inviting players to a campaign:** it also works the other way. On the Ref Screen's Party tab, **Invite players**
  makes a link to the campaign (replace it or turn it off there too). A player who opens it, logging in or signing
  up first if needed, picks one of their crows and asks to join, and can withdraw the request while it's waiting.
  The request shows up in the Ref Screen within a second or two, with a count on the Party tab. **Accept**
  gives the Ref the same access a character link would and adds the crow to the party; **Decline** lets the
  player ask again. A campaign holds at most 30 waiting requests.
- **Finding a campaign:** under Invite players a Ref can tick **List in Find a campaign** and add a short note
  (who they're looking for, when they play). Any logged-in player can then search listed campaigns from **Find a
  campaign** on the home page (by name, summary, note, or the Ref's username), open one, and ask to join exactly
  as through an invite link. Unticking it takes the campaign out of search; requests already made stay.
  Either way the player is told: a notice pops up within a second or two on any app page they have open (with a
  button to open the accepted crow), and it stays in **News** on their home page, with a count on Home, until
  they dismiss it. They're also emailed, unless they untick that under **Email notifications** on their Account page.
- **Admins** mark accounts as players or Refs, make other admins, make one-time password reset links (useful
  if email doesn't arrive), and delete accounts.
  Admins are emailed when someone creates an account (each admin can turn that off on their Account page).

## Layout on the server

```
~/crows-app/                 outside the web root (chmod 700)
  config.php                 DB credentials etc. Created on the server; never in git, never overwritten by deploys
  bootstrap.php, api.php     the API code
  schema.sql, install.php    creates the tables (safe to re-run)
  make_admin.php             php ~/crows-app/make_admin.php <username> [--remove]
  Crows_Ref_Screen.html      served by ref.php to Refs only
~/public_html/crows/         the web root for https://joshuaramsey.com/crows/
  index.html, portal.js/css  login, home, lists, account, admin
  api.php, ref.php           tiny entry points that load ~/crows-app
  Crows_Character_Generator.html   also served as play (Play mode), by a rewrite in .htaccess
  .htaccess                  runs PHP 8.3 here, security headers
```

## Deploying

Changes go to the test instance first and reach production only by promoting it:

```
python build/build.py && python ref/build/build.py
server/deploy.sh                    # 1. the test instance, https://joshuaramsey.com/crows-test/
python3 server/test_instance.py smoke   # 2. end-to-end check there
python3 ref/test/run_combat_test.py --test-instance   #    and a full combat encounter in the Ref Screen there
server/promote.sh --dry-run         # 3. what production would get
server/promote.sh                   # 4. copy the test instance to production
```

`deploy.sh` stages everything under `build/out/site/`, rsyncs it over SSH (the key must be loaded in your
ssh-agent), runs `install.php`, and records the commit in the app folder's `DEPLOYED.txt`. `server/stage.sh <dir>`
makes the same layout for local testing. `deploy.sh --production` deploys straight to production, skipping the test
instance; it's for emergencies.

Both instances run byte-identical files. The entry points find their app folder from their own folder name
(`public_html/crows` → `~/crows-app`, `public_html/crows-test` → `~/crows-test-app`), and the one `.htaccess` serves
both (each sends a noindex header, like the rest of joshuaramsey.com). So `promote.sh` copies the files server-side rather than rebuilding,
and production gets exactly what was tested. It:

1. shows what each instance runs (`DEPLOYED.txt`) and runs the smoke test (`--skip-smoke` to skip it),
2. asks for confirmation (`--yes` to skip),
3. backs up production's code to `~/crows-backups/<UTC time>/` (the last 10 are kept),
4. copies `~/crows-test-app` → `~/crows-app` and `public_html/crows-test` → `public_html/crows`, leaving out each
   instance's own `config.php`, keys, logs, `sync/` files, test accounts and `seed_test.php`,
5. runs `install.php` on production and checks that the live API answers.

`server/promote.sh --status` shows what each instance runs. `server/promote.sh --rollback [<backup>]` puts the
newest (or a named) backup back. Promotion adds and replaces files but never deletes any, and schema changes are
additive, so a rollback restores the code but not the database.

The deploy tools reuse one SSH connection (ControlMaster), because the host blocks port 22 for several minutes
after a burst of new connections.

## Test instance

A second copy at **https://joshuaramsey.com/crows-test/** for trying changes and testing end to end. It has its own
database (`joshuara_crowstest`), its own app folder (`~/crows-test-app`, with its own config.php, mfa.key and
sync.key), and a session cookie scoped to `/crows-test/`, so nothing in it touches the live site's accounts.
Its config sets `mail_log`, so it never sends email: every message (codes, reset links, notices) is appended to
`~/crows-test-app/mail.log` instead. Each smoke run clears its rate limits first (`seed_test.php --unthrottle`). One thing is shared: both copies are on
the same origin, so the apps' browser-only copies (localStorage) are too.

```
server/deploy.sh                              # stage and upload the test instance (the live site is untouched)
python3 server/test_instance.py reseed        # new passwords and authenticator secrets; add --wipe to clear all data
python3 server/test_instance.py smoke         # end-to-end check of the API as the test accounts
python3 server/test_instance.py call test_ref list kind=campaigns
python3 server/test_instance.py mail          # what it would have emailed
python3 ref/test/run_combat_test.py --test-instance   # a four-player fight in the Ref Screen (see ref/test/README.md)
python3 ref/test/run_live_combat_test.py             # a live fight between the Ref Screen and a player's Play page
python3 ref/test/run_live_rest_test.py               # the party's rest and XP claims between the two
```

`seed_test.php` (only staged for the test instance, and refusing to run unless config.php sets `test_instance`)
makes four accounts with authenticator-app two-step login: `test_admin` (admin), `test_ref`, `test_player`, and
`test_player2`, at `@example.invalid` addresses. Their passwords, TOTP secrets and recovery codes are in
`~/crows-test-app/test-accounts.json` (chmod 600), which `test_instance.py` reads over SSH; they're never in git.

## First admin

Register an account on the site, then run on the server:

```
php ~/crows-app/make_admin.php <your username>
```

## How saving works

`src/cloud.js` is built into both apps. When the page is served next to `api.php` and the visitor is logged
in, the open character or campaign is linked to a record in their account (`?id=N` in the URL). Changes are
sent a third of a second after they're made (at most 1.5 seconds later while you keep typing) and again when the page is
hidden. Every save carries a version number. If another window or device saved in the meantime, the app asks
which copy to keep instead of silently overwriting. When offline, it keeps retrying, and the browser copy
is always kept too. As a guest or offline, it does nothing.

Open copies see each other's changes (a player and their Ref, or two devices) about a second after they're
saved. Every save also rewrites a tiny static file, `sync/<hash>.txt`, holding the record's new version. Open
pages fetch it once a second, which the web server answers without PHP or the database, and load the record
only when the version moves. The name is an HMAC of the record under `~/crows-app/sync.key` (made on first
use), so only people the API has shown the record to know it, and the file reveals nothing but a number.
If the folder can't be written, pages fall back to asking the API every 10 seconds. The Ref Screen watches
its linked crows the same way, so their party entries follow the player's sheet. Nobody's page is replaced
while they're typing in a text field.
Concurrent edits merge three ways against the last version both sides had. Changes to different things just
combine, and only a change to the same thing on both sides asks which copy to keep.

Rerolling "Random crow" on a character nobody has edited yet replaces that save rather than piling up new
ones. Once a character has been edited, Random crow, Start over, and Load file start a new save and leave the
old one in the account.

## Security notes

- **Two-step login** (`app/mfa.php`): a correct password (at login, sign-up, or after a password reset) never
  starts a session by itself, only a 15-minute challenge (30 for setup) whose token the page holds until the
  second factor is shown: a TOTP code (RFC 6238, one step of drift, each step usable once), an emailed 6-digit
  code, or a recovery code (stored hashed, each works once). A challenge allows 5 wrong codes, codes are also
  throttled per account, and emailed codes can be re-sent at most 5 times, 30 seconds apart. Authenticator
  secrets are encrypted with libsodium using `~/crows-app/mfa.key` (made on first use, chmod 600, never in git
  or deploys: losing it means everyone with an app sets it up again). The QR code is drawn in the page by
  `qrcode.js` (vendored, MIT; see `vendor/qrcode-generator-LICENSE.md`), so the secret never leaves the site.
- **Passwords** are hashed with Argon2id (older hashes upgrade on the next login), must be 8+ characters, and
  can't be a very common password or the account's username/email. Unknown usernames take as long to reject
  as wrong passwords, so login timing doesn't reveal who has an account.
- **Sessions** are random tokens (only their SHA-256 is stored) in a `__Secure-` HttpOnly, SameSite=Lax cookie
  that lasts 30 days. Changing or resetting a password logs out other devices. Writes need a JSON body and the
  session's CSRF token.
- **Rate limits:** logins per username and IP, re-entering the current password (account changes/deletion),
  registrations per IP, and reset emails per address.
- **Notices:** changing the email tells the old address; changing the password tells the account's email.
- **Security log:** logins, failed logins, account changes, and admin actions, kept 180 days, shown on the admin
  page. It never records passwords, tokens, or the text of a failed login name.
- **Headers:** HTTPS only (HSTS), a Content-Security-Policy on every page (the apps' inline scripts are allowed
  by hash, computed at staging time by `server/csp.py`, so an injected script can't run), plus nosniff, frame,
  referrer, permissions, and cross-origin policies. Dotfiles and logs are never served.
- **Errors** go to `~/crows-app/php-errors.log`, outside the web root; this host's default would put an
  `error_log` file in the public folder.
- **Database user** has only SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, and REFERENCES on its own database.
- **Code and config** live outside the web root in `~/crows-app` (chmod 700; config.php 600).
- **HTTPS:** a Let's Encrypt certificate for joshuaramsey.com and www.joshuaramsey.com, issued by
  [acme.sh](https://github.com/acmesh-official/acme.sh) (installed in `~/.acme.sh`, source in `~/src/acme.sh`).
  A daily cron job renews it and installs it into cPanel through the `cpanel_uapi` deploy hook. The host has
  commented this cron line out once; if `crontab -l` shows it starting with `#`, re-enable it (or ask Site5
  support why). To check: `~/.acme.sh/acme.sh --list`. To renew by hand:
  `~/.acme.sh/acme.sh --renew -d joshuaramsey.com --force`.
- **Same account as the legacy sites:** everything on this cPanel account runs as one Unix user, so a hole in any
  other app on it (see the security review) exposes `~/crows-app/config.php` too.
