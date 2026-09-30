<?php
// Serves the Ref Screen only to logged-in Refs (and admins); everyone else goes to the home page.
declare(strict_types=1);
require dirname(__DIR__, 2) . '/crows-app/bootstrap.php';
$s = current_session();
if (!$s || !can_ref($s)) {
    header('Location: ./' . ($s ? '#home' : '#login'), true, 302);
    exit;
}
header('Content-Type: text/html; charset=utf-8');
header('Cache-Control: no-store');
readfile(dirname(__DIR__, 2) . '/crows-app/Crows_Ref_Screen.html');
