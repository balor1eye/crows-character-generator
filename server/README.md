# Crows accounts site

Accounts, a home page, and server-side saves for the two apps, hosted on the cPanel site at
**https://joshuaramsey.com/crows/**. It's plain PHP 8.3 + MySQL with no packages or build step.

- **Visitors** can create an account, log in, reset a forgotten password by email, change their email or
  password, log out other devices, and delete their account. They can also skip all of that and use the
  apps as a guest, which keeps today's browser-only behavior.
- **Home page** (after login): Create a character, My characters, Play, and for Refs the Ref Screen
  (campaigns), plus Manage accounts for admins.
- **Players** keep characters in their account (open, play, copy, download as .json, upload .json, delete).
  The Character Generator loads the character from the account and autosaves every change about a second
  later. Save file / Load file still work.
- **Refs** do the same with campaigns in the Ref Screen. `ref.php` only serves the Ref Screen to Refs and admins.
- **Admins** mark accounts as players or Refs, make other admins, make one-time password reset links (useful
  if email doesn't arrive), and delete accounts.

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
  Crows_Character_Generator.html
  .htaccess                  runs PHP 8.3 here, security headers
```

## Deploying

```
python build/build.py && python ref/build/build.py
server/deploy.sh
```

`deploy.sh` stages everything under `build/out/site/`, rsyncs it over SSH (the key must be loaded in your
ssh-agent), and runs `install.php`. `server/stage.sh <dir>` makes the same layout for local testing.

## First admin

Register an account on the site, then run on the server:

```
php ~/crows-app/make_admin.php <your username>
```

## How saving works

`src/cloud.js` is built into both apps. When the page is served next to `api.php` and the visitor is logged
in, the open character or campaign is linked to a record in their account (`?id=N` in the URL). Changes are
sent a moment after they're made (at most 8 seconds later while you keep typing) and again when the page is
hidden. Every save carries a version number. If another window or device saved in the meantime, the app asks
which copy to keep instead of silently overwriting. When offline, it keeps retrying, and the browser copy
is always kept too. As a guest, offline, or on GitHub Pages, it does nothing.

Rerolling "Random crow" on a character nobody has edited yet replaces that save rather than piling up new
ones. Once a character has been edited, Random crow, Start over, and Load file start a new save and leave the
old one in the account.

## Security notes

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
