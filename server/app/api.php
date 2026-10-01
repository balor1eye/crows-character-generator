<?php
/*
 * Crows accounts JSON API. Reached through public/api.php?a=<action>.
 *
 * Reads are GET, writes are POST with a JSON body. Every POST must be application/json (so a
 * cross-site form can't forge one), and once logged in it must also carry the session's CSRF
 * token in the X-CSRF-Token header. Responses are {ok: true, ...} or {ok: false, error: "..."}.
 */
declare(strict_types=1);
require __DIR__ . '/bootstrap.php';

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
    return $raw ??= (string)file_get_contents('php://input', false, null, 0, MAX_DATA_BYTES + 100000);
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
    $from = $c['mail_from'] ?? '';
    $headers = "Content-Type: text/plain; charset=UTF-8\r\n" . ($from ? "From: Crows <$from>\r\n" : '');
    return @mail($to, $subject, $text, $headers, $from ? '-f' . $from : '');
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
    return ['user' => $s ? public_user($s) : null, 'csrf' => $s ? $s['csrf'] : null, 'https' => is_https()];
}

function a_register(): array {
    $username = valid_username(str('username', 64));
    $email = valid_email(str('email', 300));
    $pw = valid_password(str('password', 300), $username, $email);
    throttle('register', 1000, 10, 3600);
    note_attempt('register');
    if (q('SELECT 1 FROM users WHERE username = ?', [$username])->fetch()) fail('That username is taken.', 409);
    if (q('SELECT 1 FROM users WHERE email = ?', [$email])->fetch()) fail('An account already uses that email. Try logging in or resetting your password.', 409);
    q('INSERT INTO users (username, email, pass_hash, role, is_admin, created_at) VALUES (?,?,?,?,0,?)',
      [$username, $email, hash_password($pw), 'player', now()]);
    $id = (int)db()->lastInsertId();
    audit('register', $id, $username);
    $sess = start_session($id);
    $u = q('SELECT * FROM users WHERE id = ?', [$id])->fetch();
    return ['user' => public_user($u), 'csrf' => $sess['csrf']];
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
    audit('login', (int)$u['id']);
    q('DELETE FROM login_attempts WHERE login = ?', [$key]);
    $sess = start_session((int)$u['id']);
    return ['user' => public_user($u), 'csrf' => $sess['csrf']];
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
        send_mail($u['email'], 'Reset your Crows password',
            "Hi {$u['username']},\n\nSomeone (hopefully you) asked to reset the password for your Crows account.\n" .
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
    $sess = start_session($uid);
    $u = q('SELECT * FROM users WHERE id = ?', [$uid])->fetch();
    return ['user' => public_user($u), 'csrf' => $sess['csrf']];
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
        audit('email_changed', $s['id']);
        // Tell the old address, so a hijacked account doesn't go unnoticed.
        send_mail($s['email'], 'Your Crows account email was changed',
            "Hi {$s['username']},\n\nThe email on your Crows account was just changed to $email.\n" .
            "If you didn't do this, contact the site admin right away.\n");
    }
    if (is_string($newPw) && $newPw !== '') {
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [hash_password(valid_password($newPw, $s['username'], (string)($email ?: $s['email']))), $s['id']]);
        // A new password signs out every other device.
        q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s['id'], $s['token_hash']]);
        audit('password_changed', $s['id']);
        send_mail(is_string($email) && $email !== '' ? $email : $s['email'], 'Your Crows password was changed',
            "Hi {$s['username']},\n\nThe password on your Crows account was just changed, and your other devices were logged out.\n" .
            "If you didn't do this, reset your password and contact the site admin.\n");
    }
    return ['user' => public_user(q('SELECT * FROM users WHERE id = ?', [$s['id']])->fetch())];
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
    $rows = q("SELECT id, name, summary, version, created_at, updated_at FROM $k WHERE user_id = ? ORDER BY updated_at DESC", [$s['id']])->fetchAll();
    return ['items' => array_map('row_out', $rows)];
}

