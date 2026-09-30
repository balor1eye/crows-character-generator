<?php
// Entry point for the Crows accounts API. The code lives outside the web root in ~/crows-app/.
require dirname(__DIR__, 2) . '/crows-app/api.php';
run_api();
