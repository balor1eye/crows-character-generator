<?php
// Entry point for The Nest accounts API. The code lives outside the web root, in the folder named after this one:
// public_html/crows -> ~/crows-app, public_html/crows-test -> ~/crows-test-app (so both instances run identical files).
require dirname(__DIR__, 2) . '/' . basename(__DIR__) . '-app/api.php';
run_api();
