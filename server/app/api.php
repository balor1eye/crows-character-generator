<?php
/*
 * The Nest accounts JSON API. Reached through public/api.php?a=<action>.
 *
 * Reads are GET, writes are POST with a JSON body. Every POST must be application/json (so a
 * cross-site form can't forge one), and once logged in it must also carry the session's CSRF
 * token in the X-CSRF-Token header. Responses are {ok: true, ...} or {ok: false, error: "..."}.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';
require __DIR__ . '/mfa.php';
require __DIR__ . '/discord.php';
require __DIR__ . '/chat.php';

final class ApiError extends Exception {
    public int $status;
    public array $extra;
    public function __construct(string $msg, int $status = 400, array $extra = []) {
        parent::__construct($msg);
        $this->status = $status;
        $this->extra = $extra;
    }
}

function fail(string $msg, int $status = 400, array $extra = []): never { throw new ApiError($msg, $status, $extra); }

function raw_body(): string {
    static $raw = null;
    return $raw ??= (string)file_get_contents('php://input', false, null, 0, (($_GET['a'] ?? '') === 'map.detect' ? 6500000 : MAX_DATA_BYTES) + 100000);
}
function body(): array {
    static $b = null;
    if ($b !== null) return $b;
    $raw = raw_body();
    $b = $raw === '' ? [] : json_decode($raw, true, 64);
    if (!is_array($b)) fail('The request was not valid JSON.');
    return $b;
}
/**
 * The body decoded with objects kept as objects. Saves go through this so an empty {} stays {} instead of
 * turning into [] (which the apps would then fill with named keys that JSON.stringify silently drops).
 */
function body_obj(): object {
    static $o = null;
    if ($o !== null) return $o;
    $o = json_decode(raw_body(), false, 64);
    if (!is_object($o)) fail('The request was not valid JSON.');
    return $o;
}
function enc($v): string { return json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES); }

function str(string $key, int $max = 500): string {
    $v = body()[$key] ?? '';
    if (!is_string($v)) fail("Bad value for $key.");
    if (strlen($v) > $max) fail("$key is too long.");
    return $v;
}

function need_login(): array {
    $s = current_session();
    if (!$s) fail('Please log in again.', 401);
    return $s;
}

function need_admin(): array {
    $s = need_login();
    if (!$s['is_admin']) fail('Only an admin can do that.', 403);
    return $s;
}

// ---------------------------------------------------------------- validation
function valid_username(string $u): string {
    $u = trim($u);
    if (!preg_match('/^[A-Za-z0-9_.-]{3,32}$/', $u)) fail('Usernames are 3 to 32 letters, numbers, dots, dashes, or underscores.');
    return $u;
}
function valid_email(string $e): string {
    $e = trim($e);
    if (strlen($e) > 190 || !filter_var($e, FILTER_VALIDATE_EMAIL)) fail('Please enter a valid email address.');
    return $e;
}
// Among the most-used passwords in breach lists; NIST SP 800-63B says to refuse known-bad passwords.
const COMMON_PASSWORDS = ['12345678', '123456789', '1234567890', '12345678910', '87654321', '11111111', '00000000', '88888888',
    '123123123', '11223344', 'password', 'password1', 'password12', 'password123', 'passw0rd', 'p@ssw0rd', 'p@ssword',
    'qwertyui', 'qwerty123', 'qwertyuiop', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx', 'asdfghjk', 'asdfasdf', 'abcd1234',
    'abc12345', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball', 'welcome1', 'letmein1', 'trustno1',
    'superman', 'starwars', 'dragon12', 'computer', 'whatever', 'michelle', 'jennifer', 'corvette', 'mercedes',
    'changeme', 'internet', 'administrator', 'admin123', 'test1234', 'monkey12', 'shadow12', 'master12', 'crows123',
    'crowscrows', 'playtest', 'dungeons', 'dungeonmaster'];

function valid_password(string $p, string $username = '', string $email = ''): string {
    if (mb_strlen($p) < 8) fail('Passwords need at least 8 characters.');
    if (strlen($p) > 200) fail('That password is too long.');
    $low = mb_strtolower($p);
    if (in_array($low, COMMON_PASSWORDS, true) || preg_match('/^(.)\1+$/u', $p)) fail('That password is too common. Please choose another.');
    if (($username !== '' && $low === mb_strtolower($username)) || ($email !== '' && $low === mb_strtolower($email))) fail('Your password can\'t be your username or email.');
    return $p;
}
/** Re-checks the password for sensitive changes; failures are throttled like logins. */
function check_password(array $s, string $pw): void {
    $key = 'pw:' . $s['id'];
    throttle($key, 5, 30, 900);
    $row = q('SELECT pass_hash FROM users WHERE id = ?', [$s['id']])->fetch();
    if ($row && $row['pass_hash'] === '') fail('This account signs in with Discord and has no password yet. Use "Forgot your password?" on the log-in page to set one first.', 409);
    if (!$row || !password_verify($pw, $row['pass_hash'])) {
        note_attempt($key);
        audit('password_check_failed', $s['id']);
        fail('Your current password is not correct.', 403);
    }
}
// Verifying against this when the account doesn't exist keeps login timing the same either way.
function dummy_hash(): string { static $h = null; return $h ??= hash_password('not-a-real-password-' . token()); }

// ---------------------------------------------------------------- rate limits
function throttle(string $login, int $maxPerLogin, int $maxPerIp, int $window): void {
    $since = now(-$window);
    q('DELETE FROM login_attempts WHERE at < ?', [now(-86400)]);
    $byIp = (int)q('SELECT COUNT(*) FROM login_attempts WHERE ip = ? AND at >= ?', [client_ip(), $since])->fetchColumn();
    $byLogin = (int)q('SELECT COUNT(*) FROM login_attempts WHERE login = ? AND at >= ?', [$login, $since])->fetchColumn();
    if ($byIp >= $maxPerIp || $byLogin >= $maxPerLogin) fail('Too many attempts. Please wait a few minutes and try again.', 429);
}
function note_attempt(string $login): void {
    q('INSERT INTO login_attempts (ip, login, at) VALUES (?,?,?)', [client_ip(), $login, now()]);
}

// ---------------------------------------------------------------- mail
function send_mail(string $to, string $subject, string $text): bool {
    $c = config();
    // Test instance: write the message to a file instead of sending it (codes and links can be read there).
    if (!empty($c['mail_log'])) {
        $ok = @file_put_contents($c['mail_log'], json_encode(['at' => now(), 'to' => $to, 'subject' => $subject, 'text' => $text],
            JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES) . "\n", FILE_APPEND | LOCK_EX);
        return $ok !== false;
    }
    $from = $c['mail_from'] ?? '';
    // Subjects can carry names players typed: no line breaks (they'd start new headers), and encoded for UTF-8.
    $subject = mb_encode_mimeheader(trim(preg_replace('/[\r\n\t]+/', ' ', $subject)), 'UTF-8', 'Q');
    $headers = "Content-Type: text/plain; charset=UTF-8\r\n" . ($from ? "From: The Nest <$from>\r\n" : '');
    try { return @mail($to, $subject, $text, $headers, $from ? '-f' . $from : ''); }
    catch (Throwable $e) { error_log('crows mail: ' . $e->getMessage()); return false; }
}
function site_link(string $path = ''): string { return rtrim(config()['site_url'], '/') . '/' . $path; }

// Optional emails, each of which the user can turn off on their Account page (email_prefs; no row = all on).
const EMAIL_PREFS = ['joinDecisions' => 'join_decisions', 'newAccounts' => 'new_accounts', 'joinRequests' => 'join_requests', 'controlChanges' => 'control_changes', 'chatAlerts' => 'chat_alerts'];
function email_prefs(int $userId): array {
    $r = q('SELECT ' . implode(', ', EMAIL_PREFS) . ' FROM email_prefs WHERE user_id = ?', [$userId])->fetch();
    $out = [];
    foreach (EMAIL_PREFS as $k => $col) $out[$k] = $r ? (bool)$r[$col] : true;
    return $out;
}
function wants_email(int $userId, string $pref): bool {
    try { return email_prefs($userId)[$pref]; } catch (Throwable $e) { return true; }
}
function prefs_footer(): string {
    return "\n--\nTo stop these emails, untick them on your Account page: " . site_link('#account') . "\n";
}

/** Tell the admins (who want it) that someone made an account. Never fails the registration. */
function mail_admins_new_account(string $username, string $email): void {
    try {
        $total = (int)q('SELECT COUNT(*) FROM users')->fetchColumn();
        foreach (q('SELECT id, username, email FROM users WHERE is_admin = 1')->fetchAll() as $a) {
            if (!wants_email((int)$a['id'], 'newAccounts')) continue;
            send_mail($a['email'], "New account on The Nest: $username",
                "Hi {$a['username']},\n\nSomeone just created an account on The Nest.\n\n" .
                "Username: $username\nEmail: $email\nAccounts now: $total\n\n" .
                "New accounts are players. To make one a Ref, or to remove it, use Manage accounts:\n" . site_link('#admin') . "\n" . prefs_footer());
        }
    } catch (Throwable $e) { error_log('crows admin mail: ' . $e->getMessage()); }
}
function reset_link(int $userId, int $hours): string {
    $tok = token();
    q('DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?', [$userId, now()]);
    q('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?,?,?)', [sha($tok), $userId, now($hours * 3600)]);
    return rtrim(config()['site_url'], '/') . '/#reset=' . $tok;
}

// ---------------------------------------------------------------- auth actions
function a_me(): array {
    $s = current_session();
    $notes = 0;
    try { if ($s) $notes = (int)q('SELECT COUNT(*) FROM notifications WHERE user_id = ? AND seen_at IS NULL', [$s['id']])->fetchColumn(); }
    catch (Throwable $e) { /* table not there yet mid-deploy: never block logging in over it */ }
    return ['user' => $s ? public_user($s) : null, 'csrf' => $s ? $s['csrf'] : null, 'https' => is_https(), 'notes' => $notes, 'discord' => discord_enabled()];
}

/*
 * Creating an account takes two steps. register checks the username and password and emails a 6-digit code to the
 * address; register.verify with that code makes the account and signs in. If the
 * address already has an account, its owner is emailed that instead and no code works, but the answer is the same,
 * so signing up never shows whether an email is in use. (Usernames are shown to other players, so a taken one
 * is still said straight away.)
 */
const SIGNUP_TTL = 1800;

function a_register(): array {
    $username = valid_username(str('username', 64));
    $email = valid_email(str('email', 300));
    $pw = valid_password(str('password', 300), $username, $email);
    throttle('register', 1000, 10, 3600);
    throttle('signup:' . strtolower($email), 3, 1000, 3600);
    note_attempt('register');
    note_attempt('signup:' . strtolower($email));
    if (q('SELECT 1 FROM users WHERE username = ?', [$username])->fetch()) fail('That username is taken.', 409);
    $hash = hash_password($pw);
    $existing = q('SELECT id, username, email FROM users WHERE email = ?', [$email])->fetch();
    q('DELETE FROM pending_signups WHERE expires_at < ?', [now()]);
    $tok = token();
    q('INSERT INTO pending_signups (token_hash, username, email, pass_hash, existing_user_id, expires_at) VALUES (?,?,?,?,?,?)',
      [sha($tok), $username, $email, $hash, $existing ? (int)$existing['id'] : null, now(SIGNUP_TTL)]);
    signup_send(signup_row($tok));
    return ['verify' => ['token' => $tok, 'email' => mask_email($email)]];
}

function signup_row(string $tok): array {
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) fail('That sign-up has expired. Please start again.', 401);
    $r = q('SELECT * FROM pending_signups WHERE token_hash = ?', [sha($tok)])->fetch();
    if (!$r || $r['expires_at'] < now()) fail('That sign-up has expired. Please start again.', 401);
    return $r;
}
/** Email the sign-up's code, or, when the address already has an account, tell its owner (with no code). */
function signup_send(array $r): void {
    if ((int)$r['sends'] >= MFA_MAX_SENDS) fail('Too many codes sent. Please start again later.', 429);
    if ($r['code_sent_at'] && strtotime($r['code_sent_at'] . ' UTC') > time() - 30) fail('A code was just sent. Wait half a minute before asking for another.', 429);
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    q('UPDATE pending_signups SET code_hash = ?, code_sent_at = ?, sends = sends + 1 WHERE token_hash = ?',
      [$r['existing_user_id'] ? null : sha($r['token_hash'] . $code), now(), $r['token_hash']]);
    if ($r['existing_user_id']) {
        $u = q('SELECT username FROM users WHERE id = ?', [$r['existing_user_id']])->fetch();
        if ((int)$r['sends'] === 0 && $u) send_mail($r['email'], 'Someone tried to sign up to The Nest with your email',
            "Hi {$u['username']},\n\nSomeone just tried to create a new account on The Nest with this email address, but you already have one " .
            "(username: {$u['username']}).\n\nIf that was you, log in instead, or reset your password if you've forgotten it:\n" . site_link('#forgot') .
            "\n\nIf it wasn't you, you can ignore this email. Nothing was changed.\n");
        return;
    }
    send_mail($r['email'], "Your code for The Nest: $code",
        "Hi {$r['username']},\n\nTo finish creating your account on The Nest, enter this code:\n\n    $code\n\n" .
        "It works for 30 minutes. If you didn't try to create an account, you can ignore this email.\n");
}

/** The emailed code is right: make the account and sign in. */
function a_register_verify(): array {
    $r = signup_row(str('token', 100));
    throttle('signupcode:' . strtolower($r['email']), 10, 30, 900);
    $code = clean_code(str('code', 40));
    $ok = preg_match('/^[0-9]{6}$/', $code) && $r['code_hash'] && hash_equals($r['code_hash'], sha($r['token_hash'] . $code));
    if (!$ok) {
        note_attempt('signupcode:' . strtolower($r['email']));
        if ((int)$r['attempts'] + 1 >= MFA_MAX_TRIES) {
            q('DELETE FROM pending_signups WHERE token_hash = ?', [$r['token_hash']]);
            fail('Too many wrong codes. Please start again.', 401);
        }
        q('UPDATE pending_signups SET attempts = attempts + 1 WHERE token_hash = ?', [$r['token_hash']]);
        fail('That code is not right. Check it and try again.', 400);
    }
    q('DELETE FROM pending_signups WHERE token_hash = ?', [$r['token_hash']]);
    if (q('SELECT 1 FROM users WHERE username = ? OR email = ?', [$r['username'], $r['email']])->fetch()) {
        fail('Someone took that username while you were confirming your email. Please start again with another.', 409);
    }
    q('INSERT INTO users (username, email, pass_hash, role, is_admin, created_at) VALUES (?,?,?,?,0,?)',
      [$r['username'], $r['email'], $r['pass_hash'], 'player', now()]);
    $id = (int)db()->lastInsertId();
    audit('register', $id, $r['username']);
    mail_admins_new_account($r['username'], $r['email']);
    q('DELETE FROM pending_signups WHERE email = ?', [$r['email']]);
    return mfa_gate(q('SELECT * FROM users WHERE id = ?', [$id])->fetch());
}

function a_register_resend(): array {
    signup_send(signup_row(str('token', 100)));
    return [];
}

function a_login(): array {
    $login = trim(str('login', 300));
    $pw = str('password', 300);
    if ($login === '' || $pw === '') fail('Enter your username (or email) and password.');
    $key = strtolower($login);
    throttle($key, 8, 30, 900);
    $u = q('SELECT * FROM users WHERE username = ? OR email = ?', [$login, $login])->fetch();
    $ok = password_verify($pw, $u ? $u['pass_hash'] : dummy_hash());
    if (!$u || !$ok) {
        note_attempt($key);
        audit('login_failed', $u ? (int)$u['id'] : null, $u ? '' : 'unknown account');
        fail('That username or password is not correct.', 401);
    }
    if (password_needs_rehash($u['pass_hash'], pw_algo())) {
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [hash_password($pw), $u['id']]);
    }
    audit('login_password', (int)$u['id']);
    q('DELETE FROM login_attempts WHERE login = ?', [$key]);
    return mfa_gate($u);   // a session now, or a challenge when the account turned two-step login on (mfa.php)
}

function a_logout(): array { end_session(); return []; }

