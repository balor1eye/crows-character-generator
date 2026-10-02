<?php
// Creates the database tables (safe to re-run). Usage: php ~/crows-app/install.php
declare(strict_types=1);
if (PHP_SAPI !== 'cli') exit("Run this from the command line.\n");
require __DIR__ . '/bootstrap.php';
$sql = file_get_contents(__DIR__ . '/schema.sql');
foreach (array_filter(array_map('trim', preg_split('/;\s*$/m', preg_replace('/^--.*$/m', '', $sql)))) as $stmt) db()->exec($stmt);
// Columns added after the first release (CREATE TABLE IF NOT EXISTS leaves existing tables alone).
foreach ([['characters', 'draft', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER version']] as [$t, $c, $def]) {
    $has = db()->prepare('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?');
    $has->execute([$t, $c]);
    if (!(int)$has->fetchColumn()) db()->exec("ALTER TABLE $t ADD COLUMN $c $def");
}
echo "Tables ready: ", implode(', ', db()->query('SHOW TABLES')->fetchAll(PDO::FETCH_COLUMN)), "\n";
