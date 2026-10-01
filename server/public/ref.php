<?php
// Serves the Ref Screen only to logged-in Refs (and admins); everyone else goes to the home page.
declare(strict_types=1);
$app = dirname(__DIR__, 2) . '/' . basename(__DIR__) . '-app';   // ~/crows-app, or ~/crows-test-app for the test instance
require $app . '/bootstrap.php';
$s = current_session();
if (!$s || !can_ref($s)) {
    header('Location: ./' . ($s ? '#home' : '#login'), true, 302);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
header('Content-Security-Policy: ' . trim((string)file_get_contents($app . '/ref-csp.txt')));
readfile($app . '/Crows_Ref_Screen.html');
