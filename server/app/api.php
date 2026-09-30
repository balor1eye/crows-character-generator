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

function body(): array {
    static $b = null;
    if ($b !== null) return $b;
    $raw = file_get_contents('php://input', false, null, 0, MAX_DATA_BYTES + 100000);
    $b = $raw === '' || $raw === false ? [] : json_decode($raw, true, 64);
    if (!is_array($b)) fail('The request was not valid JSON.');
    return $b;
}

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
function valid_password(string $p): string {
    if (strlen($p) < 8) fail('Passwords need at least 8 characters.');
    if (strlen($p) > 200) fail('That password is too long.');
    return $p;
}
function check_password(array $s, string $pw): void {
    $row = q('SELECT pass_hash FROM users WHERE id = ?', [$s['id']])->fetch();
    if (!$row || !password_verify($pw, $row['pass_hash'])) fail('Your current password is not correct.', 403);
}

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
    $pw = valid_password(str('password', 300));
    throttle('register', 1000, 10, 3600);
    note_attempt('register');
    if (q('SELECT 1 FROM users WHERE username = ?', [$username])->fetch()) fail('That username is taken.', 409);
    if (q('SELECT 1 FROM users WHERE email = ?', [$email])->fetch()) fail('An account already uses that email. Try logging in or resetting your password.', 409);
    q('INSERT INTO users (username, email, pass_hash, role, is_admin, created_at) VALUES (?,?,?,?,0,?)',
      [$username, $email, password_hash($pw, PASSWORD_DEFAULT), 'player', now()]);
    $id = (int)db()->lastInsertId();
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
    if (!$u || !password_verify($pw, $u['pass_hash'])) {
        note_attempt($key);
        fail('That username or password is not correct.', 401);
    }
    if (password_needs_rehash($u['pass_hash'], PASSWORD_DEFAULT)) {
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $u['id']]);
    }
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
    $pw = valid_password(str('password', 300));
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) fail('That reset link is not valid.');
    $row = q('SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?', [sha($tok)])->fetch();
    if (!$row || $row['expires_at'] < now()) fail('That reset link has expired. Ask for a new one.', 410);
    $uid = (int)$row['user_id'];
    q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash($pw, PASSWORD_DEFAULT), $uid]);
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
    }
    if (is_string($newPw) && $newPw !== '') {
        q('UPDATE users SET pass_hash = ? WHERE id = ?', [password_hash(valid_password($newPw), PASSWORD_DEFAULT), $s['id']]);
        // A new password signs out every other device.
        q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s['id'], $s['token_hash']]);
    }
    return ['user' => public_user(q('SELECT * FROM users WHERE id = ?', [$s['id']])->fetch())];
}

function a_account_logout_others(): array {
    $s = need_login();
    q('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [$s['id'], $s['token_hash']]);
    return [];
}

function a_account_delete(): array {
    $s = need_login();
    check_password($s, str('password', 300));
    if ($s['is_admin'] && (int)q('SELECT COUNT(*) FROM users WHERE is_admin = 1')->fetchColumn() <= 1) {
        fail('You are the only admin. Make someone else an admin before deleting your account.', 409);
    }
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
    $d = body()['data'] ?? null;
    if (!is_array($d) || array_is_list($d) && $d !== []) fail('Missing save data.');
    $json = json_encode($d, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($json === false) fail('Could not store that save.');
    if (strlen($json) > MAX_DATA_BYTES) fail('That save is too large to store (2 MB limit).', 413);
    return $json;
}
function clip(string $s, int $n): string { return mb_substr(trim(preg_replace('/\s+/', ' ', $s)), 0, $n); }
function row_out(array $r, bool $withData = false): array {
    $o = ['id' => (int)$r['id'], 'name' => $r['name'], 'summary' => $r['summary'], 'version' => (int)$r['version'],
          'createdAt' => $r['created_at'] . 'Z', 'updatedAt' => $r['updated_at'] . 'Z'];
    if ($withData) $o['data'] = json_decode($r['data'], true);
    return $o;
}

function a_list(): array {
    $k = kind(); $s = owner_for($k);
    $rows = q("SELECT id, name, summary, version, created_at, updated_at FROM $k WHERE user_id = ? ORDER BY updated_at DESC", [$s['id']])->fetchAll();
    return ['items' => array_map('row_out', $rows)];
}

function a_get(): array {
    $k = kind(); $s = owner_for($k);
    $r = q("SELECT * FROM $k WHERE id = ? AND user_id = ?", [record_id(), $s['id']])->fetch();
    if (!$r) fail('That save was not found. It may have been deleted.', 404);
    return ['item' => row_out($r, true)];
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
    return ['item' => row_out($r)];
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
    return ['item' => row_out($r)];
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
    q("DELETE FROM $k WHERE id = ? AND user_id = ?", [record_id(), $s['id']]);
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
    return [];
}

function a_admin_set_admin(): array {
    $a = need_admin();
    $id = target_user($a, false);
    q('UPDATE users SET is_admin = ? WHERE id = ?', [empty(body()['isAdmin']) ? 0 : 1, $id]);
    return [];
}

function a_admin_reset_link(): array {
    $a = need_admin();
    $id = target_user($a, true);
    return ['link' => reset_link($id, 48)];
}

function a_admin_delete_user(): array {
    $a = need_admin();
    q('DELETE FROM users WHERE id = ?', [target_user($a, false)]);
    return [];
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
    'admin.users' => ['GET', 'a_admin_users', false],
    'admin.setRole' => ['POST', 'a_admin_set_role', true],
    'admin.setAdmin' => ['POST', 'a_admin_set_admin', true],
    'admin.resetLink' => ['POST', 'a_admin_reset_link', true],
    'admin.deleteUser' => ['POST', 'a_admin_delete_user', true],
];

function run_api(): void {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
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
