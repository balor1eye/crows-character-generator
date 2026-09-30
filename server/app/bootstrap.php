<?php
/*
 * Crows accounts: shared setup for the web entry points (public/api.php, public/ref.php) and the
 * command-line tools. Lives outside the web root; config.php (not in git) sits next to it.
 * All times are stored in UTC, computed in PHP (never MySQL's NOW()).
 */
declare(strict_types=1);

const SESSION_COOKIE = 'crows_session';
const SESSION_DAYS = 30;
const MAX_DATA_BYTES = 2000000;      // one character or campaign save
const MAX_RECORDS = 200;             // per user, per kind
const ROLES = ['player', 'ref'];

function config(): array {
    static $cfg = null;
    if ($cfg === null) {
        $file = __DIR__ . '/config.php';
        if (!is_file($file)) throw new RuntimeException('config.php is missing; copy config.sample.php and fill it in');
        $cfg = require $file;
    }
    return $cfg;
}

function db(): PDO {
    static $pdo = null;
    if ($pdo === null) {
        $c = config();
        $pdo = new PDO('mysql:host=' . $c['db_host'] . ';dbname=' . $c['db_name'] . ';charset=utf8mb4', $c['db_user'], $c['db_pass'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        $pdo->exec("SET time_zone = '+00:00'");
    }
    return $pdo;
}

function q(string $sql, array $args = []): PDOStatement {
    $st = db()->prepare($sql);
    $st->execute($args);
    return $st;
}

function now(int $offset = 0): string { return gmdate('Y-m-d H:i:s', time() + $offset); }
function token(): string { return bin2hex(random_bytes(32)); }
function sha(string $s): string { return hash('sha256', $s); }

function is_https(): bool {
    return (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off')
        || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
}

function cookie_path(): string { return config()['cookie_path'] ?? '/'; }

function set_session_cookie(string $value, int $expires): void {
    setcookie(SESSION_COOKIE, $value, [
        'expires' => $expires, 'path' => cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax',
    ]);
}

/** The logged-in user (with the session's csrf token), or null. Extends the session as it's used. */
function current_session(): ?array {
    static $cache = false;
    if ($cache !== false) return $cache;
    $cache = null;
    $tok = $_COOKIE[SESSION_COOKIE] ?? '';
    if (!is_string($tok) || !preg_match('/^[0-9a-f]{64}$/', $tok)) return null;
    $row = q('SELECT s.token_hash, s.csrf, s.expires_at, u.id, u.username, u.email, u.role, u.is_admin
              FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?', [sha($tok)])->fetch();
    if (!$row || $row['expires_at'] < now()) return null;
    // Slide the expiry forward at most once a day.
    if ($row['expires_at'] < now(SESSION_DAYS * 86400 - 86400)) {
        q('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', [now(SESSION_DAYS * 86400), $row['token_hash']]);
        set_session_cookie($tok, time() + SESSION_DAYS * 86400);
    }
    $row['id'] = (int)$row['id'];
    $row['is_admin'] = (bool)$row['is_admin'];
    return $cache = $row;
}

function start_session(int $userId): array {
    $tok = token();
    $csrf = token();
    q('INSERT INTO sessions (token_hash, user_id, csrf, created_at, expires_at) VALUES (?,?,?,?,?)',
      [sha($tok), $userId, $csrf, now(), now(SESSION_DAYS * 86400)]);
    q('UPDATE users SET last_login = ? WHERE id = ?', [now(), $userId]);
    q('DELETE FROM sessions WHERE expires_at < ?', [now()]);
    set_session_cookie($tok, time() + SESSION_DAYS * 86400);
    return ['csrf' => $csrf];
}

function end_session(): void {
    $tok = $_COOKIE[SESSION_COOKIE] ?? '';
    if (is_string($tok) && $tok !== '') q('DELETE FROM sessions WHERE token_hash = ?', [sha($tok)]);
    set_session_cookie('', time() - 3600);
}

function can_ref(array $s): bool { return $s['role'] === 'ref' || $s['is_admin']; }

function public_user(array $u): array {
    return [
        'id' => (int)$u['id'], 'username' => $u['username'], 'email' => $u['email'], 'role' => $u['role'],
        'isAdmin' => (bool)$u['is_admin'], 'canRef' => $u['role'] === 'ref' || (bool)$u['is_admin'],
    ];
}

function client_ip(): string { return substr((string)($_SERVER['REMOTE_ADDR'] ?? ''), 0, 45); }
