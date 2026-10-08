<?php
// Test instance only: (re)creates the test accounts, each with a fresh password and authenticator secret,
// and writes them to test-accounts.json next to this file (chmod 600) for server/test_instance.py.
// Usage: php ~/crows-test-app/seed_test.php            add --wipe to delete every account (and its data) first
//        php ~/crows-test-app/seed_test.php --unthrottle  only clear the rate limits (so smoke tests can repeat)
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit("Run this from the command line.\n");
require __DIR__ . '/api.php';
if (empty(config()['test_instance'])) exit("Refusing: config.php doesn't set 'test_instance' => true.\n");

const TEST_ACCOUNTS = [
    // username => [role, admin]
    'test_admin' => ['ref', 1],
    'test_ref' => ['ref', 0],
    'test_player' => ['player', 0],
    'test_player2' => ['player', 0],
];

if (in_array('--unthrottle', $argv, true)) {
    q('DELETE FROM login_attempts');
    foreach (glob(sync_dir() . '/.aivault-*.json') ?: [] as $f) @unlink($f);
    exit("Rate limits cleared.\n");
}

if (in_array('--wipe', $argv, true)) {
    q('DELETE FROM users');   // everything else hangs off users and goes with them
    q('DELETE FROM login_attempts');
    q('DELETE FROM audit_log');
    echo "Wiped all accounts.\n";
}

$out = [];
foreach (TEST_ACCOUNTS as $name => [$role, $admin]) {
    $email = str_replace('_', '-', $name) . '@example.invalid';
    $pw = 'T3st-' . bin2hex(random_bytes(12));
    $secret = random_bytes(20);
    $u = q('SELECT id FROM users WHERE username = ?', [$name])->fetch();
    if ($u) {
        $id = (int)$u['id'];
        q('UPDATE users SET email = ?, pass_hash = ?, role = ?, is_admin = ? WHERE id = ?', [$email, hash_password($pw), $role, $admin, $id]);
        q('DELETE FROM sessions WHERE user_id = ?', [$id]);
    } else {
        q('INSERT INTO users (username, email, pass_hash, role, is_admin, created_at) VALUES (?,?,?,?,?,?)',
          [$name, $email, hash_password($pw), $role, $admin, now()]);
        $id = (int)db()->lastInsertId();
    }
    q('DELETE FROM login_attempts WHERE login IN (?, ?, ?)', [$name, $email, "mfa:$id"]);
    q('DELETE FROM mfa WHERE user_id = ?', [$id]);
    q('INSERT INTO mfa (user_id, method, secret, last_step, created_at) VALUES (?,?,?,0,?)', [$id, 'totp', mfa_seal($secret), now()]);
    $out[$name] = ['id' => $id, 'email' => $email, 'password' => $pw, 'totp' => base32_encode($secret),
                   'recovery' => mfa_new_recovery($id), 'role' => $role, 'admin' => (bool)$admin];
    echo "$name: role=$role, admin=" . ($admin ? 'yes' : 'no') . "\n";
}
$f = __DIR__ . '/test-accounts.json';
file_put_contents($f, json_encode($out, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
chmod($f, 0600);
echo "Wrote $f\n";
