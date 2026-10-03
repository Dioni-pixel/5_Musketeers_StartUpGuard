<?php
// StartupGuard - PDO database connection
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
 * If the connection fails, the real reason goes to the server error log and
 * the client gets a generic 503. Host, user and password are never sent.
 */
function getDB(): PDO
{
    static $pdo = null;

    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $config = require __DIR__ . '/config.php';
    $db     = $config['db'];

    $dsn = sprintf(
        'mysql:host=%s;port=%d;dbname=%s;charset=%s',
        $db['host'],
        $db['port'],
        $db['name'],
        $db['charset']
    );

    $options = [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES   => false,
    ];

    try {
        $pdo = new PDO($dsn, $db['user'], $db['pass'], $options);
        // Read and write TIMESTAMP columns in UTC, matching seed.sql.
        $pdo->exec("SET time_zone = '+00:00'");
    } catch (PDOException $e) {
        // Log only the message: the stack trace would contain the password.
        error_log('StartupGuard DB connection failed: ' . $e->getMessage());
        sendError('DATABASE_UNAVAILABLE', 'The database is not available right now. Please try again later.', 503);
    }

    return $pdo;
}
