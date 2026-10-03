<?php
// StartupGuard - configuration
//
// Settings come from environment variables so real credentials never live
// in the code. The fallbacks are local development defaults only.
//
//   SG_DB_HOST, SG_DB_PORT, SG_DB_NAME, SG_DB_USER, SG_DB_PASS, SG_DB_CHARSET

declare(strict_types=1);

if (!function_exists('sgEnv')) {
    /** Read an environment variable, or return the fallback when it is not set. */
    function sgEnv(string $name, string $default): string
    {
        $value = getenv($name);
        return $value === false ? $default : $value;
    }
}

return [
    'db' => [
        'host'    => sgEnv('SG_DB_HOST', '127.0.0.1'),
        'port'    => (int) sgEnv('SG_DB_PORT', '3306'),
        'name'    => sgEnv('SG_DB_NAME', 'startupguard_db'),
        'user'    => sgEnv('SG_DB_USER', 'root'),
        'pass'    => sgEnv('SG_DB_PASS', ''),
        'charset' => sgEnv('SG_DB_CHARSET', 'utf8mb4'),
    ],
];
