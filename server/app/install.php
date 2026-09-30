<?php
// Creates the database tables (safe to re-run). Usage: php ~/crows-app/install.php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit("Run this from the command line.\n");
require __DIR__ . '/bootstrap.php';
$sql = file_get_contents(__DIR__ . '/schema.sql');
foreach (array_filter(array_map('trim', preg_split('/;\s*$/m', preg_replace('/^--.*$/m', '', $sql)))) as $stmt) db()->exec($stmt);
echo "Tables ready: ", implode(', ', db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN)), "\n";
