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

- Passwords are hashed with PHP's `password_hash`. Sessions are random tokens (only their SHA-256 is stored)
  in an HttpOnly, SameSite=Lax cookie that lasts 30 days. Writes need a JSON body and the session's CSRF token.
- Logins are rate-limited per username and IP; registrations and reset emails per IP/email.
- **HTTPS:** a Let's Encrypt certificate for joshuaramsey.com and www.joshuaramsey.com, issued by
  [acme.sh](https://github.com/acmesh-official/acme.sh) (installed in `~/.acme.sh`, source in `~/src/acme.sh`).
  Its cron job renews it automatically and installs the renewed certificate into cPanel through the
  `cpanel_uapi` deploy hook. `public/.htaccess` redirects /crows/ to HTTPS, and the session cookie is `Secure`.
  To check: `~/.acme.sh/acme.sh --list`. To renew by hand: `~/.acme.sh/acme.sh --renew -d joshuaramsey.com --force`.
