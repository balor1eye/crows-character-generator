<?php
/*
 * Two-step login (MFA), optional and off by default. An account can turn it on from its Account page: an
 * authenticator app (TOTP, RFC 6238) or a code emailed at each login, plus ten one-time recovery codes.
 *
 * For an account with it on, a correct password (at login or after a password reset) never starts a session
 * by itself. It makes a short-lived challenge instead, whose random token the page holds while the person
 * proves the second factor. Accounts without it get their session straight away. Only the token's hash is
 * stored, a challenge allows 5 wrong codes, and codes are also throttled per account. Authenticator secrets are encrypted at rest with a key kept beside
 * the code (mfa.key, made on first use), and each TOTP step can be used only once.
 * Included by api.php, which supplies q(), fail(), body(), str(), send_mail() and the rest.
 */
declare(strict_types=1);

const MFA_ISSUER = 'The Nest';   // the name authenticator apps show (accounts set up earlier keep their old label)
const MFA_LOGIN_TTL = 900;      // seconds to finish a login challenge
const MFA_SETUP_TTL = 1800;     // ...or set up a second factor
const MFA_MAX_TRIES = 5;        // wrong codes per challenge
const MFA_MAX_SENDS = 5;        // emailed codes per challenge
const MFA_RECOVERY_CODES = 10;

// ---------------------------------------------------------------- crypto helpers
function mfa_key(): string {
    static $key = null;
    if ($key !== null) return $key;
    $f = __DIR__ . '/mfa.key';
    $h = @fopen($f, 'x');   // only one request ever creates it
    if ($h) { fwrite($h, base64_encode(random_bytes(SODIUM_CRYPTO_SECRETBOX_KEYBYTES))); fclose($h); chmod($f, 0600); }
    $key = base64_decode((string)@file_get_contents($f), true);
    if (!is_string($key) || strlen($key) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) throw new RuntimeException('mfa.key is unreadable');
    return $key;
}
function mfa_seal(string $plain): string {
    $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
    return base64_encode($nonce . sodium_crypto_secretbox($plain, $nonce, mfa_key()));
}
function mfa_open(string $sealed): string {
    $raw = base64_decode($sealed, true);
    $plain = $raw === false ? false : sodium_crypto_secretbox_open(substr($raw, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), substr($raw, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), mfa_key());
    if ($plain === false) throw new RuntimeException('could not decrypt an MFA secret');
    return $plain;
}

function base32_encode(string $bytes): string {
    $abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
    foreach (str_split($bytes) as $c) $bits .= str_pad(decbin(ord($c)), 8, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 5) as $chunk) $out .= $abc[bindec(str_pad($chunk, 5, '0'))];
    return $out;
}
function base32_decode(string $s): string {
    $abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; $bits = ''; $out = '';
    foreach (str_split(strtoupper(preg_replace('/[^A-Za-z2-7]/', '', $s))) as $c) $bits .= str_pad(decbin(strpos($abc, $c)), 5, '0', STR_PAD_LEFT);
    foreach (str_split($bits, 8) as $byte) if (strlen($byte) === 8) $out .= chr(bindec($byte));
    return $out;
}
/** The 6-digit TOTP code for time step $step (30 s steps, HMAC-SHA1: what every authenticator app does). */
function totp(string $secret, int $step): string {
    $h = hash_hmac('sha1', pack('J', $step), $secret, true);
    $o = ord($h[19]) & 0x0f;
    $n = ((ord($h[$o]) & 0x7f) << 24) | (ord($h[$o + 1]) << 16) | (ord($h[$o + 2]) << 8) | ord($h[$o + 3]);
    return str_pad((string)($n % 1000000), 6, '0', STR_PAD_LEFT);
}
/** The step a code matches (allowing a step of clock drift either way) that's newer than $after, or null. */
function totp_match(string $secret, string $code, int $after = 0): ?int {
    $now = intdiv(time(), 30);
    for ($d = -1; $d <= 1; $d++) if ($now + $d > $after && hash_equals(totp($secret, $now + $d), $code)) return $now + $d;
    return null;
}
function clean_code($c): string { return strtolower(preg_replace('/[\s-]+/', '', (string)$c)); }
function mask_email(string $e): string {
    [$u, $d] = array_pad(explode('@', $e, 2), 2, '');
    return mb_substr($u, 0, 1) . str_repeat('•', max(2, min(6, mb_strlen($u) - 1))) . '@' . $d;
}

