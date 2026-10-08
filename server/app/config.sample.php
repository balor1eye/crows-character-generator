<?php
// Copy to config.php (next to this file, outside the web root) and fill in. Never commit config.php.
return [
    'db_host' => 'localhost',
    'db_name' => 'joshuara_crows',
    'db_user' => 'joshuara_crows',
    'db_pass' => 'CHANGE ME',
    'site_url' => 'https://joshuaramsey.com/crows/',   // used in password-reset links
    'cookie_path' => '/crows/',
    'mail_from' => 'noreply@joshuaramsey.com',
    // Discord sign-in (optional; off when blank). Create an app at discord.com/developers/applications and add the
    // redirect URI <site_url>api.php?a=discord.callback under OAuth2.
    // 'discord_client_id' => '',
    // 'discord_client_secret' => '',
    // Automatic map object detection (Claude vision, action map.detect); 503 'unconfigured' while the key is blank.
    // 'anthropic_api_key' => '',
    // 'anthropic_model' => 'claude-sonnet-5-5',
    // Test instance only (~/crows-test-app/config.php): no real email, just a log file; enables seed_test.php.
    // 'mail_log' => __DIR__ . '/mail.log',
    // 'test_instance' => true,
];
