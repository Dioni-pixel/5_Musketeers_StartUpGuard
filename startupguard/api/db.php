<?php
// StartupGuard - PDO database connection (SQLite)
//
// Usage:
//   require_once __DIR__ . '/db.php';
//   $stmt = getDB()->prepare('SELECT * FROM businesses WHERE id = :id');
//   $stmt->execute(['id' => $id]);
//
// Always use prepared statements with bound parameters. Never put request
// values into SQL strings.

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

/**
 * Return the shared PDO connection, creating it on first use.
 *
 * If the database file is missing or cannot be opened, the real reason goes
 * to the server error log and the client gets a generic 503. The file path
 * is never sent.
 */
function getDB(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = require __DIR__ . '/config.php';
    $path   = $config['db']['path'];

    // SQLite would silently create an empty database for a wrong path.
    if (!is_file($path)) {
        error_log('StartupGuard DB file not found: ' . $path . ' (run php database/build.php)');
        sendError('DATABASE_UNAVAILABLE', 'The database is not available right now. Please try again later.', 503);
    }

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_TIMEOUT            => 5,  // seconds to wait while another request is writing
    ];

    try {
        $pdo = new PDO('sqlite:' . $path, null, null, $options);
        // SQLite ignores foreign keys unless this is set on every connection.
        $pdo->exec('PRAGMA foreign_keys = ON');
    } catch (PDOException $e) {
        $pdo = null;
        error_log('StartupGuard DB connection failed: ' . $e->getMessage());
        sendError('DATABASE_UNAVAILABLE', 'The database is not available right now. Please try again later.', 503);
    }

    return $pdo;
}

/** True when $e is a UNIQUE / PRIMARY KEY violation. */
function isUniqueViolation(PDOException $e): bool
{
    return ($e->errorInfo[1] ?? null) === 19
        && str_contains((string) ($e->errorInfo[2] ?? ''), 'UNIQUE constraint failed');
}

/** True when $e is a FOREIGN KEY violation. */
function isForeignKeyViolation(PDOException $e): bool
{
    return ($e->errorInfo[1] ?? null) === 19
        && str_contains((string) ($e->errorInfo[2] ?? ''), 'FOREIGN KEY constraint failed');
}
