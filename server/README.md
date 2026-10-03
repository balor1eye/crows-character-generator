# The Nest: accounts site

Accounts, a home page, and server-side saves for the two apps, hosted on the cPanel site at
**https://joshuaramsey.com/crows/**. It's plain PHP 8.3 + MySQL with no packages or build step.

- **Visitors** can create an account, log in, reset a forgotten password by email, change their email or
  password, log out other devices, and delete their account. They can also skip all of that and use the
  apps as a guest, which keeps today's browser-only behavior.
- **Signing up** takes a code emailed to the new address; the account is made only once it's entered. If the
  address already has an account, its owner is emailed that instead and no code works, so the sign-up page never
  shows whether an email is in use. Changing a password or email cancels any reset link still out there.
- **Two-step login** (`app/mfa.php`) is optional and off by default; an account turns it on from its Account page
  (and can turn it off, with its password). For an account that has it on, a correct password (at login or after a
  password reset) never starts a session by itself, only a 15-minute challenge (30 for setup) whose token the page
  holds until the second factor is shown: a TOTP code (RFC 6238, one step of drift, each step usable once), an
  emailed 6-digit code, or a recovery code (stored hashed, each works once). A challenge allows 5 wrong codes,
  codes are also throttled per account, and emailed codes can be re-sent at most 5 times, 30 seconds apart.
  Authenticator secrets are encrypted with libsodium using `~/crows-app/mfa.key` (made on first use, chmod 600,
  never in git or deploys: losing it means everyone with an app sets it up again). The QR code is drawn in the
  page by `qrcode.js` (vendored, MIT; see `vendor/qrcode-generator-LICENSE.md`), so the secret never leaves the site.
- **Discord sign-in** (`app/discord.php`) is off until `discord_client_id` and `discord_client_secret` are in
  `config.php` (create an app at discord.com/developers/applications; under OAuth2 add the redirect
  `<site_url>api.php?a=discord.callback`). OAuth2 code flow with scopes `identify email`; the `state` is single-use,
  stored hashed, and also held in a cookie so only the browser that started the sign-in can finish it. A linked
  Discord account logs in (without the account's two-step code: Discord has its own). An unlinked one makes a new
  player account from Discord's verified email, with no password until the person uses "Forgot your password?"; if
  that email already has an account nothing is linked automatically, its owner connects Discord from the Account page.
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