function a_forgot(): array {
    $email = valid_email(str('email', 300));
    throttle('forgot:' . strtolower($email), 3, 10, 3600);
    note_attempt('forgot:' . strtolower($email));
    $u = q('SELECT id, username, email FROM users WHERE email = ?', [$email])->fetch();
    if ($u) {
        audit('reset_requested', (int)$u['id']);
        $link = reset_link((int)$u['id'], 2);
        send_mail($u['email'], 'Reset your password for The Nest',
            "Hi {$u['username']},\n\nSomeone (hopefully you) asked to reset the password for your account on The Nest.\n" .
            "Open this link within 2 hours to choose a new one:\n\n$link\n\nIf you didn't ask for this, you can ignore this email.\n");
    }
    // Same answer either way, so this can't be used to find out who has an account.
    return ['message' => 'If an account uses that email, a reset link is on its way. Check your spam folder too.'];
}

function a_reset(): array {
    $tok = str('token', 100);
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) fail('That reset link is not valid.');
    $row = q('SELECT r.user_id, r.expires_at, u.username, u.email FROM password_resets r JOIN users u ON u.id = r.user_id WHERE r.token_hash = ?', [sha($tok)])->fetch();
    if (!$row || $row['expires_at'] < now()) fail('That reset link has expired. Ask for a new one.', 410);
    $pw = valid_password(str('password', 300), $row['username'], $row['email']);
    $uid = (int)$row['user_id'];
    q('UPDATE users SET pass_hash = ? WHERE id = ?', [hash_password($pw), $uid]);
    audit('password_reset', $uid);
    q('DELETE FROM password_resets WHERE user_id = ?', [$uid]);
    q('DELETE FROM sessions WHERE user_id = ?', [$uid]);
    // A reset link proves the mailbox, not the second factor: when the account has one, that still has to be shown (mfa.php).
    return mfa_gate(q('SELECT * FROM users WHERE id = ?', [$uid])->fetch());
}

// ---------------------------------------------------------------- account
function a_account_update(): array {
    $s = need_login();
    check_password($s, str('currentPassword', 300));
    $email = body()['email'] ?? null;
    $newPw = body()['newPassword'] ?? null;
    if (is_string($email) && trim($email) !== $s['email']) {
        $email = valid_email($email);
        if (q('SELECT 1 FROM users WHERE email = ? AND id <> ?', [$email, $s['id']])->fetch()) fail('Another account already uses that email.', 409);
        q('UPDATE users SET email = ? WHERE id = ?', [$email, $s['id']]);
        q('DELETE FROM password_resets WHERE user_id = ?', [$s['id']]);   // links sent to the old address stop working
        audit('email_changed', $s['id']);
        // Tell the old address, so a hijacked account doesn't go unnoticed.
        send_mail($s['email'], 'Your email on The Nest was changed',
            "Hi {$s['username']},\n\nThe email on your account on The Nest was just changed to $email.\n" .
            "If you didn't do this, contact the site admin right away.\n");
    }
    if (is_string($newPw) && $newPw !== '') {
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [hash_password(valid_password($newPw, $s['username'], (string)($email ?: $s['email']))), $s['id']]);
        // A new password signs out every other device.
        q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s['id'], $s['token_hash']]);
        q('DELETE FROM password_resets WHERE user_id = ?', [$s['id']]);   // and so does any reset link still out there
        audit('password_changed', $s['id']);
        send_mail(is_string($email) && $email !== '' ? $email : $s['email'], 'Your password for The Nest was changed',
            "Hi {$s['username']},\n\nThe password on your account on The Nest was just changed, and your other devices were logged out.\n" .
            "If you didn't do this, reset your password and contact the site admin.\n");
    }
    return ['user' => public_user(q('SELECT * FROM users WHERE id = ?', [$s['id']])->fetch())];
}

function a_account_email_prefs(): array {
    $s = need_login();
    return ['prefs' => email_prefs($s['id'])];
}
function a_account_set_email_prefs(): array {
    $s = need_login();
    $cur = email_prefs($s['id']);
    foreach (EMAIL_PREFS as $k => $col) if (array_key_exists($k, body())) $cur[$k] = (bool)body()[$k];
    q('REPLACE INTO email_prefs (user_id, ' . implode(', ', EMAIL_PREFS) . ') VALUES (?' . str_repeat(',?', count(EMAIL_PREFS)) . ')',
      array_merge([$s['id']], array_map(fn($k) => (int)$cur[$k], array_keys(EMAIL_PREFS))));
    return ['prefs' => $cur];
}

function a_account_logout_others(): array {
    $s = need_login();
    q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s['id'], $s['token_hash']]);
    audit('logout_others', $s['id']);
    return [];
}

function a_account_delete(): array {
    $s = need_login();
    check_password($s, str('password', 300));
    if ($s['is_admin'] && (int)q('SELECT COUNT(*) FROM users WHERE is_admin = 1')->fetchColumn() <= 1) {
        fail('You are the only admin. Make someone else an admin before deleting your account.', 409);
    }
    audit('account_deleted', $s['id'], $s['username']);
    q('DELETE FROM users WHERE id = ?', [$s['id']]);   // cascades to sessions, characters, campaigns
    set_session_cookie('', time() - 3600);
    return [];
}

// ---------------------------------------------------------------- characters & campaigns
function kind(): string {
    $k = $_GET['kind'] ?? '';
    if ($k !== 'characters' && $k !== 'campaigns') fail('Unknown kind.');
    return $k;
}
/** Logged-in user allowed to use this kind: characters for everyone, campaigns for Refs. */
function owner_for(string $kind): array {
    $s = need_login();
    if ($kind === 'campaigns' && !can_ref($s)) fail('Only Refs can keep campaigns.', 403);
    return $s;
}
function record_id(): int {
    $id = body()['id'] ?? ($_GET['id'] ?? 0);
    if (!is_numeric($id) || (int)$id <= 0) fail('Missing id.');
    return (int)$id;
}
function record_data(): string {
    $d = body_obj()->data ?? null;
    if (!is_object($d)) fail('Missing save data.');
    $json = enc($d);
    if ($json === false) fail('Could not store that save.');
    if (strlen($json) > MAX_DATA_BYTES) fail('That save is too large to store (2 MB limit).', 413);
    return $json;
}
function clip(string $s, int $n): string { return mb_substr(trim(preg_replace('/\s+/', ' ', $s)), 0, $n); }
function row_out(array $r, bool $withData = false): array {
    $o = ['id' => (int)$r['id'], 'name' => $r['name'], 'summary' => $r['summary'], 'version' => (int)$r['version'],
          'createdAt' => $r['created_at'] . 'Z', 'updatedAt' => $r['updated_at'] . 'Z'];
    if (isset($r['draft'])) $o['draft'] = (int)$r['draft'] === 1;   // a crow still being built (characters only)
    if ($withData) $o['data'] = json_decode($r['data']);   // objects stay objects, so {} is sent back as {}
    return $o;
}

// ---------------------------------------------------------------- change signals
/*
 * Open pages notice changes made elsewhere (another device, the player, their Ref) by fetching a tiny static
 * file, sync/<name>.txt, about once a second. It holds the record's version and is rewritten on every save.
 * The web server answers that without running PHP or opening a database connection, so checking that often
 * costs next to nothing, and a change shows up on the other side about a second after it's saved.
 * The name is a keyed hash of the record, given only to people who may open it; the file holds just the version.
 */
function sync_dir(): string { return dirname($_SERVER['SCRIPT_FILENAME']) . '/sync'; }
function sync_key(): string {
    static $key = null;
    if ($key !== null) return $key;
    $f = __DIR__ . '/sync.key';
    $h = @fopen($f, 'x');   // only one request ever creates it, so every page gets the same names
    if ($h) { fwrite($h, token()); fclose($h); chmod($f, 0600); }
    $key = (string)@file_get_contents($f);
    if (strlen($key) < 32) throw new RuntimeException('sync.key is unreadable');
    return $key;
}
function sync_file(string $k, int $id): string { return substr(hash_hmac('sha256', "$k:$id", sync_key()), 0, 32) . '.txt'; }
/** Record that $k #$id is now at $version. Never fails a save: without it pages just notice more slowly. */
function signal(string $k, int $id, int $version): void {
    try {
        $dir = sync_dir();
        if (!is_dir($dir) && !@mkdir($dir, 0755) && !is_dir($dir)) return;
        $h = @fopen("$dir/" . sync_file($k, $id), 'c+');
        if (!$h) return;
        flock($h, LOCK_EX);
        if ((int)stream_get_contents($h) < $version) { ftruncate($h, 0); rewind($h); fwrite($h, (string)$version); }   // never go backwards
        fclose($h);
    } catch (Throwable $e) { error_log('crows signal: ' . $e->getMessage()); }
}
function unsignal(string $k, int $id): void {
    try { @unlink(sync_dir() . '/' . sync_file($k, $id)); } catch (Throwable $e) { /* ignore */ }
}
/** $o with the file to watch for changes to $k #$id (relative to the app), or without it if signals don't work here. */
function with_watch(array $o, string $k, int $id): array {
    try {
        $f = sync_file($k, $id);
        if (!is_file(sync_dir() . "/$f")) signal($k, $id, $o['version']);
        if (is_file(sync_dir() . "/$f")) $o['watch'] = "sync/$f";
    } catch (Throwable $e) { error_log('crows watch: ' . $e->getMessage()); }
    return $o;
}