function a_get(): array {
    $k = kind(); $s = owner_for($k);
    $id = record_id();
    $known = (int)($_GET['known'] ?? 0);
    if ($known) {
        // Polling: answer "unchanged" without sending the whole save.
        $v = q("SELECT version FROM $k WHERE id = ? AND user_id = ?", [$id, $s['id']])->fetchColumn();
        if ($v === false) fail('That save was not found. It may have been deleted.', 404);
        if ((int)$v === $known) return ['item' => ['id' => $id, 'version' => $known, 'unchanged' => true]];
    }
    $r = q("SELECT * FROM $k WHERE id = ? AND user_id = ?", [$id, $s['id']])->fetch();
    if (!$r) fail('That save was not found. It may have been deleted.', 404);
    return ['item' => with_watch(row_out($r, true), $k, $id)];
}

function a_create(): array {
    $k = kind(); $s = owner_for($k);
    $data = record_data();
    if ((int)q("SELECT COUNT(*) FROM $k WHERE user_id = ?", [$s['id']])->fetchColumn() >= MAX_RECORDS) {
        fail('You have reached the limit of ' . MAX_RECORDS . ' saves. Delete some old ones first.', 409);
    }
    q("INSERT INTO $k (user_id, name, summary, data, version, created_at, updated_at) VALUES (?,?,?,?,1,?,?)",
      [$s['id'], clip(str('name', 1000), 120), clip(str('summary', 2000), 255), $data, now(), now()]);
    $r = q("SELECT * FROM $k WHERE id = ?", [(int)db()->lastInsertId()])->fetch();
    return ['item' => with_watch(row_out($r), $k, (int)$r['id'])];
}

function a_save(): array {
    $k = kind(); $s = owner_for($k);
    $id = record_id();
    $data = record_data();
    $force = !empty(body()['force']);
    $base = body()['version'] ?? 0;
    $args = [$data, clip(str('name', 1000), 120), clip(str('summary', 2000), 255), now(), $id, $s['id']];
    $sql = "UPDATE $k SET data = ?, name = ?, summary = ?, version = version + 1, updated_at = ? WHERE id = ? AND user_id = ?";
    if (!$force) { $sql .= ' AND version = ?'; $args[] = (int)$base; }
    $n = q($sql, $args)->rowCount();
    $r = q("SELECT id, name, summary, version, created_at, updated_at FROM $k WHERE id = ? AND user_id = ?", [$id, $s['id']])->fetch();
    if (!$r) fail('That save was not found. It may have been deleted.', 404);
    if ($n === 0 && !$force && (int)$r['version'] !== (int)$base) {
        fail('This was changed in another window or device.', 409, ['item' => row_out($r)]);
    }
    if ($n) signal($k, $id, (int)$r['version']);
    return ['item' => with_watch(row_out($r), $k, $id)];
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
 * cruelty, coins, and the log those buttons write to), equipment (which carries armor damage), and notes.
 * link.save merges just those fields. The player sees who has access and can remove it; deleting the
 * character removes it too.
 */