// ---------------------------------------------------------------- challenges
function mfa_row(int $userId): ?array { $r = q('SELECT * FROM mfa WHERE user_id = ?', [$userId])->fetch(); return $r ?: null; }

/**
 * After a correct password: what the page does next. With a second factor turned on, prove it (an emailed
 * code is sent now) and the answer carries the challenge token, not a session. Without one, sign in.
 */
function mfa_gate(array $u): array {
    q('DELETE FROM mfa_challenges WHERE expires_at < ? OR user_id = ?', [now(), $u['id']]);
    $m = mfa_row((int)$u['id']);
    $tok = token();
    if (!$m) {
        audit('login', (int)$u['id']);
        return ['user' => public_user($u), 'csrf' => start_session((int)$u['id'])['csrf']];
    }
    q('INSERT INTO mfa_challenges (token_hash, user_id, purpose, method, expires_at) VALUES (?,?,?,?,?)', [sha($tok), $u['id'], 'login', $m['method'], now(MFA_LOGIN_TTL)]);
    if ($m['method'] === 'email') mfa_send_code(challenge_row($tok), $u);
    return ['mfa' => ['token' => $tok, 'method' => $m['method'], 'email' => mask_email($u['email'])]];
}
function challenge_row(string $tok, ?string $purpose = null): array {
    if (!preg_match('/^[0-9a-f]{64}$/', $tok)) fail('That sign-in has expired. Please log in again.', 401);
    $r = q('SELECT c.*, u.username, u.email FROM mfa_challenges c JOIN users u ON u.id = c.user_id WHERE c.token_hash = ?', [sha($tok)])->fetch();
    if (!$r || $r['expires_at'] < now()) fail('That sign-in has expired. Please log in again.', 401);
    if ($purpose && $r['purpose'] !== $purpose) fail('That sign-in step is out of order. Please log in again.', 409);
    return $r;
}
/** Email a fresh 6-digit code for this challenge (replacing any earlier one). */
function mfa_send_code(array $c, array $u): void {
    if ((int)$c['sends'] >= MFA_MAX_SENDS) fail('Too many codes sent. Please log in again later.', 429);
    if ($c['code_sent_at'] && strtotime($c['code_sent_at'] . ' UTC') > time() - 30) fail('A code was just sent. Wait half a minute before asking for another.', 429);
    $code = str_pad((string)random_int(0, 999999), 6, '0', STR_PAD_LEFT);
    q('UPDATE mfa_challenges SET code_hash = ?, code_sent_at = ?, sends = sends + 1 WHERE token_hash = ?', [sha($c['token_hash'] . $code), now(), $c['token_hash']]);
    send_mail($u['email'], "Your code for The Nest: $code",
        "Hi {$u['username']},\n\nYour sign-in code for The Nest is:\n\n    $code\n\nIt works for 15 minutes. If you didn't just try to sign in, " .
        "someone has your password: change it on your Account page.\n");
}
/** A wrong code: count it, and drop the challenge after too many. */
function mfa_wrong(array $c): void {
    note_attempt('mfa:' . $c['user_id']);
    audit('mfa_failed', (int)$c['user_id']);
    if ((int)$c['attempts'] + 1 >= MFA_MAX_TRIES) {
        q('DELETE FROM mfa_challenges WHERE token_hash = ?', [$c['token_hash']]);
        fail('Too many wrong codes. Please log in again.', 401);
    }
    q('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token_hash = ?', [$c['token_hash']]);
    fail('That code is not right. Check it and try again.', 400);
}
function mfa_check_email_code(array $c, string $code): bool {
    return $c['code_hash'] && $c['code_sent_at'] && strtotime($c['code_sent_at'] . ' UTC') > time() - MFA_LOGIN_TTL
        && hash_equals($c['code_hash'], sha($c['token_hash'] . $code));
}
/** New recovery codes for $userId (replacing the old ones), returned once in plain text. */
function mfa_new_recovery(int $userId): array {
    q('DELETE FROM mfa_recovery WHERE user_id = ?', [$userId]);
    $abc = 'abcdefghjkmnpqrstuvwxyz23456789'; $codes = [];
    for ($i = 0; $i < MFA_RECOVERY_CODES; $i++) {
        $c = ''; for ($k = 0; $k < 8; $k++) $c .= $abc[random_int(0, strlen($abc) - 1)];
        $codes[] = substr($c, 0, 4) . '-' . substr($c, 4);
        q('INSERT INTO mfa_recovery (user_id, code_hash, created_at) VALUES (?,?,?)', [$userId, sha($userId . ':' . clean_code($c)), now()]);
    }
    return $codes;
}
/** The challenge is done: start a session (or keep the current one, when already logged in as this user). */
function mfa_finish(array $c, array $extra = []): array {
    q('DELETE FROM mfa_challenges WHERE token_hash = ?', [$c['token_hash']]);
    q('DELETE FROM login_attempts WHERE login = ?', ['mfa:' . $c['user_id']]);
    $u = q('SELECT * FROM users WHERE id = ?', [$c['user_id']])->fetch();
    $s = current_session();
    $csrf = $s && $s['id'] === (int)$u['id'] ? $s['csrf'] : start_session((int)$u['id'])['csrf'];
    return ['user' => public_user($u), 'csrf' => $csrf] + $extra;
}

