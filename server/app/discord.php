<?php
/*
 * Sign in with Discord (OAuth2 authorization-code flow, scopes identify + email). Off unless config.php has
 * discord_client_id and discord_client_secret.
 *
 * The page asks the API for an authorize URL (discord.start to log in, account.discordLink to connect Discord to
 * the logged-in account). The URL carries a random `state` whose hash is stored (single use, 10 minutes) and
 * which is also set as a cookie, so the callback only completes in the browser that started it. Discord sends
 * the browser back to api.php?a=discord.callback, which finishes and redirects to the page with #discord=<result>.
 *
 * - A linked Discord account logs in. Discord counts as the whole sign-in: it does not also ask for the
 *   account's two-step login code (Discord has its own two-step login).
 * - An unlinked one makes a new player account (Discord's verified email, no password until the person asks
 *   for a reset link). If that email already belongs to an account, nothing is linked automatically: the owner
 *   logs in and connects Discord from the Account page.
 * Included by api.php.
 */
declare(strict_types=1);

const DISCORD_STATE_TTL = 600;

function discord_enabled(): bool {
    $c = config();
    return !empty($c['discord_client_id']) && !empty($c['discord_client_secret']);
}
function discord_redirect_uri(): string { return site_link('api.php?a=discord.callback'); }
function discord_cookie(): string { return is_https() ? '__Secure-crows_oauth' : 'crows_oauth'; }
function discord_set_cookie(string $value, int $expires): void {
    setcookie(discord_cookie(), $value, ['expires' => $expires, 'path' => cookie_path(), 'secure' => is_https(), 'httponly' => true, 'samesite' => 'Lax']);
}

/** The Discord authorize URL for a login (no $userId) or for linking Discord to $userId. */
function discord_begin(string $purpose, ?int $userId): array {
    if (!discord_enabled()) fail('Discord sign-in is not set up on this site.', 404);
    throttle('discord', 1000, 30, 900);
    note_attempt('discord');
    q('DELETE FROM oauth_states WHERE expires_at < ?', [now()]);
    $state = token();
    q('INSERT INTO oauth_states (state_hash, purpose, user_id, expires_at) VALUES (?,?,?,?)', [sha($state), $purpose, $userId, now(DISCORD_STATE_TTL)]);
    discord_set_cookie($state, time() + DISCORD_STATE_TTL);
    return ['url' => 'https://discord.com/oauth2/authorize?' . http_build_query([
        'client_id' => config()['discord_client_id'], 'response_type' => 'code', 'scope' => 'identify email',
        'redirect_uri' => discord_redirect_uri(), 'state' => $state, 'prompt' => 'consent',
    ], '', '&', PHP_QUERY_RFC3986)];
}
function a_discord_start(): array { return discord_begin('login', null); }
function a_account_discord_link(): array { $s = need_login(); return discord_begin('link', $s['id']); }

function a_account_discord(): array {
    $s = need_login();
    $l = q('SELECT discord_name FROM discord_links WHERE user_id = ?', [$s['id']])->fetch();
    $hash = (string)q('SELECT pass_hash FROM users WHERE id = ?', [$s['id']])->fetchColumn();
    return ['enabled' => discord_enabled(), 'linked' => $l ? $l['discord_name'] : null, 'hasPassword' => $hash !== ''];
}
function a_account_discord_unlink(): array {
    $s = need_login();
    $hash = (string)q('SELECT pass_hash FROM users WHERE id = ?', [$s['id']])->fetchColumn();
    if ($hash === '') fail('This account has no password, so Discord is the only way in. Use "Forgot your password?" on the log-in page to set one first.', 409);
    check_password($s, str('currentPassword', 300));
    q('DELETE FROM discord_links WHERE user_id = ?', [$s['id']]);
    audit('discord_unlinked', $s['id']);
    return [];
}

/** POST (form-encoded, with the app's credentials) or GET (with a bearer token) to Discord's API; the decoded JSON or null. */
function discord_http(string $url, ?array $form, ?string $bearer): ?array {
    $ch = curl_init($url);
    $c = config();
    curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 10, CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_HTTPHEADER => ['Accept: application/json', 'User-Agent: TheNest (accounts, 1.0)']]);
    if ($form !== null) {
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($form));
        curl_setopt($ch, CURLOPT_USERPWD, $c['discord_client_id'] . ':' . $c['discord_client_secret']);
    }
    if ($bearer !== null) curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json', 'User-Agent: TheNest (accounts, 1.0)', "Authorization: Bearer $bearer"]);
    $out = curl_exec($ch);
    $code = (int)curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    $j = is_string($out) ? json_decode($out, true) : null;
    return $code === 200 && is_array($j) ? $j : null;
}

