<?php
// Makes an existing account an admin (register it on the site first).
// Usage: php ~/crows-app/make_admin.php <username>      add --remove to take admin away
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit("Run this from the command line.\n");
require __DIR__ . '/bootstrap.php';
$name = $argv[1] ?? '';
if ($name === '') exit("Usage: php make_admin.php <username> [--remove]\n");
$flag = in_array('--remove', $argv, true) ? 0 : 1;
$n = q('UPDATE users SET is_admin = ? WHERE username = ?', [$flag, $name])->rowCount();
$u = q('SELECT username, role, is_admin FROM users WHERE username = ?', [$name])->fetch();
if (!$u) exit("No account named '$name'. Register it on the site first.\n");
echo "{$u['username']}: role={$u['role']}, admin=" . ($u['is_admin'] ? 'yes' : 'no') . "\n";