// ---------------------------------------------------------------- actions
/** Prove the second factor for a login: an app code, the emailed code, or a recovery code. */
function a_mfa_verify(): array {
    $c = challenge_row(str('token', 100), 'login');
    throttle('mfa:' . $c['user_id'], 10, 30, 900);
    $code = clean_code(str('code', 40));
    $m = mfa_row((int)$c['user_id']);
    if (!$m) fail('That sign-in has expired. Please log in again.', 401);
    $extra = [];
    if (preg_match('/^[0-9]{6}$/', $code)) {
        if ($m['method'] === 'totp') {
            $step = totp_match(mfa_open($m['secret']), $code, (int)$m['last_step']);
            if ($step === null) mfa_wrong($c);
            q('UPDATE mfa SET last_step = ? WHERE user_id = ?', [$step, $m['user_id']]);   // each code works once
        } elseif (!mfa_check_email_code($c, $code)) mfa_wrong($c);
    } else {
        $n = q('UPDATE mfa_recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL',
               [now(), $c['user_id'], sha($c['user_id'] . ':' . $code)])->rowCount();
        if (!$n) mfa_wrong($c);
        $left = (int)q('SELECT COUNT(*) FROM mfa_recovery WHERE user_id = ? AND used_at IS NULL', [$c['user_id']])->fetchColumn();
        audit('mfa_recovery_used', (int)$c['user_id'], "$left left");
        $extra['recoveryLeft'] = $left;
    }
    audit('login', (int)$c['user_id']);
    return mfa_finish($c, $extra);
}

/** Send another emailed code (for a login, or while setting up the email method). */
function a_mfa_resend(): array {
    $c = challenge_row(str('token', 100));
    if (($c['method'] ?? '') !== 'email') fail('This sign-in doesn\'t use emailed codes.', 409);
    mfa_send_code($c, ['username' => $c['username'], 'email' => $c['email']]);
    return [];
}

/** Choose a second factor while setting up: an app (returns its secret, to show as a QR code) or email (sends a code). */
function a_mfa_setup_start(): array {
    $c = challenge_row(str('token', 100), 'setup');
    $method = str('method', 10);
    if ($method === 'totp') {
        $secret = random_bytes(20);
        q('UPDATE mfa_challenges SET method = ?, secret = ?, code_hash = NULL WHERE token_hash = ?', ['totp', mfa_seal($secret), $c['token_hash']]);
        $b32 = base32_encode($secret);
        $label = rawurlencode(MFA_ISSUER . ':' . $c['username']);
        return ['secret' => trim(chunk_split($b32, 4, ' ')),
                'uri' => "otpauth://totp/$label?secret=$b32&issuer=" . rawurlencode(MFA_ISSUER) . '&algorithm=SHA1&digits=6&period=30'];
    }
    if ($method === 'email') {
        q('UPDATE mfa_challenges SET method = ?, secret = NULL WHERE token_hash = ?', ['email', $c['token_hash']]);
        $c['method'] = 'email';
        mfa_send_code($c, ['username' => $c['username'], 'email' => $c['email']]);
        return ['email' => mask_email($c['email'])];
    }
    fail('Pick an authenticator app or emailed codes.');
}