/** A free username made from the Discord name. */
function discord_username(string $name): string {
    $u = trim(preg_replace('/[^A-Za-z0-9_.-]+/', '', $name), '.-_');
    if (strlen($u) < 3) $u = 'crow' . $u;
    $u = substr($u, 0, 26);
    $try = $u;
    while (q('SELECT 1 FROM users WHERE username = ?', [$try])->fetch()) $try = $u . random_int(100, 99999);
    return $try;
}

function discord_done(string $result): never {
    discord_set_cookie('', time() - 3600);
    header('Cache-Control: no-store');
    header('Location: ' . site_link('#discord=' . $result));
    exit;
}

/** Discord sent the browser back. Finishes the sign-in or link and redirects to the page with the result. */
function discord_callback(): void {
    try {
        if (!discord_enabled()) discord_done('unavailable');
        $state = (string)($_GET['state'] ?? '');
        $cookie = (string)($_COOKIE[discord_cookie()] ?? '');
        if (!preg_match('/^[0-9a-f]{64}$/', $state) || !hash_equals($cookie, $state)) discord_done('expired');
        $row = q('SELECT * FROM oauth_states WHERE state_hash = ?', [sha($state)])->fetch();
        q('DELETE FROM oauth_states WHERE state_hash = ?', [sha($state)]);
        if (!$row || $row['expires_at'] < now()) discord_done('expired');
        $linking = $row['purpose'] === 'link';
        if (isset($_GET['error']) || !is_string($_GET['code'] ?? null)) discord_done('denied');

        $tok = discord_http('https://discord.com/api/oauth2/token', ['grant_type' => 'authorization_code', 'code' => $_GET['code'],
            'redirect_uri' => discord_redirect_uri()], null);
        $me = $tok && is_string($tok['access_token'] ?? null) ? discord_http('https://discord.com/api/users/@me', null, $tok['access_token']) : null;
        if (!$me || !preg_match('/^[0-9]{1,32}$/', (string)($me['id'] ?? ''))) discord_done('failed');
        $did = (string)$me['id'];
        $dname = mb_substr((string)($me['global_name'] ?? $me['username'] ?? 'Discord user'), 0, 100);
        $linked = q('SELECT user_id FROM discord_links WHERE discord_id = ?', [$did])->fetch();

        if ($linking) {
            $s = current_session();
            if (!$s || $s['id'] !== (int)$row['user_id']) discord_done('expired');
            if ($linked && (int)$linked['user_id'] !== $s['id']) discord_done('taken');
            q('REPLACE INTO discord_links (user_id, discord_id, discord_name, created_at) VALUES (?,?,?,?)', [$s['id'], $did, $dname, now()]);
            audit('discord_linked', $s['id']);
            discord_done('linked');
        }

        if ($linked) {
            $uid = (int)$linked['user_id'];
            q('UPDATE discord_links SET discord_name = ? WHERE user_id = ?', [$dname, $uid]);
        } else {
            $email = (string)($me['email'] ?? '');
            if (empty($me['verified']) || $email === '' || strlen($email) > 190 || !filter_var($email, FILTER_VALIDATE_EMAIL)) discord_done('noemail');
            if (q('SELECT 1 FROM users WHERE email = ?', [$email])->fetch()) discord_done('emailused');
            $username = discord_username((string)($me['username'] ?? $dname));
            q('INSERT INTO users (username, email, pass_hash, role, is_admin, created_at) VALUES (?,?,?,?,0,?)', [$username, $email, '', 'player', now()]);
            $uid = (int)db()->lastInsertId();
            q('INSERT INTO discord_links (user_id, discord_id, discord_name, created_at) VALUES (?,?,?,?)', [$uid, $did, $dname, now()]);
            audit('register', $uid, $username . ' (Discord)');
            mail_admins_new_account($username, $email);
        }
        audit('login_discord', $uid);
        start_session($uid);
        discord_done('ok');
    } catch (Throwable $e) {
        error_log('crows discord: ' . $e);
        discord_done('failed');
    }
}