function a_list(): array {
    $k = kind(); $s = owner_for($k);
    if ($k === 'characters') {
        $rows = q('SELECT c.id, c.name, c.summary, c.version, c.draft, c.created_at, c.updated_at, u.username AS controller FROM characters c
                   LEFT JOIN character_control k ON k.character_id = c.id LEFT JOIN users u ON u.id = k.user_id
                   WHERE c.user_id = ? ORDER BY c.updated_at DESC', [$s['id']])->fetchAll();
        return ['items' => array_map(function ($r) { return row_out($r) + ['controller' => $r['controller']]; }, $rows)];
    }
    $rows = q("SELECT id, name, summary, version, created_at, updated_at FROM $k WHERE user_id = ? ORDER BY updated_at DESC", [$s['id']])->fetchAll();
    return ['items' => array_map('row_out', $rows)];
}

/**
 * May $s open and save $k #$id? A campaign only its Ref; a character its owner, or whoever the owner handed
 * control to (character_control). Returns ['owner' => the owner's username when $s is that someone else,
 * 'controller' => who has control when $s is the owner]. Anyone else is told it wasn't found.
 */
function record_access(string $k, array $s, int $id): array {
    if ($k === 'campaigns') {
        if ((int)q('SELECT user_id FROM campaigns WHERE id = ?', [$id])->fetchColumn() !== $s['id']) fail('That save was not found. It may have been deleted.', 404);
        return ['owner' => null, 'controller' => null];
    }
    $r = q('SELECT c.user_id, o.username AS owner, k.user_id AS ctl_id, u.username AS ctl FROM characters c JOIN users o ON o.id = c.user_id
            LEFT JOIN character_control k ON k.character_id = c.id LEFT JOIN users u ON u.id = k.user_id WHERE c.id = ?', [$id])->fetch();
    if ($r && (int)$r['user_id'] === $s['id']) return ['owner' => null, 'controller' => $r['ctl']];
    if ($r && (int)$r['ctl_id'] === $s['id']) return ['owner' => $r['owner'], 'controller' => $r['ctl']];
    fail('That save was not found, or its player has taken back control of it.', 404);
}
function with_access(array $o, array $acc): array {
    if ($acc['owner'] !== null) $o['owner'] = $acc['owner'];
    if ($acc['controller'] !== null) $o['controller'] = $acc['controller'];
    return $o;
}

function a_get(): array {
    $k = kind(); $s = owner_for($k);
    $id = record_id();
    $acc = record_access($k, $s, $id);
    $known = (int)($_GET['known'] ?? 0);
    if ($known) {
        // Polling: answer "unchanged" without sending the whole save.
        $v = q("SELECT version FROM $k WHERE id = ?", [$id])->fetchColumn();
        if ($v === false) fail('That save was not found. It may have been deleted.', 404);
        if ((int)$v === $known) return ['item' => ['id' => $id, 'version' => $known, 'unchanged' => true]];
    }
    $r = q("SELECT * FROM $k WHERE id = ?", [$id])->fetch();
    if (!$r) fail('That save was not found. It may have been deleted.', 404);
    return ['item' => with_watch(with_access(row_out($r, true), $acc), $k, $id)];
}

function a_create(): array {
    $k = kind(); $s = owner_for($k);
    $data = record_data();
    if ((int)q("SELECT COUNT(*) FROM $k WHERE user_id = ?", [$s['id']])->fetchColumn() >= MAX_RECORDS) {
        fail('You have reached the limit of ' . MAX_RECORDS . ' saves. Delete some old ones first.', 409);
    }
    q("INSERT INTO $k (user_id, name, summary, data, version, created_at, updated_at) VALUES (?,?,?,?,1,?,?)",
      [$s['id'], clip(str('name', 1000), 120), clip(str('summary', 2000), 255), $data, now(), now()]);
    $new = (int)db()->lastInsertId();
    if ($k === 'characters' && !empty(body()['draft'])) q('UPDATE characters SET draft = 1 WHERE id = ?', [$new]);   // still being built
    $r = q("SELECT * FROM $k WHERE id = ?", [$new])->fetch();
    return ['item' => with_watch(row_out($r), $k, (int)$r['id'])];
}

function a_save(): array {
    $k = kind(); $s = owner_for($k);
    $id = record_id();
    $data = record_data();
    $acc = record_access($k, $s, $id);
    $force = !empty(body()['force']);
    $base = body()['version'] ?? 0;
    $args = [$data, clip(str('name', 1000), 120), clip(str('summary', 2000), 255), now(), $id];
    $sql = "UPDATE $k SET data = ?, name = ?, summary = ?, version = version + 1, updated_at = ? WHERE id = ?";
    // The owner can finish a draft crow (or reopen it): `draft` is sent only then.
    if ($k === 'characters' && $acc['owner'] === null && array_key_exists('draft', body())) {
        $sql = str_replace(' version = version + 1,', ' version = version + 1, draft = ' . (empty(body()['draft']) ? 0 : 1) . ',', $sql);
    }
    if (!$force) { $sql .= ' AND version = ?'; $args[] = (int)$base; }
    $n = q($sql, $args)->rowCount();
    $r = q('SELECT id, name, summary, version, created_at, updated_at' . ($k === 'characters' ? ', draft' : '') . " FROM $k WHERE id = ?", [$id])->fetch();
    if (!$r) fail('That save was not found. It may have been deleted.', 404);
    if ($n === 0 && !$force && (int)$r['version'] !== (int)$base) {
        fail('This was changed in another window or device.', 409, ['item' => row_out($r)]);
    }
    if ($n) signal($k, $id, (int)$r['version']);
    return ['item' => with_watch(with_access(row_out($r), $acc), $k, $id)];
}

function a_duplicate(): array {
    $k = kind(); $s = owner_for($k);
    if ((int)q("SELECT COUNT(*) FROM $k WHERE user_id = ?", [$s['id']])->fetchColumn() >= MAX_RECORDS) fail('You have reached the save limit.', 409);
    $r = q("SELECT * FROM $k WHERE id = ? AND user_id = ?", [record_id(), $s['id']])->fetch();
    if (!$r) fail('That save was not found.', 404);
    q("INSERT INTO $k (user_id, name, summary, data, version, created_at, updated_at) VALUES (?,?,?,?,1,?,?)",
      [$s['id'], clip($r['name'] . ' (copy)', 120), $r['summary'], $r['data'], now(), now()]);
    return ['item' => row_out(q("SELECT * FROM $k WHERE id = ?", [(int)db()->lastInsertId()])->fetch())];
}

function a_delete(): array {
    $k = kind(); $s = owner_for($k);
    $id = record_id();
    if (q("DELETE FROM $k WHERE id = ? AND user_id = ?", [$id, $s['id']])->rowCount()) unsignal($k, $id);
    return [];
}

// ---------------------------------------------------------------- sharing characters with a Ref
/*
 * A player makes a link for one of their characters and sends it to their Ref. A Ref who opens it adds the
 * character to a campaign, which creates a character_access row. With it the Ref can read the whole
 * character and change only what a Ref runs at the table: the Play mode vitals (Stamina, wounds, conditions,
 * cruelty, coins, and the log those buttons write to), equipment (which carries armor damage), notes, and XP
 * (the treasure XP the Ref awards, its history, and total XP when pending XP is applied).
 * link.save merges just those fields. The player sees who has access and can remove it; deleting the
 * character removes it too.
 */
// Field name => path in the character (must match LINK_FIELDS in src/cloud.js).
const SHARED_FIELDS = ['inv' => ['inv'], 'notes' => ['notes'], 'coins' => ['coins'], 'conds' => ['play', 'conds'],
    'stamina' => ['play', 'stamina'], 'cruelty' => ['play', 'cruelty'], 'wounds' => ['play', 'wounds'], 'log' => ['play', 'log'],
    'txp' => ['txp'], 'pendingXP' => ['play', 'pendingXP'], 'xpLog' => ['play', 'xpLog'],
    // what a rest or the end of a dungeon turn run from the Ref Screen changes, and the XP claims the Ref answers
    'dt' => ['play', 'dt'], 'spent' => ['play', 'spent'], 'temp' => ['play', 'temp'], 'petStam' => ['play', 'petStam'],
    'lastRest' => ['play', 'lastRest'], 'claimsAnswered' => ['play', 'claimsAnswered']];

function own_character(array $s, int $id): array {
    $r = q('SELECT id, name FROM characters WHERE id = ? AND user_id = ?', [$id, $s['id']])->fetch();
    if (!$r) fail('That character was not found.', 404);
    return $r;
}
function share_url(string $tok): string { return rtrim(config()['site_url'], '/') . '/#share=' . $tok; }

function a_share_get(): array {
    $s = need_login();
    $c = own_character($s, record_id());
    $has = (bool)q('SELECT 1 FROM share_links WHERE character_id = ?', [$c['id']])->fetch();
    $refs = q('SELECT a.id, a.created_at, u.username, (g.access_id IS NOT NULL) AS can_claim FROM character_access a JOIN users u ON u.id = a.ref_user_id
               LEFT JOIN control_grants g ON g.access_id = a.id WHERE a.character_id = ? ORDER BY a.created_at', [$c['id']])->fetchAll();
    return ['hasLink' => $has, 'refs' => array_map(function ($r) {
        return ['accessId' => (int)$r['id'], 'username' => $r['username'], 'since' => $r['created_at'] . 'Z', 'canTakeControl' => (bool)$r['can_claim']];
    }, $refs)];
}

/** Let one Ref with access take control of the crow themselves (control.claim), or stop letting them. Off by default. */
function a_share_allow_control(): array {
    $s = need_login();
    $aid = (int)(body()['accessId'] ?? 0);
    $row = q('SELECT a.id, a.character_id FROM character_access a JOIN characters c ON c.id = a.character_id
              WHERE a.id = ? AND c.user_id = ?', [$aid, $s['id']])->fetch();
    if (!$row) fail('That Ref no longer has access.', 404);
    if (!empty(body()['allow'])) {
        q('INSERT IGNORE INTO control_grants (access_id, created_at) VALUES (?,?)', [$aid, now()]);
        audit('control_grant_on', $s['id'], 'access ' . $aid);
    } elseif (q('DELETE FROM control_grants WHERE access_id = ?', [$aid])->rowCount()) {
        audit('control_grant_off', $s['id'], 'access ' . $aid);
    }
    return [];
}

function a_share_create(): array {
    $s = need_login();
    $c = own_character($s, record_id());
    $tok = token();
    q('REPLACE INTO share_links (character_id, token_hash, created_at) VALUES (?,?,?)', [$c['id'], sha($tok), now()]);
    audit('share_link_made', $s['id'], 'character ' . $c['id']);
    return ['link' => share_url($tok)];
}

function a_share_disable(): array {
    $s = need_login();
    $c = own_character($s, record_id());
    q('DELETE FROM share_links WHERE character_id = ?', [$c['id']]);
    audit('share_link_disabled', $s['id'], 'character ' . $c['id']);
    return [];
}

function a_share_revoke(): array {
    $s = need_login();
    $aid = (int)(body()['accessId'] ?? 0);
    $row = q('SELECT a.id, a.ref_user_id FROM character_access a JOIN characters c ON c.id = a.character_id
              WHERE a.id = ? AND c.user_id = ?', [$aid, $s['id']])->fetch();
    if (!$row) fail('That Ref no longer has access.', 404);
    q('DELETE FROM character_access WHERE id = ?', [$aid]);
    audit('share_revoked', $s['id'], 'access ' . $aid, null);
    return [];
}

/** The character behind a share token, or a clear error. */
function shared_by_token(string $tok): array {
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) fail('That character link is not valid.');
    $r = q('SELECT c.id, c.name, c.summary, c.user_id, u.username AS owner FROM share_links l
            JOIN characters c ON c.id = l.character_id JOIN users u ON u.id = c.user_id WHERE l.token_hash = ?', [sha($tok)])->fetch();
    if (!$r) fail('That character link no longer works. Ask the player for a new one.', 404);
    return $r;
}
function need_ref(string $why = 'Only Refs can add characters to a campaign. Send this link to your Ref.'): array {
    $s = need_login();
    if (!can_ref($s)) fail($why, 403);
    return $s;
}
const REF_ONLY = 'Only Refs can run campaigns.';

function a_link_preview(): array {
    $s = need_ref();
    $c = shared_by_token((string)($_GET['token'] ?? ''));
    $existing = q('SELECT id FROM character_access WHERE character_id = ? AND ref_user_id = ?', [$c['id'], $s['id']])->fetchColumn();
    return ['name' => $c['name'], 'summary' => $c['summary'], 'owner' => $c['owner'], 'own' => (int)$c['user_id'] === $s['id'],
            'accessId' => $existing ? (int)$existing : null];
}

function a_link_redeem(): array {
    $s = need_ref();
    $c = shared_by_token(str('token', 100));
    q('INSERT IGNORE INTO character_access (character_id, ref_user_id, created_at) VALUES (?,?,?)', [$c['id'], $s['id'], now()]);
    $aid = (int)q('SELECT id FROM character_access WHERE character_id = ? AND ref_user_id = ?', [$c['id'], $s['id']])->fetchColumn();
    audit('share_redeemed', (int)$c['user_id'], 'character ' . $c['id'], $s['id']);
    return ['item' => linked_out(access_row($s, $aid), true)];
}

function access_row(array $s, int $aid): array {
    $r = q('SELECT a.id AS access_id, c.*, u.username AS owner FROM character_access a JOIN characters c ON c.id = a.character_id
            JOIN users u ON u.id = c.user_id WHERE a.id = ? AND a.ref_user_id = ?', [$aid, $s['id']])->fetch();
    if (!$r) fail('You no longer have access to that character. The player may have removed it.', 404);
    return $r;
}
function linked_out(array $r, bool $withData): array {
    $o = row_out($r, $withData);
    $o['id'] = (int)$r['access_id'];
    $o['owner'] = $r['owner'];
    if ($withData) $o['data'] = json_decode($r['data']);   // objects stay objects
    return with_watch($o, 'characters', (int)$r['id']);
}

function a_link_get(): array {
    $s = need_ref();
    $r = access_row($s, record_id());
    $known = (int)($_GET['known'] ?? 0);
    if ($known && (int)$r['version'] === $known) return ['item' => ['id' => (int)$r['access_id'], 'version' => $known, 'unchanged' => true]];
    return ['item' => linked_out($r, true)];
}

/** Sorted-key form for comparing two decoded JSON values regardless of key order. */
function canon($v): string {
    $norm = function ($x) use (&$norm) {
        if (is_object($x)) $x = get_object_vars($x);
        if (!is_array($x)) return $x;
        $isList = array_is_list($x) && $x !== [];
        $x = array_map($norm, $x);
        if (!$isList) ksort($x, SORT_STRING);
        return $x;
    };
    return enc($norm($v));
}
function clean_inv($inv): array {
    if (!is_array($inv) || count($inv) > 300) fail('Bad equipment list.');
    $out = [];
    foreach ($inv as $c) {
        if (!is_object($c) || !is_string($c->key ?? null) || strlen($c->key) > 80) fail('Bad equipment card.');
        $card = (object)['key' => $c->key, 'qty' => max(1, min(999, (int)($c->qty ?? 1))),
            'area' => in_array($c->area ?? '', ['hand', 'belt', 'pack', 'none'], true) ? $c->area : 'none',
            'idx' => max(0, min(99, (int)($c->idx ?? 0)))];
        foreach (['ud', 'dmg', 'ammo', 'thrown'] as $k) if (isset($c->$k) && is_numeric($c->$k)) $card->$k = max(0, min(999, (int)$c->$k));
        $out[] = $card;
    }
    return $out;
}
function clean_conds($c): object {
    if (!is_object($c)) fail('Bad conditions.');
    $out = new stdClass();
    foreach (get_object_vars($c) as $k => $v) {
        if (count(get_object_vars($out)) >= 30 || !preg_match('/^[A-Za-z][A-Za-z -]{0,29}$/', (string)$k)) fail('Bad condition.');
        if ($v) $out->$k = true;
    }
    return $out;
}
function clean_int($v, int $min, int $max, string $what): int {
    if (!is_int($v) && !(is_float($v) && floor($v) == $v)) fail("Bad $what.");
    return max($min, min($max, (int)$v));
}
function clean_wounds($w): object {
    if (!is_object($w)) fail('Bad wounds.');
    $out = new stdClass();
    foreach (get_object_vars($w) as $k => $v) {
        if (!preg_match('/^[0-9]$/', (string)$k) || ($v !== 'w' && $v !== 's')) fail('Bad wound.');
        $out->{(string)$k} = $v;
    }
    return $out;
}
/** A map of short names (expertises, pet numbers) to small counts: expertise uses spent, lore book uses, pet Stamina. */
function clean_counts($c, string $what): object {
    if (!is_object($c) || count(get_object_vars($c)) > 60) fail("Bad $what.");
    $out = new stdClass();
    foreach (get_object_vars($c) as $k => $v) {
        $k = (string)$k;
        if ($k === '' || mb_strlen($k) > 80 || preg_match('/[\x00-\x1f]/', $k)) fail("Bad $what.");
        $out->$k = clean_int($v, 0, 999, $what);
    }
    return $out;
}
/** The last rest: { dt, by: 'self' | 'ref', t, extras? }, or null. */
function clean_rest($r) {
    if ($r === null) return null;
    if (!is_object($r) || !in_array($r->by ?? null, ['self', 'ref'], true)) fail('Bad rest.');
    $out = (object)['dt' => clean_int($r->dt ?? 0, 0, 999999, 'rest'), 'by' => $r->by, 't' => clean_int($r->t ?? 0, 0, PHP_INT_MAX, 'rest time')];
    if (!empty($r->extras)) $out->extras = true;
    return $out;
}
/** The ids of the players' XP claims the Ref has answered (the claims themselves are only ever changed by the player). */
function clean_claim_ids($l): array {
    if (!is_array($l) || count($l) > 50) fail('Bad XP claims.');
    foreach ($l as $id) if (!is_string($id) || !preg_match('/^[A-Za-z0-9]{1,24}$/', $id)) fail('Bad XP claim.');
    return array_values($l);
}
function clean_log($l): array {
    if (!is_array($l) || count($l) > 200) fail('Bad log.');
    $out = [];
    foreach ($l as $e) {
        if (!is_object($e) || !is_string($e->m ?? null) || mb_strlen($e->m) > 1000) fail('Bad log entry.');
        $out[] = (object)['t' => clean_int($e->t ?? 0, 0, PHP_INT_MAX, 'log time'), 'm' => $e->m];
    }
    return $out;
}
function clean_xplog($l): array {
    if (!is_array($l) || count($l) > 100) fail('Bad XP history.');
    $out = [];
    foreach ($l as $e) {
        if (!is_object($e) || !is_string($e->desc ?? null) || mb_strlen($e->desc) > 200) fail('Bad XP history entry.');
        $out[] = (object)['t' => clean_int($e->t ?? 0, 0, PHP_INT_MAX, 'XP time'), 'desc' => $e->desc, 'gc' => clean_int($e->gc ?? 0, 0, 999999999, 'treasure value'),
            'n' => clean_int($e->n ?? 1, 0, 99, 'players'), 'xp' => clean_int($e->xp ?? 0, -9999999, 9999999, 'XP')];
    }
    return $out;
}
/** The current log plus the entries the Ref added since $base (both sides add entries, so they're combined, not compared). */
function merge_log($cur, array $mine, $base, int $max = 200): array {
    $key = function ($e) {
        if (!is_object($e) || !is_scalar($e->t ?? null)) return null;
        if (is_string($e->m ?? null)) return $e->t . '|' . $e->m;                                   // the log
        return is_string($e->desc ?? null) ? $e->t . '|' . $e->desc . '|' . ($e->xp ?? '') : null;   // the XP history
    };
    $cur = is_array($cur) ? $cur : [];
    $seen = [];
    foreach (array_merge($cur, is_array($base) ? $base : []) as $e) if ($key($e) !== null) $seen[$key($e)] = true;
    foreach ($mine as $e) if (!isset($seen[$key($e)])) { $cur[] = $e; $seen[$key($e)] = true; }
    usort($cur, function ($a, $b) { return ($b->t ?? 0) <=> ($a->t ?? 0); });
    return array_slice($cur, 0, $max);
}
function field_get(object $d, string $f) {
    foreach (SHARED_FIELDS[$f] as $k) { if (!is_object($d) || !isset($d->$k)) return null; $d = $d->$k; }
    return $d;
}
function field_set(object $d, string $f, $v): void {
    $path = SHARED_FIELDS[$f];
    $last = array_pop($path);
    foreach ($path as $k) { if (!isset($d->$k) || !is_object($d->$k)) $d->$k = new stdClass(); $d = $d->$k; }
    $d->$last = $v;
}

/**
 * The Ref's save: only the shared fields, each applied only if the character still has the
 * value the Ref started from. So the player's own changes (Stamina, rests, anything else) are never
 * overwritten, and if both changed the same thing the Ref is told instead of silently winning.
 */
function a_link_save(): array {
    $s = need_ref();
    $aid = record_id();
    $b = body_obj();
    if (!isset($b->fields) || !is_object($b->fields) || !isset($b->base) || !is_object($b->base)) fail('Nothing to save.');
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $r = q('SELECT a.id AS access_id, c.*, u.username AS owner FROM character_access a JOIN characters c ON c.id = a.character_id
                JOIN users u ON u.id = c.user_id WHERE a.id = ? AND a.ref_user_id = ? FOR UPDATE', [$aid, $s['id']])->fetch();
        if (!$r) fail('You no longer have access to that character. The player may have removed it.', 404);
        $data = json_decode($r['data']);
        if (!is_object($data)) fail('That character could not be read.', 500);
        $changed = [];
        foreach (get_object_vars($b->fields) as $f => $v) {
            if (!isset(SHARED_FIELDS[$f])) fail('A Ref can only change the vitals, equipment, notes, rests, and XP.', 403);
            if (!property_exists($b->base, $f)) fail('Nothing to save.');
            if ($f !== 'log' && $f !== 'xpLog' && canon(field_get($data, $f)) !== canon($b->base->$f)) {
                fail('The player changed this character at the same time.', 409, ['item' => linked_out($r, true)]);
            }
            switch ($f) {
                case 'inv': $v = clean_inv($v); break;
                case 'conds': $v = clean_conds($v); break;
                case 'notes': if (!is_string($v) || mb_strlen($v) > 5000) fail('Notes are too long.'); break;
                case 'coins': $v = clean_int($v, 0, 999999999, 'coins'); break;
                case 'stamina': $v = $v === null ? null : clean_int($v, 0, 9999, 'Stamina'); break;
                case 'cruelty': $v = clean_int($v, 0, 999, 'cruelty'); break;
                case 'wounds': $v = clean_wounds($v); break;
                case 'log': $v = merge_log(field_get($data, 'log'), clean_log($v), $b->base->log); break;
                case 'txp': $v = clean_int($v, 0, 999999, 'total XP'); break;
                case 'pendingXP': $v = clean_int($v, 0, 99999999, 'pending XP'); break;
                case 'xpLog': $v = merge_log(field_get($data, 'xpLog'), clean_xplog($v), $b->base->xpLog, 100); break;
                case 'dt': $v = clean_int($v, 0, 999999, 'dungeon turn'); break;
                case 'spent': $v = clean_counts($v, 'expertise uses'); break;
                case 'temp': $v = clean_counts($v, 'lore book uses'); break;
                case 'petStam': $v = clean_counts($v, 'pet Stamina'); break;
                case 'lastRest': $v = clean_rest($v); break;
                case 'claimsAnswered': $v = clean_claim_ids($v); break;
            }
            field_set($data, $f, $v);
            $changed[] = $f;
        }
        if ($changed) {
            q('UPDATE characters SET data = ?, version = version + 1, updated_at = ? WHERE id = ?', [enc($data), now(), $r['id']]);
        }
        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) $pdo->rollBack();
        throw $e;
    }
    $out = linked_out(access_row($s, $aid), true);
    if ($changed) signal('characters', (int)$r['id'], $out['version']);
    return ['item' => $out];
}

function a_link_remove(): array {
    $s = need_login();
    q('DELETE FROM character_access WHERE id = ? AND ref_user_id = ?', [record_id(), $s['id']]);
    return [];
}

// ---------------------------------------------------------------- handing a character to someone else to play
/*
 * A player can give control of one of their characters to another account (a player, or their Ref), say for a
 * session they'll miss. That user then opens, edits, and plays it from their own My characters and Play pages
 * (get and save accept them, see record_access) and acts with it in fights. They can't delete, copy, share, or
 * pass it on. The owner keeps full access, and takes control back whenever they like; the other user can also
 * hand it back. Either way the other side is told (notifications), and the version is bumped so a sheet still
 * open on the delegate's page notices within a second or two that it can no longer save.
 */
function control_row(int $characterId): ?array {
    $r = q('SELECT k.user_id, k.created_at, u.username FROM character_control k JOIN users u ON u.id = k.user_id WHERE k.character_id = ?', [$characterId])->fetch();
    return $r ?: null;
}
/** Make open copies of the character reload (and a delegate who lost control find out). */
function control_changed(int $characterId): void {
    q('UPDATE characters SET version = version + 1 WHERE id = ?', [$characterId]);
    signal('characters', $characterId, (int)q('SELECT version FROM characters WHERE id = ?', [$characterId])->fetchColumn());
}

/**
 * The owner's Delegate Control panel: who has control, the Refs with access, and the campaigns the crow is in with
 * their Ref and the other players there now (crows in play or sitting out), the likely people to hand it to.
 * Only usernames go back, nothing else of the Ref's campaign.
 */
function a_control_get(): array {
    $s = need_login();
    $c = own_character($s, record_id());
    $k = control_row((int)$c['id']);
    $access = q('SELECT a.id, a.ref_user_id, u.username FROM character_access a JOIN users u ON u.id = a.ref_user_id WHERE a.character_id = ? ORDER BY u.username', [$c['id']])->fetchAll();
    $campaigns = [];
    foreach ($access as $a) {
        foreach (q('SELECT name, data FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC', [$a['ref_user_id']])->fetchAll() as $camp) {
            $party = json_decode($camp['data'], true)['party'] ?? null;
            if (!is_array($party)) continue;
            $links = []; $mine = false;
            foreach ($party as $pc) {
                $aid = is_array($pc) && isset($pc['link']) && is_numeric($pc['link']) ? (int)$pc['link'] : 0;
                if (!$aid) continue;
                if ($aid === (int)$a['id']) { $mine = true; continue; }
                if (in_array($pc['status'] ?? 'active', ['active', 'away'], true)) $links[] = $aid;
            }
            if (!$mine) continue;
            $players = [];
            if ($links) {
                $in = implode(',', array_fill(0, count($links), '?'));
                // Links in this Ref's party are this Ref's access rows; a stale one simply matches nothing.
                $players = q("SELECT DISTINCT u.username FROM character_access x JOIN characters ch ON ch.id = x.character_id JOIN users u ON u.id = ch.user_id
                              WHERE x.id IN ($in) AND x.ref_user_id = ? AND u.id <> ? ORDER BY u.username",
                             array_merge($links, [$a['ref_user_id'], $s['id']]))->fetchAll(PDO::FETCH_COLUMN);
            }
            $campaigns[] = ['name' => $camp['name'] !== '' ? $camp['name'] : 'Untitled campaign', 'ref' => $a['username'], 'players' => $players];
        }
    }
    return ['controller' => $k ? ['username' => $k['username'], 'since' => $k['created_at'] . 'Z'] : null,
            'refs' => array_column($access, 'username'), 'campaigns' => $campaigns];
}

function a_control_give(): array {
    $s = need_login();
    $c = own_character($s, record_id());
    $name = trim(str('username', 64));
    if ($name === '') fail('Enter the username of the player or Ref to hand this crow to.');
    $u = q('SELECT id, username FROM users WHERE username = ?', [$name])->fetch();
    if (!$u) fail('There\'s no account called ' . $name . '. Check the spelling of their username.', 404);
    if ((int)$u['id'] === $s['id']) fail('This crow is already yours.', 409);
    $old = control_row((int)$c['id']);
    if ($old && (int)$old['user_id'] === (int)$u['id']) return ['controller' => ['username' => $u['username'], 'since' => $old['created_at'] . 'Z']];
    q('REPLACE INTO character_control (character_id, user_id, created_at) VALUES (?,?,?)', [$c['id'], $u['id'], now()]);
    audit('control_given', $s['id'], 'character ' . $c['id'] . ' to ' . $u['username']);
    $detail = ['character' => $c['name'], 'characterId' => (int)$c['id'], 'owner' => $s['username']];
    if ($old) notify((int)$old['user_id'], 'control_taken', $detail);
    notify((int)$u['id'], 'control_given', $detail);
    control_changed((int)$c['id']);
    return ['controller' => ['username' => $u['username'], 'since' => now() . 'Z']];
}

/** The owner takes control back. */
function a_control_take(): array {
    $s = need_login();
    $c = own_character($s, record_id());
    $old = control_row((int)$c['id']);
    if (!$old) return [];
    q('DELETE FROM character_control WHERE character_id = ?', [$c['id']]);
    audit('control_taken', $s['id'], 'character ' . $c['id'] . ' from ' . $old['username']);
    notify((int)$old['user_id'], 'control_taken', ['character' => $c['name'], 'characterId' => (int)$c['id'], 'owner' => $s['username']]);
    control_changed((int)$c['id']);
    return [];
}

/**
 * A Ref takes control of a crow that's in play (or sitting out) in one of their own campaigns, as if its player
 * had handed it to them: say the player can't make a session. The Ref then opens, edits, and plays the whole
 * sheet. The player is told and can take it back as usual; anyone it was handed to before loses it and is told.
 * Only if the player allowed this Ref to (control_grants, from the Share panel).
 * The id is the Ref's link to the character (character_access), as in the Ref Screen's party.
 */
function a_control_claim(): array {
    $s = need_ref('Only Refs can take control of a crow in their campaign.');
    $r = access_row($s, record_id());
    // The Ref writes their own campaigns, so being in a party proves nothing: the player has to allow it.
    if (!q('SELECT 1 FROM control_grants WHERE access_id = ?', [$r['access_id']])->fetch()) {
        fail($r['owner'] . ' hasn\'t let you take control of ' . ($r['name'] !== '' ? $r['name'] : 'this crow') .
             '. They can allow it from the crow\'s Share panel in My characters, or hand it to you with Delegate Control.', 403);
    }
    $campaign = null;
    foreach (q('SELECT name, data FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC', [$s['id']])->fetchAll() as $camp) {
        $party = json_decode($camp['data'], true)['party'] ?? null;
        if (!is_array($party)) continue;
        foreach ($party as $pc) {
            if (is_array($pc) && isset($pc['link']) && (int)$pc['link'] === (int)$r['access_id'] && in_array($pc['status'] ?? 'active', ['active', 'away'], true)) {
                $campaign = $camp['name'] !== '' ? $camp['name'] : 'Untitled campaign';
                break 2;
            }
        }
    }
    if ($campaign === null) fail('You can only take control of a crow that\'s in play or sitting out in one of your campaigns.', 409);
    $cid = (int)$r['id'];
    $old = control_row($cid);
    if ($old && (int)$old['user_id'] === $s['id']) return ['characterId' => $cid];
    q('REPLACE INTO character_control (character_id, user_id, created_at) VALUES (?,?,?)', [$cid, $s['id'], now()]);
    audit('control_claimed', (int)$r['user_id'], 'character ' . $cid . ($old ? ' from ' . $old['username'] : ''), $s['id']);
    $detail = ['character' => $r['name'], 'characterId' => $cid, 'by' => $s['username'], 'campaign' => $campaign];
    notify((int)$r['user_id'], 'control_claimed', $detail);
    if ($old) notify((int)$old['user_id'], 'control_claimed', $detail);
    control_changed($cid);
    return ['characterId' => $cid];
}

/** The user in control hands it back to its owner. */
function a_control_release(): array {
    $s = need_login();
    $id = record_id();
    $r = q('SELECT c.id, c.name, c.user_id FROM character_control k JOIN characters c ON c.id = k.character_id
            WHERE k.character_id = ? AND k.user_id = ?', [$id, $s['id']])->fetch();
    if (!$r) return [];   // already taken back
    q('DELETE FROM character_control WHERE character_id = ? AND user_id = ?', [$id, $s['id']]);
    audit('control_returned', (int)$r['user_id'], 'character ' . $id, $s['id']);
    notify((int)$r['user_id'], 'control_returned', ['character' => $r['name'], 'characterId' => $id, 'by' => $s['username']]);
    control_changed($id);
    return [];
}

/** Characters other players handed to this user, for their My characters and Play pages. */
function a_control_list(): array {
    $s = need_login();
    $rows = q('SELECT c.id, c.name, c.summary, c.version, c.draft, c.created_at, c.updated_at, u.username AS owner, k.created_at AS since
               FROM character_control k JOIN characters c ON c.id = k.character_id JOIN users u ON u.id = c.user_id
               WHERE k.user_id = ? ORDER BY c.updated_at DESC', [$s['id']])->fetchAll();
    return ['items' => array_map(function ($r) { return row_out($r) + ['owner' => $r['owner'], 'since' => $r['since'] . 'Z']; }, $rows)];
}

// ---------------------------------------------------------------- inviting players to a campaign
/*
 * A Ref makes an invite link for a campaign and sends it to the players. A logged-in player who opens it
 * picks one of their characters and asks to join; the request shows up in the Ref Screen, where accepting it
 * gives the Ref the same access a character link gives (character_access) and adds the crow to the party.
 * Asking is the player's consent to that. The player can cancel a request until it's decided, and remove
 * the Ref's access later from the character's Share panel, as with any Ref.
 * The Ref Screen learns of new requests through the change signal for ('requests', campaign id), whose
 * version is the newest request's id (a fresh request always gets a new, higher id).
 * A Ref can also list a campaign (campaign_listings) so players find it under Find a campaign and ask to join
 * without a link; such requests arrive and are answered exactly like ones made through the link.
 */
const MAX_PENDING = 30;   // per campaign, so a leaked link can't flood the Ref

function own_campaign(array $s, int $id): array {
    $r = q('SELECT id, name, summary FROM campaigns WHERE id = ? AND user_id = ?', [$id, $s['id']])->fetch();
    if (!$r) fail('That campaign was not found.', 404);
    return $r;
}
function invite_url(string $tok): string { return rtrim(config()['site_url'], '/') . '/#join=' . $tok; }
/** The campaign behind an invite token (with its Ref's name), or a clear error. */
function invited_by_token(string $tok): array {
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) fail('That campaign link is not valid.');
    $r = q('SELECT p.id, p.name, p.summary, p.user_id, u.username AS ref FROM campaign_invites i
            JOIN campaigns p ON p.id = i.campaign_id JOIN users u ON u.id = p.user_id WHERE i.token_hash = ?', [sha($tok)])->fetch();
    if (!$r) fail('That campaign link no longer works. Ask your Ref for a new one.', 404);
    return $r;
}
/** A listed campaign (with its Ref's name), or a clear error. Unlisted ones look the same as missing ones. */
function listed_campaign(int $id): array {
    $r = q('SELECT p.id, p.name, p.summary, p.user_id, u.username AS ref FROM campaign_listings l
            JOIN campaigns p ON p.id = l.campaign_id JOIN users u ON u.id = p.user_id WHERE l.campaign_id = ?', [$id])->fetch();
    if (!$r) fail('That campaign isn\'t taking new players through Find a campaign any more.', 404);
    return $r;
}
/** The campaign a player is asking about: by invite token, or by id if it's listed. $in is the query or the body. */
function joinable(array $in): array {
    $tok = $in['token'] ?? '';
    if (is_string($tok) && $tok !== '') return invited_by_token($tok);
    $id = $in['campaign'] ?? 0;
    if (!is_numeric($id) || (int)$id <= 0) fail('Missing campaign.');
    return listed_campaign((int)$id);
}
function requests_signal(int $campaignId): void {
    $v = (int)q('SELECT MAX(id) FROM join_requests WHERE campaign_id = ?', [$campaignId])->fetchColumn();
    if ($v) signal('requests', $campaignId, $v);
}

/** For the Ref Screen: the campaign's link state and pending requests, plus where to watch for new ones. */
function a_invite_get(): array {
    $s = need_ref(REF_ONLY);
    $c = own_campaign($s, record_id());
    $has = (bool)q('SELECT 1 FROM campaign_invites WHERE campaign_id = ?', [$c['id']])->fetch();
    $listing = q('SELECT note FROM campaign_listings WHERE campaign_id = ?', [$c['id']])->fetch();
    $rows = q("SELECT j.id, j.created_at, c.name, c.summary, u.username FROM join_requests j JOIN characters c ON c.id = j.character_id
               JOIN users u ON u.id = c.user_id WHERE j.campaign_id = ? AND j.status = 'pending' ORDER BY j.id", [$c['id']])->fetchAll();
    $latest = (int)q('SELECT MAX(id) FROM join_requests WHERE campaign_id = ?', [$c['id']])->fetchColumn();
    $w = with_watch(['version' => $latest], 'requests', (int)$c['id']);
    return ['hasLink' => $has, 'listed' => (bool)$listing, 'note' => $listing ? $listing['note'] : '', 'latest' => $latest, 'watch' => $w['watch'] ?? null, 'requests' => array_map(function ($r) {
        return ['id' => (int)$r['id'], 'name' => $r['name'], 'summary' => $r['summary'], 'player' => $r['username'], 'at' => $r['created_at'] . 'Z'];
    }, $rows)];
}

function a_invite_create(): array {
    $s = need_ref(REF_ONLY);
    $c = own_campaign($s, record_id());
    $tok = token();
    q('REPLACE INTO campaign_invites (campaign_id, token_hash, created_at) VALUES (?,?,?)', [$c['id'], sha($tok), now()]);
    audit('invite_link_made', $s['id'], 'campaign ' . $c['id']);
    return ['link' => invite_url($tok)];
}

function a_invite_disable(): array {
    $s = need_ref(REF_ONLY);
    $c = own_campaign($s, record_id());
    q('DELETE FROM campaign_invites WHERE campaign_id = ?', [$c['id']]);
    audit('invite_link_disabled', $s['id'], 'campaign ' . $c['id']);
    return [];
}

/** List the campaign in Find a campaign (with an optional short note for players), or take it out. */
function a_invite_list(): array {
    $s = need_ref(REF_ONLY);
    $c = own_campaign($s, record_id());
    if (!empty(body()['listed'])) {
        $note = trim(preg_replace('/\s+/u', ' ', str('note', 1000)));
        if (mb_strlen($note) > 255) fail('Keep the note to 255 characters.');
        q('INSERT INTO campaign_listings (campaign_id, note, created_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE note = VALUES(note)', [$c['id'], $note, now()]);
        audit('campaign_listed', $s['id'], 'campaign ' . $c['id']);
    } elseif (q('DELETE FROM campaign_listings WHERE campaign_id = ?', [$c['id']])->rowCount()) {
        audit('campaign_unlisted', $s['id'], 'campaign ' . $c['id']);
    }
    return [];
}

const SEARCH_LIMIT = 50;
/**
 * Find a campaign: listed campaigns whose name, summary, note, or Ref's username contains the search words
 * (all of them; no words lists everything, newest listings first). Each says how many crows are in play there
 * and whether one of the player's own crows is already waiting or in.
 */
function a_campaigns_search(): array {
    $s = need_login();
    $text = (string)($_GET['q'] ?? '');
    if (strlen($text) > 200) fail('Search for fewer words.');
    $where = [];
    $args = [$s['id']];
    foreach (array_slice(preg_split('/\s+/u', trim($text), -1, PREG_SPLIT_NO_EMPTY), 0, 8) as $w) {
        $like = '%' . addcslashes($w, '%_\\') . '%';
        $where[] = '(p.name LIKE ? OR p.summary LIKE ? OR l.note LIKE ? OR u.username LIKE ?)';
        array_push($args, $like, $like, $like, $like);
    }
    $rows = q('SELECT p.id, p.name, p.summary, p.data, p.user_id, l.note, l.created_at, u.username AS ref,
                      (SELECT GROUP_CONCAT(DISTINCT j.status) FROM join_requests j JOIN characters c ON c.id = j.character_id
                       WHERE j.campaign_id = p.id AND c.user_id = ?) AS mine
               FROM campaign_listings l JOIN campaigns p ON p.id = l.campaign_id JOIN users u ON u.id = p.user_id'
              . ($where ? ' WHERE ' . implode(' AND ', $where) : '') . ' ORDER BY l.created_at DESC, p.id DESC LIMIT ' . SEARCH_LIMIT, $args)->fetchAll();
    return ['items' => array_map(function ($r) use ($s) {
        $party = json_decode($r['data'], true)['party'] ?? [];
        $crows = is_array($party) ? count(array_filter($party, function ($pc) { return is_array($pc) && in_array($pc['status'] ?? 'active', ['active', 'away'], true); })) : 0;
        $mine = $r['mine'] ? explode(',', $r['mine']) : [];
        return ['id' => (int)$r['id'], 'name' => $r['name'] !== '' ? $r['name'] : 'Untitled campaign', 'summary' => $r['summary'], 'note' => $r['note'],
            'ref' => $r['ref'], 'crows' => $crows, 'own' => (int)$r['user_id'] === $s['id'], 'listedAt' => $r['created_at'] . 'Z',
            'mine' => in_array('pending', $mine, true) ? 'pending' : (in_array('accepted', $mine, true) ? 'accepted' : null)];
    }, $rows), 'more' => count($rows) >= SEARCH_LIMIT];
}

/**
 * A player opened an invite, or a campaign from Find a campaign: the campaign, and each of their characters with
 * any request already made.
 */
function a_join_preview(): array {
    $s = need_login();
    $p = joinable($_GET);
    $chars = q('SELECT c.id, c.name, c.summary, j.id AS rid, j.status, (a.id IS NOT NULL) AS has_access FROM characters c
                LEFT JOIN join_requests j ON j.character_id = c.id AND j.campaign_id = ?
                LEFT JOIN character_access a ON a.character_id = c.id AND a.ref_user_id = ?
                WHERE c.user_id = ? ORDER BY c.updated_at DESC', [$p['id'], $p['user_id'], $s['id']])->fetchAll();
    return ['campaign' => $p['name'], 'summary' => $p['summary'], 'ref' => $p['ref'], 'own' => (int)$p['user_id'] === $s['id'],
        'characters' => array_map(function ($c) {
            return ['id' => (int)$c['id'], 'name' => $c['name'], 'summary' => $c['summary'], 'requestId' => $c['rid'] ? (int)$c['rid'] : null,
                    'status' => $c['status'], 'refHasAccess' => (bool)$c['has_access']];
        }, $chars)];
}

function a_join_request(): array {
    $s = need_login();
    $p = joinable(['token' => str('token', 100), 'campaign' => body()['campaign'] ?? 0]);
    $c = own_character($s, (int)(body()['characterId'] ?? 0));
    $cur = q('SELECT id, status FROM join_requests WHERE campaign_id = ? AND character_id = ?', [$p['id'], $c['id']])->fetch();
    if ($cur && $cur['status'] === 'pending') fail('You already asked to join with this crow.', 409);
    // Accepted, but if the player has since taken the Ref's access away they may ask again.
    if ($cur && $cur['status'] === 'accepted' && q('SELECT 1 FROM character_access WHERE character_id = ? AND ref_user_id = ?', [$c['id'], $p['user_id']])->fetch()) {
        fail('This crow is already in the campaign.', 409);
    }
    if ((int)q("SELECT COUNT(*) FROM join_requests WHERE campaign_id = ? AND status = 'pending'", [$p['id']])->fetchColumn() >= MAX_PENDING) {
        fail('This campaign has too many requests waiting. Ask your Ref to answer some first.', 429);
    }
    // Asking again makes a new request (a new id, so the Ref Screen notices it).
    if ($cur) q('DELETE FROM join_requests WHERE id = ?', [$cur['id']]);
    q('INSERT INTO join_requests (campaign_id, character_id, created_at) VALUES (?,?,?)', [$p['id'], $c['id'], now()]);
    audit('join_requested', (int)$p['user_id'], 'campaign ' . $p['id'] . ', character ' . $c['id'], $s['id']);
    requests_signal((int)$p['id']);
    mail_ref_join_request($p, $s, $c);
    return [];
}
/** Tell the campaign's Ref (if they want it) that a player is waiting to be let in. Never fails the request. */
function mail_ref_join_request(array $camp, array $player, array $crow): void {
    try {
        $rid = (int)$camp['user_id'];
        if (!wants_email($rid, 'joinRequests')) return;
        $ref = q('SELECT username, email FROM users WHERE id = ?', [$rid])->fetch();
        if (!$ref) return;
        $crowName = $crow['name'] !== '' ? $crow['name'] : 'a crow';
        $campName = ($camp['name'] ?? '') !== '' ? $camp['name'] : 'your campaign';
        send_mail($ref['email'], "{$player['username']} wants to join $campName",
            "Hi {$ref['username']},\n\n{$player['username']} asked to bring $crowName into $campName. " .
            "Accept or decline the request on your Ref Screen:\n" . site_link('#campaigns') . "\n" . prefs_footer());
    } catch (Throwable $e) { error_log('crows request mail: ' . $e->getMessage()); }
}

function a_join_cancel(): array {
    $s = need_login();
    $n = q("DELETE j FROM join_requests j JOIN characters c ON c.id = j.character_id
            WHERE j.id = ? AND c.user_id = ? AND j.status = 'pending'", [record_id(), $s['id']])->rowCount();
    if (!$n) fail('That request was already answered or withdrawn.', 409);
    return [];
}

/** The Ref's pending request $id for one of their campaigns, or a clear error. */
function pending_request(array $s, int $id): array {
    $r = q("SELECT j.id, j.campaign_id, j.character_id, c.user_id AS player_id, c.name AS character_name, p.name AS campaign_name FROM join_requests j
            JOIN campaigns p ON p.id = j.campaign_id JOIN characters c ON c.id = j.character_id
            WHERE j.id = ? AND p.user_id = ? AND j.status = 'pending'", [$id, $s['id']])->fetch();
    if (!$r) fail('That request was withdrawn or already answered.', 404);
    return $r;
}

/** Accept: the Ref gets access to the character, and the Ref Screen adds the returned crow to the party. */
function a_join_accept(): array {
    $s = need_ref(REF_ONLY);
    $r = pending_request($s, record_id());
    q('INSERT IGNORE INTO character_access (character_id, ref_user_id, created_at) VALUES (?,?,?)', [$r['character_id'], $s['id'], now()]);
    $aid = (int)q('SELECT id FROM character_access WHERE character_id = ? AND ref_user_id = ?', [$r['character_id'], $s['id']])->fetchColumn();
    q("UPDATE join_requests SET status = 'accepted', decided_at = ? WHERE id = ?", [now(), $r['id']]);
    audit('join_accepted', (int)$r['player_id'], 'campaign ' . $r['campaign_id'] . ', character ' . $r['character_id'], $s['id']);
    notify_decision($s, $r, true);
    return ['item' => linked_out(access_row($s, $aid), true)];
}

function a_join_decline(): array {
    $s = need_ref(REF_ONLY);
    $r = pending_request($s, record_id());
    q("UPDATE join_requests SET status = 'declined', decided_at = ? WHERE id = ?", [now(), $r['id']]);
    audit('join_declined', (int)$r['player_id'], 'campaign ' . $r['campaign_id'] . ', character ' . $r['character_id'], $s['id']);
    notify_decision($s, $r, false);
    return [];
}

// ---------------------------------------------------------------- campaign status of a player's crows
/*
 * For My characters: where each of the player's crows stands in campaigns. A Ref with access (from a character
 * link or an accepted join request) usually has the crow in a campaign's party, whose entry carries its status
 * there (active, sitting out, dead, retired, lost); that's read from the Ref's campaigns. Waiting join requests,
 * and ones declined in the last 14 days, are listed too. Only names and statuses go back, nothing else of the
 * Ref's campaign.
 */
const PARTY_STATUSES = ['active', 'away', 'dead', 'retired', 'lost'];
function a_characters_campaigns(): array {
    $s = need_login();
    $out = [];
    $add = function (int $cid, array $e) use (&$out) { $out[(string)$cid][] = $e; };
    $access = q('SELECT a.id, a.character_id, a.ref_user_id, u.username FROM character_access a JOIN characters c ON c.id = a.character_id
                 JOIN users u ON u.id = a.ref_user_id WHERE c.user_id = ? OR c.id IN (SELECT character_id FROM character_control WHERE user_id = ?)',
                 [$s['id'], $s['id']])->fetchAll();
    $byRef = [];
    foreach ($access as $a) $byRef[(int)$a['ref_user_id']][(int)$a['id']] = $a;
    foreach ($byRef as $refId => $rows) {
        $found = [];
        foreach (q('SELECT id, name, data FROM campaigns WHERE user_id = ? ORDER BY updated_at DESC', [$refId])->fetchAll() as $camp) {
            $party = json_decode($camp['data'], true)['party'] ?? null;
            if (!is_array($party)) continue;
            foreach ($party as $pc) {
                $aid = is_array($pc) && isset($pc['link']) && is_numeric($pc['link']) ? (int)$pc['link'] : 0;
                if (!isset($rows[$aid])) continue;
                $st = in_array($pc['status'] ?? '', PARTY_STATUSES, true) ? $pc['status'] : 'active';
                $add((int)$rows[$aid]['character_id'], ['campaign' => $camp['name'] !== '' ? $camp['name'] : 'Untitled campaign', 'ref' => $rows[$aid]['username'], 'state' => $st]);
                $found[$aid] = true;
            }
        }
        // Access, but not in any of that Ref's parties (removed, or the campaign was deleted).
        foreach ($rows as $aid => $a) if (!isset($found[$aid])) $add((int)$a['character_id'], ['campaign' => null, 'ref' => $a['username'], 'state' => 'access']);
    }
    $reqs = q("SELECT j.character_id, j.status, p.name, u.username FROM join_requests j JOIN characters c ON c.id = j.character_id
               JOIN campaigns p ON p.id = j.campaign_id JOIN users u ON u.id = p.user_id
               WHERE (c.user_id = ? OR c.id IN (SELECT character_id FROM character_control WHERE user_id = ?))
               AND (j.status = 'pending' OR (j.status = 'declined' AND j.decided_at > ?))", [$s['id'], $s['id'], now(-14 * 86400)])->fetchAll();
    foreach ($reqs as $r) $add((int)$r['character_id'], ['campaign' => $r['name'] !== '' ? $r['name'] : 'Untitled campaign', 'ref' => $r['username'], 'state' => $r['status']]);
    return ['campaigns' => (object)$out];
}

// ---------------------------------------------------------------- notifications
/*
 * Short messages for a user, kept until they dismiss them: the home page lists them, and any open app page
 * (Character Generator or Ref Screen) pops them up within a second or two through the change signal for
 * ('notes', user id), whose version is the user's newest notification id.
 */
function notify(int $userId, string $kind, array $detail): void {
    try {
        q('DELETE FROM notifications WHERE user_id = ? AND seen_at IS NOT NULL AND seen_at < ?', [$userId, now(-90 * 86400)]);
        q('INSERT INTO notifications (user_id, kind, detail, created_at) VALUES (?,?,?,?)', [$userId, $kind, enc($detail), now()]);
        signal('notes', $userId, (int)db()->lastInsertId());
    } catch (Throwable $e) { error_log('crows notify: ' . $e->getMessage()); }   // never fails the action itself
    if (strpos($kind, 'control_') === 0) mail_control_change($userId, $kind, $detail);
}
/** Email about a change of who controls a crow (handed over, taken back, claimed by a Ref), unless switched off. */
function mail_control_change(int $userId, string $kind, array $d): void {
    try {
        if (!wants_email($userId, 'controlChanges')) return;
        $u = q('SELECT username, email FROM users WHERE id = ?', [$userId])->fetch();
        if (!$u) return;
        $crow = ($d['character'] ?? '') !== '' ? $d['character'] : 'a crow';
        $msg = [
            'control_given' => ($d['owner'] ?? '') . " handed you $crow to play. It's under Handed to you in Crows until they take it back.",
            'control_taken' => ($d['owner'] ?? '') . " took back control of $crow.",
            'control_returned' => ($d['by'] ?? '') . " handed $crow back to you.",
            'control_claimed' => ($d['by'] ?? '') . ' (Ref of ' . ($d['campaign'] ?? 'your campaign') . ") took control of $crow to play it. " .
                "If it's yours, use Take back control under Delegate Control in Crows.",
        ][$kind] ?? null;
        if ($msg === null) return;
        send_mail($u['email'], "Control of $crow changed", "Hi {$u['username']},\n\n$msg\n\n" . site_link('#home') . "\n" . prefs_footer());
    } catch (Throwable $e) { error_log('crows control mail: ' . $e->getMessage()); }
}
function notify_decision(array $ref, array $r, bool $accepted): void {
    $pid = (int)$r['player_id'];
    notify($pid, $accepted ? 'join_accepted' : 'join_declined', ['character' => $r['character_name'], 'characterId' => (int)$r['character_id'],
        'campaign' => $r['campaign_name'], 'ref' => $ref['username']]);
    try {
        if (!wants_email($pid, 'joinDecisions')) return;
        $p = q('SELECT username, email FROM users WHERE id = ?', [$pid])->fetch();
        if (!$p) return;
        $crow = $r['character_name'] !== '' ? $r['character_name'] : 'your crow';
        $camp = $r['campaign_name'] !== '' ? $r['campaign_name'] : 'their campaign';
        if ($accepted) send_mail($p['email'], "$crow joined $camp",
            "Hi {$p['username']},\n\n{$ref['username']} accepted $crow into $camp. Your Ref can now see the sheet and change its vitals, " .
            "equipment, and notes, and you'll both see each other's changes live.\n\nPlay $crow:\n" .
            site_link('play?id=' . (int)$r['character_id']) . "\n\n" .
            "You can take the Ref's access away any time from the crow's Share button in My characters.\n" . prefs_footer());
        else send_mail($p['email'], "Your request to join $camp",
            "Hi {$p['username']},\n\n{$ref['username']} declined $crow's request to join $camp.\n" .
            "You can ask again (with this crow or another) from the invite link your Ref sent you.\n" . prefs_footer());
    } catch (Throwable $e) { error_log('crows decision mail: ' . $e->getMessage()); }
}

/** The user's notifications not yet dismissed (newest first), and where to watch for new ones. */
function a_notes_list(): array {
    $s = need_login();
    $rows = q('SELECT id, kind, detail, created_at FROM notifications WHERE user_id = ? AND seen_at IS NULL ORDER BY id DESC LIMIT 50', [$s['id']])->fetchAll();
    $latest = (int)q('SELECT MAX(id) FROM notifications WHERE user_id = ?', [$s['id']])->fetchColumn();
    $w = with_watch(['version' => $latest], 'notes', $s['id']);
    return ['latest' => $latest, 'watch' => $w['watch'] ?? null, 'items' => array_map(function ($r) {
        return ['id' => (int)$r['id'], 'kind' => $r['kind'], 'detail' => json_decode($r['detail']), 'at' => $r['created_at'] . 'Z'];
    }, $rows)];
}

/** Dismiss one notification ({id}) or all of them ({all: true}). */
function a_notes_dismiss(): array {
    $s = need_login();
    if (!empty(body()['all'])) q('UPDATE notifications SET seen_at = ? WHERE user_id = ? AND seen_at IS NULL', [now(), $s['id']]);
    else q('UPDATE notifications SET seen_at = ? WHERE id = ? AND user_id = ? AND seen_at IS NULL', [now(), record_id(), $s['id']]);
    return [];
}

// ---------------------------------------------------------------- live combat
/*
 * A fight run from the Ref Screen, shared with the players of the linked crows in it. The Ref Screen publishes
 * what the players may see (combat.publish) whenever the tracker changes: the round, who acts first, each
 * combatant's name and how hurt it looks (exact numbers only if the Ref chooses), the crows, and a short feed.
 * It names the crows in the fight by their access ids, and their players become its members.
 *
 * A member's Play page watches the change signal ('combatc', character id), fetches the fight with combat.mine
 * when it changes, and sends what the crow does with combat.act: an attack or spell on a target with its roll
 * and damage, an action described in words, "done for this round", or an item dropped or picked up (the Ref Screen
 * keeps the fight's unattended items and hands a picked-up one to the crow in the fight it publishes). The Ref Screen watches ('cacts', campaign
 * id), whose version is the newest action's id, reads new ones with combat.actions, and applies them.
 */
const COMBAT_MAX_BYTES = 600000;   // the fight, its session, and the tabletop scene (fog mask and token art)
const ACTION_TYPES = ['attack', 'maneuver', 'taunt', 'ready', 'assist', 'assistUsed', 'declare', 'done', 'undone', 'drop', 'pickup', 'rest', 'defend', 'move', 'ping'];
const REST_FOODS = ['', 'Ration', 'Hearty Ration', 'none'];
const MANEUVERS = ['Move', 'Shift', 'Stand Up', 'Draw From Pack', 'Draw From Belt', 'Pick Up Item', 'Dump Backpack', 'Reload', 'Command Pet',
    'Grab', 'Escape Grab', 'Knockback', 'Jump'];
const COMBAT_CONDS = ['Blessed', 'Grabbed', 'Prone', 'Vulnerable', 'Weakened', 'Unconscious'];

function combat_campaign_id(): int {
    $id = body()['campaign'] ?? ($_GET['campaign'] ?? 0);
    if (!is_numeric($id) || (int)$id <= 0) fail('Missing campaign.');
    return (int)$id;
}
function combat_watch(string $k, int $id): ?string { return with_watch(['version' => 0], $k, $id)['watch'] ?? null; }
/** The version a change signal file holds now (0 if none). */
function signal_version(string $k, int $id): int {
    try { return (int)@file_get_contents(sync_dir() . '/' . sync_file($k, $id)); } catch (Throwable $e) { return 0; }
}
function actions_info(int $campaignId): array {
    $latest = (int)q('SELECT COALESCE(MAX(id), 0) FROM combat_actions WHERE campaign_id = ?', [$campaignId])->fetchColumn();
    return ['latest' => $latest, 'watch' => combat_watch('cacts', $campaignId)];
}

/**
 * The Ref Screen: the fight as the players see it ({active: false} when there's none), with the session (dungeon turn, timer,
 * greed bonus, the party's rest). Its members are the fight's crows and the party's other linked crows, so they see the session.
 */
function a_combat_publish(): array {
    $s = need_ref(REF_ONLY);
    $cid = combat_campaign_id();
    own_campaign($s, $cid);
    $c = body_obj()->combat ?? null;
    $active = is_object($c) && !empty($c->active);
    $json = enc($active ? $c : ['active' => false] + (is_object($c) && is_object($c->session ?? null) ? ['session' => $c->session] : [])
        + (is_object($c) && is_object($c->table ?? null) ? ['table' => $c->table] : []));
    if (strlen($json) > COMBAT_MAX_BYTES) fail('The fight is too large to share.', 413);
    $aids = array_values(array_unique(array_filter(array_map('intval', is_array(body()['members'] ?? null) ? body()['members'] : []))));
    $chars = [];
    if ($aids) {
        $in = implode(',', array_fill(0, count($aids), '?'));
        $chars = array_map('intval', q("SELECT character_id FROM character_access WHERE ref_user_id = ? AND id IN ($in)", array_merge([$s['id']], $aids))->fetchAll(PDO::FETCH_COLUMN));
    }
    $old = array_map('intval', q('SELECT character_id FROM combat_members WHERE campaign_id = ?', [$cid])->fetchAll(PDO::FETCH_COLUMN));
    $prev = (int)q('SELECT version FROM combats WHERE campaign_id = ?', [$cid])->fetchColumn();
    $v = max($prev + 1, (int)floor(microtime(true) * 1000));
    q('INSERT INTO combats (campaign_id, data, version, updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE data = VALUES(data), version = VALUES(version), updated_at = VALUES(updated_at)',
      [$cid, $json, $v, now()]);
    // Only the crows that left come off (never all, then back on): a player acting meanwhile must still find theirs.
    if ($chars) q('DELETE FROM combat_members WHERE campaign_id = ? AND character_id NOT IN (' . implode(',', array_fill(0, count($chars), '?')) . ')', array_merge([$cid], $chars));
    else q('DELETE FROM combat_members WHERE campaign_id = ?', [$cid]);
    foreach ($chars as $ch) q('INSERT IGNORE INTO combat_members (campaign_id, character_id) VALUES (?,?)', [$cid, $ch]);
    foreach (array_unique(array_merge($old, $chars)) as $ch) signal('combatc', $ch, $v);
    return ['version' => $v, 'members' => count($chars), 'actions' => actions_info($cid), 'expert' => true];   // expert: combat.mine hands out per-player knowledge
}

/** The Ref Screen: actions players sent after `after` (oldest first), and where to watch for more. */
function a_combat_actions(): array {
    $s = need_ref(REF_ONLY);
    $cid = combat_campaign_id();
    own_campaign($s, $cid);
    $after = max(0, (int)($_GET['after'] ?? 0));
    $rows = q('SELECT x.id, x.character_id, x.data, x.created_at, a.id AS access_id FROM combat_actions x
               LEFT JOIN character_access a ON a.character_id = x.character_id AND a.ref_user_id = ?
               WHERE x.campaign_id = ? AND x.id > ? ORDER BY x.id LIMIT 100', [$s['id'], $cid, $after])->fetchAll();
    return ['items' => array_map(function ($r) {
        return ['id' => (int)$r['id'], 'link' => $r['access_id'] !== null ? (int)$r['access_id'] : null,
                'at' => $r['created_at'] . 'Z', 'action' => json_decode($r['data'])];
    }, $rows)] + actions_info($cid);
}

/** A member's fight: the newest one this crow is in whose Ref still has access to it. */
function member_combat(int $characterId, int $campaignId = 0): ?array {
    $sql = 'SELECT b.campaign_id, b.version, b.data, p.name, a.id AS access_id FROM combat_members m JOIN combats b ON b.campaign_id = m.campaign_id
            JOIN campaigns p ON p.id = m.campaign_id JOIN character_access a ON a.character_id = m.character_id AND a.ref_user_id = p.user_id
            WHERE m.character_id = ?' . ($campaignId ? ' AND m.campaign_id = ?' : '') . ' ORDER BY b.updated_at DESC LIMIT 1';
    $r = q($sql, $campaignId ? [$characterId, $campaignId] : [$characterId])->fetch();
    return $r ?: null;
}

/** The Play page: the fight the player's crow is in, if any, and the change signal to watch. */
function a_combat_mine(): array {
    $s = need_login();
    $id = record_id();
    record_access('characters', $s, $id);   // its owner, or whoever they handed it to
    $r = member_combat($id);
    $v = max(signal_version('combatc', $id), $r ? (int)$r['version'] : 0);
    $known = (int)($_GET['known'] ?? 0);
    if ($known && $known === $v) return ['unchanged' => true, 'version' => $v];
    return ['version' => $v, 'watch' => combat_watch('combatc', $id),
            'campaign' => $r ? ['id' => (int)$r['campaign_id'], 'name' => $r['name'] !== '' ? $r['name'] : 'Untitled campaign'] : null,
            'combat' => $r ? own_view(json_decode($r['data']), (int)$r['access_id']) : null, 'you' => $r ? (int)$r['access_id'] : null];   // this crow's link in the fight
}
/**
 * What one crow's player may see of the fight: what only some crows know (Monster Expert: { link: { creature id: stats } }) is cut down
 * to this crow's own part.
 */
function own_view($c, int $link) {
    if (!is_object($c) || !isset($c->expert)) return $c;
    $mine = is_object($c->expert) && isset($c->expert->{(string)$link}) ? $c->expert->{(string)$link} : null;
    unset($c->expert);
    if (is_object($mine)) $c->expert = $mine;
    return $c;
}

function clean_action($a): array {
    if (!is_array($a)) fail('Missing action.');
    $type = $a['type'] ?? '';
    if (!in_array($type, ACTION_TYPES, true)) fail('Unknown kind of action.');
    $txt = function (string $k, int $n) use ($a): string { $v = $a[$k] ?? ''; return is_string($v) ? clip($v, $n) : ''; };
    $num = function (string $k, int $lo, int $hi) use ($a): int { $v = $a[$k] ?? 0; return is_numeric($v) ? max($lo, min($hi, (int)$v)) : $lo; };
    $flag = function (string $k) use ($a): bool { return !empty($a[$k]); };
    $out = ['type' => $type, 'round' => $num('round', 0, 9999), 'text' => $txt('text', 400), 'rxn' => $flag('rxn'), 'prompt' => $txt('prompt', 40)];
    if (in_array($type, ['attack', 'maneuver', 'taunt', 'declare', 'ready'], true)) {
        $out['target'] = $txt('target', 40);
        $out['targetName'] = $txt('targetName', 80);
        // Up to 6 targets (one roll for all: spells and attacks on several creatures).
        $ts = is_array($a['targets'] ?? null) ? array_slice($a['targets'], 0, 6) : [];
        $out['targets'] = array_values(array_filter(array_map(function ($t) {
            if (!is_array($t) || !is_string($t['id'] ?? null)) return null;
            return ['id' => clip($t['id'], 40), 'name' => is_string($t['name'] ?? null) ? clip($t['name'], 80) : ''];
        }, $ts)));
    }
    if ($type === 'attack' || $type === 'maneuver' || $type === 'assist') {
        $out += ['tier' => $num('tier', 0, 3), 'crit' => $flag('crit'), 'doom' => $flag('doom')];
    }
    if ($type === 'attack') {
        $conds = is_array($a['conds'] ?? null) ? array_values(array_intersect(COMBAT_CONDS, array_filter($a['conds'], 'is_string'))) : [];
        $size = is_string($a['condMaxSize'] ?? null) && preg_match('/^[TSMLH]$/', $a['condMaxSize']) ? $a['condMaxSize'] : '';
        $out += ['label' => $txt('label', 120), 'damage' => $num('damage', 0, 999), 'piercing' => $flag('piercing'), 'cast' => $flag('cast'),
                 // Spell and weapon effects on each target.
                 'heal' => $num('heal', 0, 99), 'ad' => $num('ad', 0, 99), 'healWounds' => $num('healWounds', 0, 10), 'conds' => $conds,
                 'condMaxSize' => $size, 'push' => $num('push', 0, 10),
                 // For the Ref's options after a miss, a doom, or a crit: a counter (melee), a stray hit on an ally (ranged: the
                 // weapon's tier 2 or 3 damage), a backlash (a spell of this rank), or a lost limb (Dismember).
                 'melee' => $flag('melee'), 'ranged' => $flag('ranged'), 'allyDamage' => $num('allyDamage', 0, 999),
                 'allyDamage2' => $num('allyDamage2', 0, 999), 'rank' => $num('rank', 0, 9), 'backlash' => $flag('backlash'), 'dismember' => $flag('dismember')];
    }
    if ($type === 'maneuver') {
        $name = $a['name'] ?? '';
        if (!in_array($name, MANEUVERS, true)) fail('Unknown maneuver.');
        $out += ['name' => $name, 'jump' => $num('jump', 0, 20)];
    }
    if ($type === 'assist') $out += ['assistTo' => $txt('assistTo', 40), 'bonus' => $num('bonus', -1, 2)];
    if ($type === 'rest') {
        // The player's choices for the party's rest; the Ref Screen applies them when it finishes the rest.
        $food = $a['food'] ?? '';
        $out += ['food' => in_array($food, REST_FOODS, true) ? $food : '', 'activity' => $txt('activity', 40), 'repair' => $txt('repair', 80), 'study' => $txt('study', 60),
                 'useKit' => $flag('useKit'), 'tended' => $flag('tended'), 'tendedKit' => $flag('tendedKit'), 'caretaker' => $flag('caretaker')];
    }
    if ($type === 'defend') $out += ['hit' => $txt('hit', 40)];
    if ($type === 'move' || $type === 'ping') {
        // On the tabletop: the crow's token to a point on the map, or a ping there (map pixels).
        $fl = function (string $k) use ($a): float { $v = $a[$k] ?? 0; return is_numeric($v) ? round(max(0.0, min(100000.0, (float)$v)), 1) : 0.0; };
        $out += ['token' => $txt('token', 40), 'x' => $fl('x'), 'y' => $fl('y')];
    }
    if ($type === 'pickup') $out += ['item' => $txt('item', 40), 'itemName' => $txt('itemName', 80)];
    if ($type === 'drop') {
        // Items the crow put down: what's in its hands, or its backpack's contents (dump: the Dump Backpack maneuver).
        $items = is_array($a['items'] ?? null) ? array_slice($a['items'], 0, 12) : [];
        $out['dump'] = $flag('dump');
        $out['items'] = array_values(array_filter(array_map(function ($c) {
            if (!is_array($c) || !is_string($c['key'] ?? null) || $c['key'] === '' || strlen($c['key']) > 80) return null;
            $card = ['key' => $c['key'], 'qty' => max(1, min(999, (int)($c['qty'] ?? 1)))];
            foreach (['ud', 'dmg', 'ammo'] as $k) if (isset($c[$k]) && is_numeric($c[$k])) $card[$k] = max(0, min(999, (int)$c[$k]));
            return $card;
        }, $items)));
        if (!$out['items']) fail('Nothing to drop.');
    }
    return $out;
}

/** The Play page: the player's crow does something in its fight. */
function a_combat_act(): array {
    $s = need_login();
    $id = record_id();
    record_access('characters', $s, $id);
    $cid = combat_campaign_id();
    $r = member_combat($id, $cid);
    $c = $r ? json_decode($r['data']) : null;
    $atype = body()['action']['type'] ?? '';
    if ($atype === 'rest') {
        if (!$r || !is_object($c) || empty($c->session->rest->active)) fail('The party isn\'t resting any more.', 409);
    } elseif ($atype === 'move' || $atype === 'ping') {
        if (!$r || !is_object($c) || !is_object($c->table ?? null)) fail('The Ref isn\'t showing a map any more.', 409);
    } else {
        $in = $r && is_object($c) && !empty($c->active) && is_array($c->list ?? null) && array_filter($c->list, function ($x) use ($r) {
            return is_object($x) && ($x->kind ?? '') === 'pc' && (int)($x->link ?? 0) === (int)$r['access_id'];
        });
        if (!$in) fail('Your crow isn\'t in that fight any more.', 409);
    }
    if ((int)q('SELECT COUNT(*) FROM combat_actions WHERE character_id = ? AND created_at > ?', [$id, now(-10)])->fetchColumn() >= 15) {
        fail('That\'s a lot of actions at once. Wait a few seconds.', 429);
    }
    q('INSERT INTO combat_actions (campaign_id, character_id, data, created_at) VALUES (?,?,?,?)', [$cid, $id, enc(clean_action(body()['action'] ?? null)), now()]);
    $aid = (int)db()->lastInsertId();
    q('DELETE FROM combat_actions WHERE campaign_id = ? AND (id < ? OR created_at < ?)', [$cid, $aid - 300, now(-2 * 86400)]);
    signal('cacts', $cid, $aid);
    return ['id' => $aid];
}

/*
 * table.map: the picture of the map the Ref is showing in the campaign's tabletop (one of the Ref's own maps, kept in ref_art). Only the Ref and
 * the players of the crows in the fight get it, and only the map the published scene names, so a Ref's other pictures stay theirs.
 */
function serve_table_map(): void {
    $s = current_session();
    $cid = (int)($_GET['campaign'] ?? 0);
    $k = $_GET['key'] ?? '';
    $img = null;
    if ($s && $cid > 0 && is_string($k) && preg_match('/^m:[a-z0-9]{1,24}$/', $k)) {
        $owner = q('SELECT user_id FROM campaigns WHERE id = ?', [$cid])->fetchColumn();
        if ($owner !== false) {
            $shown = (string)q('SELECT data FROM combats WHERE campaign_id = ?', [$cid])->fetchColumn();
            $ok = (int)$owner === (int)$s['id'] || (strpos($shown, '"map":{"k":"' . $k . '"}') !== false && (int)q(
                'SELECT COUNT(*) FROM combat_members m JOIN characters c ON c.id = m.character_id LEFT JOIN character_control k ON k.character_id = c.id
                 WHERE m.campaign_id = ? AND (c.user_id = ? OR k.user_id = ?)', [$cid, $s['id'], $s['id']])->fetchColumn() > 0);
            if ($ok) $img = q('SELECT image FROM ref_art WHERE user_id = ? AND art_key = ?', [(int)$owner, $k])->fetchColumn();
        }
    }
    if ($img === false || $img === null) { http_response_code(404); header('Content-Type: text/plain'); echo 'Not found'; return; }
    header('Content-Type: image/jpeg');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Cache-Control: private, max-age=3600');
    header('Content-Length: ' . strlen($img));
    echo $img;
}

// ---------------------------------------------------------------- page layouts
/*
 * How a user arranged the blocks on each page of the apps (unlock the page, drag blocks between columns, lock it).
 * prefs.save merges one page at a time, so two devices arranging different pages don't undo each other; a null
 * layout resets that page to the default. Page names and block ids are short words; the whole thing is capped.
 */
const PREFS_MAX_BYTES = 65536;
function prefs_of(int $userId): array {
    $d = json_decode((string)q('SELECT data FROM user_prefs WHERE user_id = ?', [$userId])->fetchColumn(), true);
    return is_array($d) ? $d : [];
}
function clean_layout($l): ?array {
    if ($l === null) return null;
    if (!is_array($l) || !is_array($l['cols'] ?? null) || count($l['cols']) < 1 || count($l['cols']) > 4) fail('That page layout could not be read.');
    $preset = is_string($l['preset'] ?? null) && preg_match('/^[a-z-]{1,20}$/', $l['preset']) ? $l['preset'] : 'main-side';
    $cols = [];
    foreach ($l['cols'] as $col) {
        if (!is_array($col) || count($col) > 40) fail('That page layout could not be read.');
        $cols[] = array_values(array_filter($col, function ($id) { return is_string($id) && preg_match('/^[A-Za-z0-9_-]{1,40}$/', $id); }));
    }
    return ['preset' => $preset, 'cols' => $cols];
}
function a_prefs_get(): array {
    $s = need_login();
    $d = prefs_of($s['id']);
    $d['layouts'] = (object)($d['layouts'] ?? []);   // {} rather than [] when there are none
    return ['prefs' => (object)$d];
}
function a_prefs_save(): array {
    $s = need_login();
    $page = str('page', 40);
    if (!preg_match('/^[a-z0-9-]{1,40}$/', $page)) fail('Unknown page.');
    $layout = clean_layout(body()['layout'] ?? null);
    $d = prefs_of($s['id']);
    if (!isset($d['layouts']) || !is_array($d['layouts'])) $d['layouts'] = [];
    if ($layout === null) unset($d['layouts'][$page]); else $d['layouts'][$page] = $layout;
    if (!$d['layouts']) $d['layouts'] = new stdClass();
    $json = enc($d);
    if (strlen($json) > PREFS_MAX_BYTES) fail('Too many saved layouts.', 413);
    q('INSERT INTO user_prefs (user_id, data, updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE data = VALUES(data), updated_at = VALUES(updated_at)', [$s['id'], $json, now()]);
    return ['prefs' => json_decode($json)];
}

// ---------------------------------------------------------------- Ref pictures
/*
 * Maps and creature art a Ref adds on the Ref Screen, kept in their account (ref_art). art.list gives each picture's key, title and
 * small thumbnail; art.file serves one image (a plain JPEG, not JSON); art.save and art.delete change them. The app shrinks images
 * before sending, so each is capped at ART_MAX_BYTES, and an account at ART_MAX_ITEMS pictures / ART_MAX_TOTAL bytes.
 */
const ART_MAX_BYTES = 1400000;
const ART_MAX_ITEMS = 150;
const ART_MAX_TOTAL = 150000000;
function art_key(string $k): string {
    if (!preg_match('/^(m:[a-z0-9]{1,24}|c:[^\x00-\x1f<>]{1,60})$/u', $k)) fail('That picture has a bad name.');
    return $k;
}
function a_art_list(): array {
    $s = need_login();
    if (!can_ref($s)) fail('Only Refs can keep pictures.', 403);
    $rows = q('SELECT art_key, title, thumb, bytes, updated_at FROM ref_art WHERE user_id = ? ORDER BY updated_at', [$s['id']])->fetchAll();
    return ['art' => array_map(function ($r) {
        return ['key' => $r['art_key'], 'title' => $r['title'], 'thumb' => $r['thumb'], 'bytes' => (int)$r['bytes'], 'at' => strtotime($r['updated_at'] . ' UTC')];
    }, $rows)];
}
function a_art_save(): array {
    $s = need_login();
    if (!can_ref($s)) fail('Only Refs can keep pictures.', 403);
    $key = art_key(str('key', 100));
    $title = trim(str('title', 100));
    $thumb = str('thumb', 150000);
    if ($title === '' || !preg_match('#^data:image/jpeg;base64,[A-Za-z0-9+/=]+$#', $thumb)) fail('That picture could not be read.');
    if (!array_key_exists('image', body())) {   // a rename: keep the image
        $at = q('SELECT updated_at FROM ref_art WHERE user_id = ? AND art_key = ?', [$s['id'], $key])->fetchColumn();
        if ($at === false) fail('That picture is gone.', 404);
        q('UPDATE ref_art SET title = ? WHERE user_id = ? AND art_key = ?', [mb_substr($title, 0, 100), $s['id'], $key]);
        return ['at' => strtotime($at . ' UTC')];
    }
    $img = base64_decode(str('image', 2000000), true);
    if ($img === false || $img === '' || strlen($img) > ART_MAX_BYTES) fail('That picture is too large (1.4 MB after shrinking).', 413);
    $info = @getimagesizefromstring($img);
    if (!$info || $info[2] !== IMAGETYPE_JPEG) fail('Pictures must be JPEG.');
    $have = q('SELECT COUNT(*) AS n, COALESCE(SUM(bytes), 0) AS b, COALESCE(SUM(CASE WHEN art_key = ? THEN bytes END), 0) AS mine FROM ref_art WHERE user_id = ?', [$key, $s['id']])->fetch();
    $exists = (int)q('SELECT COUNT(*) FROM ref_art WHERE user_id = ? AND art_key = ?', [$s['id'], $key])->fetchColumn();
    if (!$exists && (int)$have['n'] >= ART_MAX_ITEMS) fail('You have the most pictures an account can keep. Delete some first.', 413);
    if ((int)$have['b'] - (int)$have['mine'] + strlen($img) > ART_MAX_TOTAL) fail('Your pictures are using all the space an account gets. Delete some first.', 413);
    $at = now();
    q('INSERT INTO ref_art (user_id, art_key, title, thumb, image, bytes, updated_at) VALUES (?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE title = VALUES(title), thumb = VALUES(thumb), image = VALUES(image), bytes = VALUES(bytes), updated_at = VALUES(updated_at)',
      [$s['id'], $key, mb_substr($title, 0, 100), $thumb, $img, strlen($img), $at]);
    return ['at' => strtotime($at . ' UTC')];
}
function a_art_delete(): array {
    $s = need_login();
    q('DELETE FROM ref_art WHERE user_id = ? AND art_key = ?', [$s['id'], art_key(str('key', 100))]);
    return [];
}
/* art.file?key=...: the image itself. Not JSON, so run_api hands it over before setting JSON headers. */
function serve_art(): void {
    $s = current_session();
    $k = $_GET['key'] ?? '';
    $img = null;
    if ($s && can_ref($s) && is_string($k) && preg_match('/^(m:[a-z0-9]{1,24}|c:[^\x00-\x1f<>]{1,60})$/u', $k)) {
        $img = q('SELECT image FROM ref_art WHERE user_id = ? AND art_key = ?', [$s['id'], $k])->fetchColumn();
    }
    if ($img === false || $img === null) { http_response_code(404); header('Content-Type: text/plain'); echo 'Not found'; return; }
    header('Content-Type: image/jpeg');
    header('X-Content-Type-Options: nosniff');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    header('Cache-Control: private, max-age=31536000, immutable');   // the URL carries the picture's version (&v=)
    header('Content-Length: ' . strlen($img));
    echo $img;
}

// ---------------------------------------------------------------- admin
function a_admin_users(): array {
    need_admin();
    $rows = q('SELECT u.id, u.username, u.email, u.role, u.is_admin, u.created_at, u.last_login,
                 (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.id) AS characters,
                 (SELECT COUNT(*) FROM campaigns m WHERE m.user_id = u.id) AS campaigns,
                 (SELECT method FROM mfa f WHERE f.user_id = u.id) AS mfa
               FROM users u ORDER BY u.username')->fetchAll();
    return ['users' => array_map(function ($r) {
        return ['id' => (int)$r['id'], 'username' => $r['username'], 'email' => $r['email'], 'role' => $r['role'],
                'isAdmin' => (bool)$r['is_admin'], 'createdAt' => $r['created_at'] . 'Z',
                'lastLogin' => $r['last_login'] ? $r['last_login'] . 'Z' : null,
                'characters' => (int)$r['characters'], 'campaigns' => (int)$r['campaigns'], 'mfa' => $r['mfa']];
    }, $rows)];
}

function target_user(array $admin, bool $allowSelf): int {
    $id = record_id();
    if (!$allowSelf && $id === $admin['id']) fail("You can't do that to your own account here.", 409);
    if (!q('SELECT 1 FROM users WHERE id = ?', [$id])->fetch()) fail('That user no longer exists.', 404);
    return $id;
}

function a_admin_set_role(): array {
    $a = need_admin();
    $id = target_user($a, true);
    $role = str('role', 10);
    if (!in_array($role, ROLES, true)) fail('Role must be player or ref.');
    q('UPDATE users SET role = ? WHERE id = ?', [$role, $id]);
    audit('role_set', $id, $role, $a['id']);
    return [];
}

function a_admin_set_admin(): array {
    $a = need_admin();
    $id = target_user($a, false);
    $on = empty(body()['isAdmin']) ? 0 : 1;
    q('UPDATE users SET is_admin = ? WHERE id = ?', [$on, $id]);
    audit($on ? 'admin_granted' : 'admin_revoked', $id, '', $a['id']);
    return [];
}

function a_admin_reset_link(): array {
    $a = need_admin();
    $id = target_user($a, true);
    audit('reset_link_made', $id, '', $a['id']);
    return ['link' => reset_link($id, 48)];
}

function a_admin_delete_user(): array {
    $a = need_admin();
    $id = target_user($a, false);
    $name = (string)q('SELECT username FROM users WHERE id = ?', [$id])->fetchColumn();
    q('DELETE FROM users WHERE id = ?', [$id]);
    audit('user_deleted', $id, $name, $a['id']);
    return [];
}

function a_admin_audit(): array {
    need_admin();
    $rows = q('SELECT l.at, l.event, l.ip, l.detail, u.username AS user, a.username AS actor
               FROM audit_log l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.actor_id
               ORDER BY l.id DESC LIMIT 300')->fetchAll();
    return ['events' => array_map(function ($r) {
        return ['at' => $r['at'] . 'Z', 'event' => $r['event'], 'user' => $r['user'], 'actor' => $r['actor'], 'ip' => $r['ip'], 'detail' => $r['detail']];
    }, $rows)];
}

// ---------------------------------------------------------------- map object detection (Claude vision)
// Only what blocks movement and sight is read from a map: walls, doors, and large solid objects of these types.
const MAP_OBJECT_TYPES = ['pillar','statue','shelf','crate','boulder','tree','rubble','other'];
const MAP_MAX_WALLS = 200, MAP_MAX_OBJECTS = 40;

/** Clip a model-supplied string to $max characters, with control characters and runs of space removed. */
function map_clip($v, int $max): string {
    if (!is_string($v)) return '';
    $v = trim(preg_replace('/[\x00-\x1f\x7f\s]+/u', ' ', $v) ?? '');
    return function_exists('mb_substr') ? mb_substr($v, 0, $max) : substr($v, 0, $max);
}
function map_frac($v, float $default = 0.0): float {
    return is_int($v) || is_float($v) ? round(max(0.0, min(1.0, (float)$v)), 4) : $default;
}

// ---------------------------------------------------------------- Ref's AI key vault
/*
 * ai_vaults: a Ref's own Anthropic API key, encrypted in their browser with a passphrase the server never sees. We keep only the
 * ciphertext blob and give it back only to its owner (the row is picked by the session, never by input). It is never in admin.users,
 * admin.audit, or any listing, and the audit log records only that it was saved or deleted.
 */
const VAULT_MAX_BYTES = 8192;
function vault_b64(mixed $v, int $minBytes, int $maxBytes): bool {
    if (!is_string($v) || $v === '' || !preg_match('#^[A-Za-z0-9+/]+={0,2}$#', $v)) return false;
    $raw = base64_decode($v, true);
    return $raw !== false && strlen($raw) >= $minBytes && strlen($raw) <= $maxBytes;
}
/** At most 10 saves an hour per person (a small file under sync/, like map.detect). */
function vault_save_throttle(int $userId): void {
    $dir = sync_dir();
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $fh = @fopen($dir . '/.aivault-' . $userId . '.json', 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    $times = json_decode((string)stream_get_contents($fh), true);
    $since = time() - 3600;
    $times = array_values(array_filter(is_array($times) ? $times : [], fn($t) => is_int($t) && $t > $since));
    $over = count($times) >= 10;
    if (!$over) $times[] = time();
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($times));
    flock($fh, LOCK_UN); fclose($fh);
    if ($over) fail('Too many key saves this hour. Please try again later.', 429);
}
function a_vault_get(): array {
    $s = need_ref('Only Refs can keep an AI key.');
    $r = q('SELECT vault, updated_at FROM ai_vaults WHERE user_id = ?', [$s['id']])->fetch();
    return $r ? ['vault' => $r['vault'], 'updatedAt' => strtotime($r['updated_at'] . ' UTC')] : ['vault' => null, 'updatedAt' => null];
}
function a_vault_save(): array {
    $s = need_ref('Only Refs can keep an AI key.');
    $blob = str('vault', VAULT_MAX_BYTES);
    $j = json_decode($blob, true);
    $keys = ['v', 'kdf', 'iter', 'salt', 'iv', 'ct', 'hint'];
    if (!is_array($j) || array_is_list($j) || array_diff(array_keys($j), $keys) || array_diff($keys, array_keys($j))
        || $j['v'] !== 1 || $j['kdf'] !== 'PBKDF2-SHA256'
        || !is_int($j['iter']) || $j['iter'] < 600000 || $j['iter'] > 5000000
        || !vault_b64($j['salt'], 16, 64) || !vault_b64($j['iv'], 12, 12) || !vault_b64($j['ct'], 1, 4096)
        || !is_string($j['hint']) || mb_strlen($j['hint']) > 4) {
        fail('That key vault is not in the expected format.');
    }
    vault_save_throttle((int)$s['id']);
    $at = now();
    q('INSERT INTO ai_vaults (user_id, vault, updated_at) VALUES (?,?,?) ON DUPLICATE KEY UPDATE vault = VALUES(vault), updated_at = VALUES(updated_at)',
      [$s['id'], $blob, $at]);
    audit('ai vault saved', (int)$s['id']);
    return ['updatedAt' => strtotime($at . ' UTC')];
}
function a_vault_delete(): array {
    $s = need_ref('Only Refs can keep an AI key.');
    q('DELETE FROM ai_vaults WHERE user_id = ?', [$s['id']]);
    audit('ai vault deleted', (int)$s['id']);
    return [];
}

/** At most 20 detections an hour per person, counted in a small file under sync/ (no table needed). */
function map_detect_throttle(int $userId): void {
    $dir = sync_dir();
    if (!is_dir($dir)) @mkdir($dir, 0755, true);
    $f = $dir . '/.mapdetect-' . $userId . '.json';
    $fh = @fopen($f, 'c+');
    if (!$fh) return;
    flock($fh, LOCK_EX);
    $times = json_decode((string)stream_get_contents($fh), true);
    $since = time() - 3600;
    $times = array_values(array_filter(is_array($times) ? $times : [], fn($t) => is_int($t) && $t > $since));
    $over = count($times) >= 20;
    if (!$over) $times[] = time();
    ftruncate($fh, 0); rewind($fh); fwrite($fh, json_encode($times));
    flock($fh, LOCK_UN); fclose($fh);
    if ($over) fail('Too many map scans this hour. Please try again later.', 429);
}

function a_map_detect(): array {
    $s = need_login();
    $c = config();
    $key = $c['anthropic_api_key'] ?? '';
    if (!is_string($key) || $key === '') fail('Automatic object detection is not set up on this server.', 503, ['code' => 'unconfigured']);
    $b = body();
    $img = $b['image'] ?? '';
    if (!is_string($img) || $img === '' || strlen($img) > 6000000 || !preg_match('/^[A-Za-z0-9+\/]+={0,2}$/', $img)) fail('Bad or oversized image.');
    $mime = $b['mime'] ?? 'image/jpeg';
    if (!is_string($mime) || !in_array($mime, ['image/jpeg', 'image/png', 'image/webp'], true)) fail('Unsupported image type.');
    $kind = $b['kind'] ?? 'dungeon';
    if (!is_string($kind) || !in_array($kind, ['dungeon', 'open', 'village'], true)) fail('Bad map kind.');
    $hasLabels = !empty($b['hasLabels']);
    $cols = is_int($b['cols'] ?? 0) ? max(0, min(500, $b['cols'])) : 0;
    $rows = is_int($b['rows'] ?? 0) ? max(0, min(500, $b['rows'])) : 0;
    $title = map_clip($b['title'] ?? '', 80);
    $envKeys = [];
    $ek = $b['envKeys'] ?? [];
    if (!is_array($ek) || count($ek) > 40) fail('Bad environment list.');
    foreach ($ek as $pair) {
        if (!is_array($pair) || !isset($pair[0]) || !is_string($pair[0]) || !preg_match('/^[A-Za-z0-9_-]{1,32}$/', $pair[0])) fail('Bad environment list.');
        $envKeys[$pair[0]] = map_clip($pair[1] ?? '', 40);
    }
    map_detect_throttle((int)$s['id']);

    $objSchema = ['type' => 'object', 'properties' => [
        'name' => ['type' => 'string', 'description' => 'Short name, at most 30 characters'],
        'type' => ['type' => 'string', 'enum' => MAP_OBJECT_TYPES],
        'x' => ['type' => 'number', 'description' => 'Centre, fraction of image width, 0 to 1'],
        'y' => ['type' => 'number', 'description' => 'Centre, fraction of image height, 0 to 1'],
        'w' => ['type' => 'number', 'description' => 'Footprint width, fraction of image width'],
        'h' => ['type' => 'number', 'description' => 'Footprint height, fraction of image height'],
    ], 'required' => ['name', 'type', 'x', 'y', 'w', 'h']];
    $wallSchema = ['type' => 'object', 'properties' => [
        'x1' => ['type' => 'number', 'description' => 'One end, fraction of image width'], 'y1' => ['type' => 'number', 'description' => 'One end, fraction of image height'],
        'x2' => ['type' => 'number', 'description' => 'Other end, fraction of image width'], 'y2' => ['type' => 'number', 'description' => 'Other end, fraction of image height'],
        'door' => ['type' => 'boolean', 'description' => 'A door across a doorway, not a wall'],
    ], 'required' => ['x1', 'y1', 'x2', 'y2']];
    $envSchema = ['type' => 'array', 'items' => $envKeys ? ['type' => 'string', 'enum' => array_keys($envKeys)] : ['type' => 'string']];
    $tool = ['name' => 'report_objects', 'description' => 'Report the walls, doors, and large blocking objects on the battle map.',
        'input_schema' => ['type' => 'object', 'properties' => [
            'walls' => ['type' => 'array', 'maxItems' => MAP_MAX_WALLS, 'items' => $wallSchema],
            'objects' => ['type' => 'array', 'maxItems' => MAP_MAX_OBJECTS, 'items' => $objSchema],
            'env' => $envSchema,
        ], 'required' => ['walls', 'objects', 'env']]];

    // Keep in step with detectPayload in ref/src/ref-ai.js (the same scan with the Ref's own key).
    $prompt = 'This image is a top-down tabletop RPG battle map' . ($title !== '' ? ' titled "' . $title . '"' : '')
        . ' (' . $kind . ' setting' . ($cols > 0 && $rows > 0 ? ", $cols x $rows squares" : '') . '). '
        . ($cols > 0 ? 'One grid square is 1/' . $cols . ' of the image width' . ($rows > 0 ? ' and 1/' . $rows . ' of its height' : '') . '. ' : 'If the map shows a grid, measure against it. ')
        . 'Report only what stops a person both moving and seeing past it. '
        . 'Walls: each straight run of wall as one segment along its middle, from corner to corner; split a curved or cave wall into short straight segments; follow grid lines where the wall does. '
        . 'Leave a gap at every doorway and report each door as its own segment across the doorway with door true. Open archways, windows, low walls, cliff edges, and map borders with no wall drawn are not walls. '
        . 'Objects: only large solid things a person cannot see over or walk through, about one square across or more, such as pillars, columns, big statues, bookcases and tall shelves, stacked crates, boulders, tree trunks, standing stones. '
        . 'Give each one\'s centre (x, y) and the footprint it is drawn with (w, h), measured on the grid. '
        . 'Do not report anything a person can see over or that is small: tables, chairs, beds, chests, barrels, altars, wells, lights, traps, stairs, rugs, bodies, or decoration. '
        . 'All positions and sizes are fractions of the image width (x, w) and height (y, h), 0 to 1. '
        . ($hasLabels ? 'The map has printed labels or a legend: use them to name objects, and do NOT report the label text itself. ' : '')
        . 'Keep names short (30 characters or fewer). Report at most ' . MAP_MAX_WALLS . ' wall segments and ' . MAP_MAX_OBJECTS . ' objects. '
        . ($envKeys ? 'In env, list keys from the allowed set only when the picture clearly implies them (for example a dark cave); usually leave it empty. Allowed: '
            . implode(', ', array_map(fn($k, $l) => $l !== '' ? "$k ($l)" : (string)$k, array_keys($envKeys), $envKeys)) . '. ' : 'Leave env empty. ')
        . 'Answer by calling report_objects.';
    $model = is_string($c['anthropic_model'] ?? null) && $c['anthropic_model'] !== '' ? $c['anthropic_model'] : 'claude-sonnet-5-5';
    $payload = ['model' => $model, 'max_tokens' => 16000, 'tools' => [$tool], 'tool_choice' => ['type' => 'auto'],   // newer models refuse a forced tool; the prompt asks for it
        'messages' => [['role' => 'user', 'content' => [
            ['type' => 'image', 'source' => ['type' => 'base64', 'media_type' => $mime, 'data' => $img]],
            ['type' => 'text', 'text' => $prompt],
        ]]]];

    @set_time_limit(200);   // tracing every wall is a long answer
    $ch = curl_init('https://api.anthropic.com/v1/messages');
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 180, CURLOPT_CONNECTTIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_HTTPHEADER => ['x-api-key: ' . $key, 'anthropic-version: 2023-06-01', 'content-type: application/json']]);
    $out = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $j = is_string($out) ? json_decode($out, true) : null;
    if ($code !== 200 || !is_array($j)) {
        error_log('crows map.detect: upstream HTTP ' . $code . (is_array($j) && isset($j['error']['type']) ? ' ' . $j['error']['type'] . ': ' . map_clip($j['error']['message'] ?? '', 200) : ''));
        fail('The object detector is not available right now.', 502);
    }
    $input = null;
    foreach (($j['content'] ?? []) as $blk) {
        if (is_array($blk) && ($blk['type'] ?? '') === 'tool_use' && ($blk['name'] ?? '') === 'report_objects' && is_array($blk['input'] ?? null)) { $input = $blk['input']; break; }
    }
    if ($input === null) fail('The object detector gave no answer.', 502);

    $objects = [];
    foreach (is_array($input['objects'] ?? null) ? $input['objects'] : [] as $o) {
        if (count($objects) >= MAP_MAX_OBJECTS) break;
        if (!is_array($o) || !isset($o['x'], $o['y']) || !is_numeric($o['x']) || !is_numeric($o['y'])) continue;
        $name = map_clip($o['name'] ?? '', 30);
        if ($name === '') continue;
        $type = is_string($o['type'] ?? null) && in_array($o['type'], MAP_OBJECT_TYPES, true) ? $o['type'] : 'other';
        $w = map_frac($o['w'] ?? 0, 0.03); $h = map_frac($o['h'] ?? 0, 0.03);
        $objects[] = ['name' => $name, 'type' => $type, 'x' => map_frac($o['x']), 'y' => map_frac($o['y']), 'w' => max(0.005, $w), 'h' => max(0.005, $h)];
    }
    $walls = [];
    foreach (is_array($input['walls'] ?? null) ? $input['walls'] : [] as $wl) {
        if (count($walls) >= MAP_MAX_WALLS) break;
        if (!is_array($wl)) continue;
        foreach (['x1', 'y1', 'x2', 'y2'] as $k) if (!isset($wl[$k]) || !is_numeric($wl[$k])) continue 2;
        $seg = ['x1' => map_frac($wl['x1']), 'y1' => map_frac($wl['y1']), 'x2' => map_frac($wl['x2']), 'y2' => map_frac($wl['y2'])];
        if (abs($seg['x1'] - $seg['x2']) + abs($seg['y1'] - $seg['y2']) < 0.002) continue;
        $seg['door'] = ($wl['door'] ?? false) === true;
        $walls[] = $seg;
    }
    $env = [];
    foreach (is_array($input['env'] ?? null) ? $input['env'] : [] as $e) {
        if (is_string($e) && isset($envKeys[$e]) && !in_array($e, $env, true)) $env[] = $e;
    }
    return ['objects' => $objects, 'walls' => $walls, 'env' => $env, 'model' => $model];
}

// ---------------------------------------------------------------- dispatch
const ACTIONS = [
    // name => [method, handler, needs csrf]
    'me' => ['GET', 'a_me', false],
    'register' => ['POST', 'a_register', false],
    'map.detect' => ['POST', 'a_map_detect', true],
    'register.verify' => ['POST', 'a_register_verify', false],
    'register.resend' => ['POST', 'a_register_resend', false],
    'login' => ['POST', 'a_login', false],
    'forgot' => ['POST', 'a_forgot', false],
    'reset' => ['POST', 'a_reset', false],
    'logout' => ['POST', 'a_logout', true],
    'account.update' => ['POST', 'a_account_update', true],
    'account.logoutOthers' => ['POST', 'a_account_logout_others', true],
    'account.emailPrefs' => ['GET', 'a_account_email_prefs', false],
    'account.mfa' => ['GET', 'a_account_mfa', false],
    'account.mfaChange' => ['POST', 'a_account_mfa_change', true],
    'account.mfaRecovery' => ['POST', 'a_account_mfa_recovery', true],
    'account.mfaOff' => ['POST', 'a_account_mfa_off', true],
    'account.discord' => ['GET', 'a_account_discord', false],
    'account.discordLink' => ['POST', 'a_account_discord_link', true],
    'account.discordUnlink' => ['POST', 'a_account_discord_unlink', true],
    'discord.start' => ['POST', 'a_discord_start', false],
    // The second login step: authorised by the challenge token (there's no session yet), JSON-only like every POST.
    'mfa.verify' => ['POST', 'a_mfa_verify', false],
    'mfa.resend' => ['POST', 'a_mfa_resend', false],
    'mfa.setupStart' => ['POST', 'a_mfa_setup_start', false],
    'mfa.setupFinish' => ['POST', 'a_mfa_setup_finish', false],
    'account.setEmailPrefs' => ['POST', 'a_account_set_email_prefs', true],
    'account.delete' => ['POST', 'a_account_delete', true],
    'list' => ['GET', 'a_list', false],
    'get' => ['GET', 'a_get', false],
    'create' => ['POST', 'a_create', true],
    'save' => ['POST', 'a_save', true],
    'duplicate' => ['POST', 'a_duplicate', true],
    'delete' => ['POST', 'a_delete', true],
    'share.get' => ['GET', 'a_share_get', false],
    'share.create' => ['POST', 'a_share_create', true],
    'share.disable' => ['POST', 'a_share_disable', true],
    'share.revoke' => ['POST', 'a_share_revoke', true],
    'share.allowControl' => ['POST', 'a_share_allow_control', true],
    'control.get' => ['GET', 'a_control_get', false],
    'control.give' => ['POST', 'a_control_give', true],
    'control.take' => ['POST', 'a_control_take', true],
    'control.claim' => ['POST', 'a_control_claim', true],
    'control.release' => ['POST', 'a_control_release', true],
    'control.list' => ['GET', 'a_control_list', false],
    'link.preview' => ['GET', 'a_link_preview', false],
    'link.redeem' => ['POST', 'a_link_redeem', true],
    'link.get' => ['GET', 'a_link_get', false],
    'link.save' => ['POST', 'a_link_save', true],
    'link.remove' => ['POST', 'a_link_remove', true],
    'invite.get' => ['GET', 'a_invite_get', false],
    'invite.create' => ['POST', 'a_invite_create', true],
    'invite.disable' => ['POST', 'a_invite_disable', true],
    'invite.list' => ['POST', 'a_invite_list', true],
    'campaigns.search' => ['GET', 'a_campaigns_search', false],
    'join.preview' => ['GET', 'a_join_preview', false],
    'join.request' => ['POST', 'a_join_request', true],
    'join.cancel' => ['POST', 'a_join_cancel', true],
    'join.accept' => ['POST', 'a_join_accept', true],
    'join.decline' => ['POST', 'a_join_decline', true],
    'characters.campaigns' => ['GET', 'a_characters_campaigns', false],
    'combat.publish' => ['POST', 'a_combat_publish', true],
    'combat.actions' => ['GET', 'a_combat_actions', false],
    'combat.mine' => ['GET', 'a_combat_mine', false],
    'combat.act' => ['POST', 'a_combat_act', true],
    'prefs.get' => ['GET', 'a_prefs_get', false],
    'prefs.save' => ['POST', 'a_prefs_save', true],
    'art.list' => ['GET', 'a_art_list', false],
    'art.save' => ['POST', 'a_art_save', true],
    'art.delete' => ['POST', 'a_art_delete', true],
    'vault.get' => ['GET', 'a_vault_get', false],
    'vault.save' => ['POST', 'a_vault_save', true],
    'vault.delete' => ['POST', 'a_vault_delete', true],
    'chat.campaigns' => ['GET', 'a_chat_campaigns', false],
    'chat.list' => ['GET', 'a_chat_list', false],
    'chat.send' => ['POST', 'a_chat_send', true],
    'chat.delete' => ['POST', 'a_chat_delete', true],
    'notes.list' => ['GET', 'a_notes_list', false],
    'notes.dismiss' => ['POST', 'a_notes_dismiss', true],
    'admin.users' => ['GET', 'a_admin_users', false],
    'admin.audit' => ['GET', 'a_admin_audit', false],
    'admin.setRole' => ['POST', 'a_admin_set_role', true],
    'admin.setAdmin' => ['POST', 'a_admin_set_admin', true],
    'admin.resetLink' => ['POST', 'a_admin_reset_link', true],
    'admin.deleteUser' => ['POST', 'a_admin_delete_user', true],
    'admin.resetMfa' => ['POST', 'a_admin_reset_mfa', true],
];

function run_api(): void {
    if (($_GET['a'] ?? '') === 'art.file' && $_SERVER['REQUEST_METHOD'] === 'GET') { try { serve_art(); } catch (Throwable $e) { error_log('crows art: ' . $e); http_response_code(500); } return; }
    if (($_GET['a'] ?? '') === 'table.map' && $_SERVER['REQUEST_METHOD'] === 'GET') { try { serve_table_map(); } catch (Throwable $e) { error_log('crows table map: ' . $e); http_response_code(500); } return; }
    if (($_GET['a'] ?? '') === 'discord.callback' && $_SERVER['REQUEST_METHOD'] === 'GET') { discord_callback(); return; }
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header("Content-Security-Policy: default-src 'none'; frame-ancestors 'none'");
    try {
        $a = $_GET['a'] ?? '';
        if (!is_string($a) || !isset(ACTIONS[$a])) fail('Unknown action.', 404);
        [$method, $fn, $csrf] = ACTIONS[$a];
        if ($_SERVER['REQUEST_METHOD'] !== $method) fail('Wrong method.', 405);
        if ($method === 'POST') {
            if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'application/json') !== 0) fail('Expected JSON.', 415);
            if ($csrf) {
                $s = current_session();
                if (!$s) fail('Please log in again.', 401);
                if (!hash_equals($s['csrf'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) fail('Your session is out of date. Reload the page.', 403);
            }
        }
        $out = ['ok' => true] + $fn();
    } catch (ApiError $e) {
        http_response_code($e->status);
        $out = ['ok' => false, 'error' => $e->getMessage()] + $e->extra;
    } catch (Throwable $e) {
        error_log('crows api: ' . $e);
        http_response_code(500);
        $out = ['ok' => false, 'error' => 'Something went wrong on the server. Please try again.'];
    }
    echo json_encode($out, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
}