/** Confirm the chosen factor with a code from it; that turns it on, gives recovery codes, and signs in. */
function a_mfa_setup_finish(): array {
    $c = challenge_row(str('token', 100), 'setup');
    throttle('mfa:' . $c['user_id'], 10, 30, 900);
    $code = clean_code(str('code', 40));
    if (!preg_match('/^[0-9]{6}$/', $code)) fail('Enter the 6-digit code.');
    $step = 0;
    if ($c['method'] === 'totp' && $c['secret']) {
        $step = totp_match(mfa_open($c['secret']), $code);
        if ($step === null) mfa_wrong($c);
    } elseif ($c['method'] === 'email') {
        if (!mfa_check_email_code($c, $code)) mfa_wrong($c);
    } else fail('Pick an authenticator app or emailed codes first.', 409);
    q('REPLACE INTO mfa (user_id, method, secret, last_step, created_at) VALUES (?,?,?,?,?)',
      [$c['user_id'], $c['method'], $c['method'] === 'totp' ? $c['secret'] : null, (int)$step, now()]);
    audit('mfa_set_up', (int)$c['user_id'], $c['method']);
    return mfa_finish($c, ['recoveryCodes' => mfa_new_recovery((int)$c['user_id'])]);
}

/** Account page: how this account signs in. */
function a_account_mfa(): array {
    $s = need_login();
    $m = mfa_row($s['id']);
    $left = (int)q('SELECT COUNT(*) FROM mfa_recovery WHERE user_id = ? AND used_at IS NULL', [$s['id']])->fetchColumn();
    return ['method' => $m['method'] ?? null, 'since' => $m ? $m['created_at'] . 'Z' : null, 'recoveryLeft' => $left];
}
/** Account page: switch method (or re-pair an app). Needs the password; the old factor works until the new one is confirmed. */
function a_account_mfa_change(): array {
    $s = need_login();
    check_password($s, str('currentPassword', 300));
    $tok = token();
    q('DELETE FROM mfa_challenges WHERE expires_at < ? OR user_id = ?', [now(), $s['id']]);
    q('INSERT INTO mfa_challenges (token_hash, user_id, purpose, expires_at) VALUES (?,?,?,?)', [sha($tok), $s['id'], 'setup', now(MFA_SETUP_TTL)]);
    return ['token' => $tok, 'email' => mask_email($s['email'])];
}
/** Account page: a fresh set of recovery codes (the old ones stop working). */
function a_account_mfa_recovery(): array {
    $s = need_login();
    check_password($s, str('currentPassword', 300));
    if (!mfa_row($s['id'])) fail('Set up two-step login first.', 409);
    audit('mfa_recovery_regenerated', $s['id']);
    return ['recoveryCodes' => mfa_new_recovery($s['id'])];
}
/** Account page: turn two-step login off. Needs the password. */
function a_account_mfa_off(): array {
    $s = need_login();
    check_password($s, str('currentPassword', 300));
    q('DELETE FROM mfa WHERE user_id = ?', [$s['id']]);
    q('DELETE FROM mfa_recovery WHERE user_id = ?', [$s['id']]);
    audit('mfa_off', $s['id']);
    return [];
}
/** Admin: someone lost their phone and their recovery codes. Two-step login is off for them until they turn it on again. */
function a_admin_reset_mfa(): array {
    $a = need_admin();
    $uid = (int)(body()['userId'] ?? 0);
    $u = q('SELECT id, username, email FROM users WHERE id = ?', [$uid])->fetch();
    if (!$u) fail('That account was not found.', 404);
    q('DELETE FROM mfa WHERE user_id = ?', [$uid]);
    q('DELETE FROM mfa_recovery WHERE user_id = ?', [$uid]);
    q('DELETE FROM sessions WHERE user_id = ?', [$uid]);   // 
    audit('mfa_reset', $uid, '', $a['id']);
    send_mail($u['email'], 'Your two-step login for The Nest was reset',
        "Hi {$u['username']},\n\nAn admin reset the two-step login on your account on The Nest, and you were logged out everywhere. " .
        "Two-step login is now off. You can turn it on again on your Account page.\n" .
        "If you didn't ask for this, contact the site admin right away.\n");
    return [];
}
