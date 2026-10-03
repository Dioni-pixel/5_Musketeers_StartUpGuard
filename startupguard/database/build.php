<?php
// StartupGuard - build the SQLite database from schema.sql and seed.sql
//
//   php database/build.php           create the file if it does not exist yet
//   php database/build.php --fresh   delete the existing file and rebuild
//   php database/build.php --no-seed schema only, no NovaFit demo data
//
// The file goes to SG_DB_PATH, or database/startupguard.sqlite by default
// (the same path api/config.php uses). Needs only PHP with pdo_sqlite.

declare(strict_types=1);

if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}

$config = require dirname(__DIR__) . '/api/config.php';
$path   = $config['db']['path'];
$fresh  = in_array('--fresh', $argv, true);
$seed   = !in_array('--no-seed', $argv, true);

if (is_file($path)) {
    if (!$fresh) {
        fwrite(STDERR, "$path already exists. Use --fresh to delete and rebuild it.\n");
        exit(1);
    }
    foreach ([$path, "$path-wal", "$path-shm", "$path-journal"] as $file) {
        if (is_file($file)) {
            unlink($file);
        }
    }
}

try {
    $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $pdo->exec('PRAGMA foreign_keys = ON');

    $pdo->exec((string) file_get_contents(__DIR__ . '/schema.sql'));
    echo "Schema loaded.\n";

    if ($seed) {
        $pdo->exec((string) file_get_contents(__DIR__ . '/seed.sql'));
        echo "NovaFit demo data loaded.\n";
    }

    $problems = $pdo->query('PRAGMA foreign_key_check')->fetchAll();
    if ($problems !== []) {
        throw new RuntimeException(count($problems) . ' foreign key problem(s) found.');
    }
} catch (Throwable $e) {
    fwrite(STDERR, 'Build failed: ' . $e->getMessage() . "\n");
    exit(1);
}

echo "Database ready: $path\n";