// Field name => path in the character (must match LINK_FIELDS in src/cloud.js).
const SHARED_FIELDS = ['inv' => ['inv'], 'notes' => ['notes'], 'coins' => ['coins'], 'conds' => ['play', 'conds'],
    'stamina' => ['play', 'stamina'], 'cruelty' => ['play', 'cruelty'], 'wounds' => ['play', 'wounds'], 'log' => ['play', 'log']];

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
    $refs = q('SELECT a.id, a.created_at, u.username FROM character_access a JOIN users u ON u.id = a.ref_user_id
               WHERE a.character_id = ? ORDER BY a.created_at', [$c['id']])->fetchAll();
    return ['hasLink' => $has, 'refs' => array_map(function ($r) {
        return ['accessId' => (int)$r['id'], 'username' => $r['username'], 'since' => $r['created_at'] . 'Z'];
    }, $refs)];
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
function need_ref(): array {
    $s = need_login();
    if (!can_ref($s)) fail('Only Refs can add characters to a campaign. Send this link to your Ref.', 403);
    return $s;
}

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
function clean_log($l): array {
    if (!is_array($l) || count($l) > 200) fail('Bad log.');
    $out = [];
    foreach ($l as $e) {
        if (!is_object($e) || !is_string($e->m ?? null) || mb_strlen($e->m) > 1000) fail('Bad log entry.');
        $out[] = (object)['t' => clean_int($e->t ?? 0, 0, PHP_INT_MAX, 'log time'), 'm' => $e->m];
    }
    return $out;
}
/** The current log plus the entries the Ref added since $base (both sides add entries, so they're combined, not compared). */
function merge_log($cur, array $mine, $base): array {
    $key = function ($e) { return is_object($e) && is_scalar($e->t ?? null) && is_string($e->m ?? null) ? $e->t . '|' . $e->m : null; };
    $cur = is_array($cur) ? $cur : [];
    $seen = [];
    foreach (array_merge($cur, is_array($base) ? $base : []) as $e) if ($key($e) !== null) $seen[$key($e)] = true;
    foreach ($mine as $e) if (!isset($seen[$key($e)])) { $cur[] = $e; $seen[$key($e)] = true; }
    usort($cur, function ($a, $b) { return ($b->t ?? 0) <=> ($a->t ?? 0); });
    return array_slice($cur, 0, 200);
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
            if (!isset(SHARED_FIELDS[$f])) fail('A Ref can only change the vitals, equipment, and notes.', 403);
            if (!property_exists($b->base, $f)) fail('Nothing to save.');
            if ($f !== 'log' && canon(field_get($data, $f)) !== canon($b->base->$f)) {
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

// ---------------------------------------------------------------- admin
function a_admin_users(): array {
    need_admin();
    $rows = q('SELECT u.id, u.username, u.email, u.role, u.is_admin, u.created_at, u.last_login,
                 (SELECT COUNT(*) FROM characters c WHERE c.user_id = u.id) AS characters,
                 (SELECT COUNT(*) FROM campaigns m WHERE m.user_id = u.id) AS campaigns
               FROM users u ORDER BY u.username')->fetchAll();
    return ['users' => array_map(function ($r) {
        return ['id' => (int)$r['id'], 'username' => $r['username'], 'email' => $r['email'], 'role' => $r['role'],
                'isAdmin' => (bool)$r['is_admin'], 'createdAt' => $r['created_at'] . 'Z',
                'lastLogin' => $r['last_login'] ? $r['last_login'] . 'Z' : null,
                'characters' => (int)$r['characters'], 'campaigns' => (int)$r['campaigns']];
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

// ---------------------------------------------------------------- dispatch
const ACTIONS = [
    // name => [method, handler, needs csrf]
    'me' => ['GET', 'a_me', false],
    'register' => ['POST', 'a_register', false],
    'login' => ['POST', 'a_login', false],
    'forgot' => ['POST', 'a_forgot', false],
    'reset' => ['POST', 'a_reset', false],
    'logout' => ['POST', 'a_logout', true],
    'account.update' => ['POST', 'a_account_update', true],
    'account.logoutOthers' => ['POST', 'a_account_logout_others', true],
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
    'link.preview' => ['GET', 'a_link_preview', false],
    'link.redeem' => ['POST', 'a_link_redeem', true],
    'link.get' => ['GET', 'a_link_get', false],
    'link.save' => ['POST', 'a_link_save', true],
    'link.remove' => ['POST', 'a_link_remove', true],
    'admin.users' => ['GET', 'a_admin_users', false],
    'admin.audit' => ['GET', 'a_admin_audit', false],
    'admin.setRole' => ['POST', 'a_admin_set_role', true],
    'admin.setAdmin' => ['POST', 'a_admin_set_admin', true],
    'admin.resetLink' => ['POST', 'a_admin_reset_link', true],
    'admin.deleteUser' => ['POST', 'a_admin_delete_user', true],
];

function run_api(): void {
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
