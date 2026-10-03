<?php
// StartupGuard - shared helpers
//
// Every endpoint should start with:
//   require_once __DIR__ . '/db.php';   // also loads this file
//
// Response shapes used by every API:
//   success: {"success": true,  "data": {...}, "message": null}
//   error:   {"success": false, "data": null, "error": {"code": "...", "message": "..."}}

declare(strict_types=1);

// ---------------------------------------------------------------------
// Error safety: never print PHP errors, SQL errors or stack traces.
// ---------------------------------------------------------------------

ini_set('display_errors', '0');
ini_set('log_errors', '1');

set_exception_handler(static function (Throwable $e): void {
    // Full detail goes to the server log only.
    error_log(sprintf(
        'StartupGuard %s: %s in %s:%d',
        $e::class,
        $e->getMessage(),
        $e->getFile(),
        $e->getLine()
    ));

    if ($e instanceof PDOException) {
        sendError('DATABASE_ERROR', 'A database error occurred.', 500);
    }
    sendError('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
});

register_shutdown_function(static function (): void {
    $error = error_get_last();
    $fatal = E_ERROR | E_PARSE | E_CORE_ERROR | E_COMPILE_ERROR;

    if ($error !== null && ($error['type'] & $fatal) && !headers_sent()) {
        sendError('INTERNAL_ERROR', 'An unexpected error occurred.', 500);
    }
});

// ---------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------

/**
 * Send a success response and stop.
 *
 * @param mixed       $data    Payload; null is sent as an empty object {}.
 * @param string|null $message Optional human-readable note.
 */
function sendJsonResponse(mixed $data = null, ?string $message = null, int $statusCode = 200): never
{
    outputJson($statusCode, [
        'success' => true,
        'data'    => $data ?? new stdClass(),
        'message' => $message,
    ]);
}

/**
 * Send an error response and stop.
 *
 * @param string $code       Machine-readable code, e.g. VALIDATION_ERROR.
 * @param string $message    Safe message for the client. Never pass SQL or exception text.
 * @param int    $statusCode HTTP status (4xx or 5xx).
 */
function sendError(string $code, string $message, int $statusCode = 400): never
{
    outputJson($statusCode, [
        'success' => false,
        'data'    => null,
        'error'   => [
            'code'    => $code,
            'message' => $message,
        ],
    ]);
}

/** Write a JSON body with headers and exit. Used by the two functions above. */
function outputJson(int $statusCode, array $payload): never
{
    // Drop anything already buffered (warnings, stray echo) so the body is valid JSON.
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    if (!headers_sent()) {
        http_response_code($statusCode);
        header('Content-Type: application/json; charset=utf-8');
        header('Cache-Control: no-store');
        header('X-Content-Type-Options: nosniff');
    }

    $json = json_encode(
        $payload,
        JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE
    );

    if ($json === false) {
        if (!headers_sent()) {
            http_response_code(500);
        }
        $json = '{"success":false,"data":null,"error":{"code":"INTERNAL_ERROR","message":"Could not encode the response."}}';
    }

    echo $json;
    exit;
}

// ---------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------

/**
 * Stop with 405 unless the request uses one of the allowed methods.
 *
 * @param string|string[] $allowed e.g. 'GET' or ['GET', 'POST']
 */
function requireMethod(string|array $allowed): void
{
    $allowed = array_map('strtoupper', (array) $allowed);
    $method  = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

    if (!in_array($method, $allowed, true)) {
        if (!headers_sent()) {
            header('Allow: ' . implode(', ', $allowed));
        }
        sendError(
            'METHOD_NOT_ALLOWED',
            sprintf('Method %s is not allowed. Use %s.', $method, implode(' or ', $allowed)),
            405
        );
    }
}

/**
 * Read the request body as a JSON object and return it as an array.
 * Stops with 400 when the body is empty, not valid JSON, or not an object.
 */
function getJsonBody(): array
{
    $raw = file_get_contents('php://input');

    if ($raw === false || trim($raw) === '') {
        sendError('EMPTY_BODY', 'The request body must be a JSON object.', 400);
    }

    try {
        $data = json_decode($raw, true, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException) {
        sendError('INVALID_JSON', 'The request body is not valid JSON.', 400);
    }

    // Accept {...} only, not [...] or a bare value.
    if (!is_array($data) || !str_starts_with(ltrim($raw), '{')) {
        sendError('INVALID_JSON', 'The request body must be a JSON object.', 400);
    }

    return $data;
}

// ---------------------------------------------------------------------
// Validation (each stops with 400 VALIDATION_ERROR on bad input)
// ---------------------------------------------------------------------

/**
 * Return $value as a positive int (1 or more). Accepts ints and digit strings
 * such as query parameters ("12"). Rejects "0", "-3", "1.5", "12abc", "", null.
 */
function validatePositiveInteger(mixed $value, string $field): int
{
    if (is_int($value)) {
        $int = $value;
    } elseif (is_string($value) && preg_match('/^\d+$/', trim($value)) === 1) {
        $int = filter_var(trim($value), FILTER_VALIDATE_INT);
    } else {
        $int = false;
    }

    if ($int === false || $int < 1) {
        sendError('VALIDATION_ERROR', sprintf('%s must be a positive integer.', $field), 400);
    }

    return $int;
}

/**
 * Return $value as a valid calendar date string in $format (default Y-m-d,
 * the format the DATE columns store). Rejects impossible dates such as 2026-02-30.
 */
function validateDate(mixed $value, string $field, string $format = 'Y-m-d'): string
{
    if (is_string($value)) {
        $value = trim($value);
        $date  = DateTimeImmutable::createFromFormat('!' . $format, $value);
        $errors = DateTimeImmutable::getLastErrors();

        $clean = $date !== false
            && ($errors === false || ($errors['warning_count'] === 0 && $errors['error_count'] === 0))
            && $date->format($format) === $value;

        if ($clean) {
            return $value;
        }
    }

    sendError('VALIDATION_ERROR', sprintf('%s must be a valid date in the format %s.', $field, $format), 400);
}

// ---------------------------------------------------------------------
// Financial calculations
//
// Amounts may be ints, floats or numeric strings (SQLite returns NUMERIC
// columns as int or float). Results are rounded to 2 decimal places.
// ---------------------------------------------------------------------

/** Convert a numeric value to float, or throw for anything else (a coding error, not user input). */
function toNumber(mixed $value, string $name): float
{
    if (is_int($value) || is_float($value) || (is_string($value) && is_numeric($value))) {
        return (float) $value;
    }
    throw new InvalidArgumentException(sprintf('%s must be numeric.', $name));
}

/**
 * Percentage change from $old to $new, e.g. 15000 -> 20000 = 33.33.
 * Uses |old| as the base, so a loss growing from -2000 to -4000 is -100.0 (worse).
 * Returns null when $old is 0 (change is undefined).
 */
function calculatePercentageChange(mixed $old, mixed $new): ?float
{
    $old = toNumber($old, 'old');
    $new = toNumber($new, 'new');

    if ($old == 0.0) {
        return null;
    }

    return round((($new - $old) / abs($old)) * 100, 2);
}

/** Profit = revenue - expenses. Negative means a loss. */
function calculateProfit(mixed $revenue, mixed $expenses): float
{
    return round(toNumber($revenue, 'revenue') - toNumber($expenses, 'expenses'), 2);
}

/**
 * Profit margin as a percentage of revenue, e.g. revenue 20000, expenses 24000 = -20.0.
 * Returns null when revenue is 0 or less (margin is undefined).
 */
function calculateProfitMargin(mixed $revenue, mixed $expenses): ?float
{
    $revenue = toNumber($revenue, 'revenue');

    if ($revenue <= 0.0) {
        return null;
    }

    return round((($revenue - toNumber($expenses, 'expenses')) / $revenue) * 100, 2);
}

/**
 * Net monthly burn rate: the average of (expenses - revenue) across the given
 * monthly records. 0 when the business is not losing money on average.
 * Returns null when no records are given.
 *
 * Pass the months to average, e.g. the latest 3 rows of financial_records.
 *
 * @param array<int, array{revenue: mixed, expenses: mixed}> $records
 */
function calculateBurnRate(array $records): ?float
{
    if ($records === []) {
        return null;
    }

    $netBurn = 0.0;
    foreach ($records as $i => $record) {
        if (!is_array($record) || !array_key_exists('revenue', $record) || !array_key_exists('expenses', $record)) {
            throw new InvalidArgumentException(sprintf('Record %s needs revenue and expenses.', $i));
        }
        $netBurn += toNumber($record['expenses'], 'expenses') - toNumber($record['revenue'], 'revenue');
    }

    return round(max(0.0, $netBurn / count($records)), 2);
}

/**
 * Runway in months: how long the cash balance lasts at the given burn rate.
 * Returns null when the burn rate is 0 or less (not burning cash, so runway is unlimited).
 * Returns 0 when there is no cash left.
 */
function calculateRunway(mixed $cashBalance, mixed $burnRate): ?float
{
    $cash = toNumber($cashBalance, 'cashBalance');
    $burn = toNumber($burnRate, 'burnRate');

    if ($burn <= 0.0) {
        return null;
    }

    return round(max(0.0, $cash) / $burn, 1);
}
