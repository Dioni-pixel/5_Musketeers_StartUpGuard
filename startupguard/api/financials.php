<?php
// StartupGuard - financials endpoint
//
// GET  /api/financials.php?business_id=1[&start_date=Y-m-d][&end_date=Y-m-d][&limit=N]
//      Records for one business, oldest to newest. With limit, the most
//      recent N records in the range, still oldest to newest.
//
// POST /api/financials.php   (JSON body)
//      Add one record. Required: business_id, record_date, revenue, expenses,
//      salaries, marketing_cost, operational_cost, other_cost, customer_count.
//      Optional: notes. expenses must equal the four cost fields added up.
//      201 on success, 404 unknown business, 409 record already exists for that date.

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const FIN_MAX_LIMIT       = 500;
const FIN_MAX_NOTES_BYTES = 65535;          // app limit (SQLite TEXT itself has none)
const FIN_MAX_CUSTOMERS   = 4294967295;     // kept from the MySQL INT UNSIGNED range
const FIN_COST_FIELDS     = ['salaries', 'marketing_cost', 'operational_cost', 'other_cost'];
const FIN_MONEY_FIELDS    = ['revenue', 'expenses', 'salaries', 'marketing_cost', 'operational_cost', 'other_cost'];
const FIN_SELECT_COLUMNS  = 'id, business_id, record_date, revenue, expenses, salaries, marketing_cost,
                             operational_cost, other_cost, customer_count, notes, created_at';

requireMethod(['GET', 'POST']);

if (strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'GET') {
    handleGet();
}
handlePost();

// ---------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------

function handleGet(): never
{
    if (!array_key_exists('business_id', $_GET)) {
        sendError('VALIDATION_ERROR', 'business_id is required.', 400);
    }
    $businessId = validatePositiveInteger($_GET['business_id'], 'business_id');

    $startDate = optionalQueryDate('start_date');
    $endDate   = optionalQueryDate('end_date');
    if ($startDate !== null && $endDate !== null && $startDate > $endDate) {
        sendError('VALIDATION_ERROR', 'start_date must be on or before end_date.', 400);
    }

    $limit = null;
    if (isset($_GET['limit']) && $_GET['limit'] !== '') {
        $limit = validatePositiveInteger($_GET['limit'], 'limit');
        if ($limit > FIN_MAX_LIMIT) {
            sendError('VALIDATION_ERROR', sprintf('limit must be %d or less.', FIN_MAX_LIMIT), 400);
        }
    }

    requireBusiness($businessId);

    $where  = ['business_id = :business_id'];
    $params = ['business_id' => $businessId];
    if ($startDate !== null) {
        $where[]              = 'record_date >= :start_date';
        $params['start_date'] = $startDate;
    }
    if ($endDate !== null) {
        $where[]            = 'record_date <= :end_date';
        $params['end_date'] = $endDate;
    }

    // Newest first so LIMIT keeps the most recent rows; reversed below.
    $sql = 'SELECT ' . FIN_SELECT_COLUMNS . ' FROM financial_records WHERE '
         . implode(' AND ', $where) . ' ORDER BY record_date DESC';
    if ($limit !== null) {
        $sql .= ' LIMIT :limit';
    }

    $stmt = getDB()->prepare($sql);
    foreach ($params as $name => $value) {
        $stmt->bindValue(':' . $name, $value, is_int($value) ? PDO::PARAM_INT : PDO::PARAM_STR);
    }
    if ($limit !== null) {
        $stmt->bindValue(':limit', $limit, PDO::PARAM_INT);
    }
    $stmt->execute();

    $records = array_map('formatRecord', array_reverse($stmt->fetchAll()));

    sendJsonResponse([
        'business_id' => $businessId,
        'filters'     => ['start_date' => $startDate, 'end_date' => $endDate, 'limit' => $limit],
        'count'       => count($records),
        'records'     => $records,
    ]);
}

/** Validate an optional date query parameter; null when absent or empty. */
function optionalQueryDate(string $name): ?string
{
    if (!isset($_GET[$name]) || $_GET[$name] === '') {
        return null;
    }
    return validateDate($_GET[$name], $name);
}

// ---------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------

function handlePost(): never
{
    $body = getJsonBody();

    $allowed = ['business_id', 'record_date', ...FIN_MONEY_FIELDS, 'customer_count', 'notes'];
    $unknown = array_diff(array_keys($body), $allowed);
    if ($unknown !== []) {
        sendError('VALIDATION_ERROR', 'Unknown field(s): ' . implode(', ', $unknown) . '.', 400);
    }

    $required = ['business_id', 'record_date', ...FIN_MONEY_FIELDS, 'customer_count'];
    $missing  = array_values(array_filter($required, static fn ($f) => !array_key_exists($f, $body)));
    if ($missing !== []) {
        sendError('VALIDATION_ERROR', 'Missing required field(s): ' . implode(', ', $missing) . '.', 400);
    }

    // business_id must be a JSON integer or a digit string, never 1.0 or true.
    $businessId = validatePositiveInteger($body['business_id'], 'business_id');
    $recordDate = validateDate($body['record_date'], 'record_date');

    $money = [];
    foreach (FIN_MONEY_FIELDS as $field) {
        $money[$field] = validateMoney($body[$field], $field);
    }

    $costCents = 0;
    foreach (FIN_COST_FIELDS as $field) {
        $costCents += $money[$field]['cents'];
    }
    if ($costCents !== $money['expenses']['cents']) {
        sendError(
            'VALIDATION_ERROR',
            sprintf(
                'expenses (%s) must equal salaries + marketing_cost + operational_cost + other_cost (%s).',
                $money['expenses']['value'],
                centsToString($costCents)
            ),
            400
        );
    }

    $customerCount = validateCustomerCount($body['customer_count']);
    $notes         = validateNotes($body['notes'] ?? null);

    requireBusiness($businessId);

    $pdo = getDB();
    try {
        $stmt = $pdo->prepare(
            'INSERT INTO financial_records
               (business_id, record_date, revenue, expenses, salaries, marketing_cost,
                operational_cost, other_cost, customer_count, notes)
             VALUES
               (:business_id, :record_date, :revenue, :expenses, :salaries, :marketing_cost,
                :operational_cost, :other_cost, :customer_count, :notes)'
        );
        $stmt->bindValue(':business_id', $businessId, PDO::PARAM_INT);
        $stmt->bindValue(':record_date', $recordDate, PDO::PARAM_STR);
        foreach (FIN_MONEY_FIELDS as $field) {
            // Bound as validated decimal strings; the NUMERIC column stores them as numbers.
            $stmt->bindValue(':' . $field, $money[$field]['value'], PDO::PARAM_STR);
        }
        $stmt->bindValue(':customer_count', $customerCount, PDO::PARAM_INT);
        $stmt->bindValue(':notes', $notes, $notes === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
        $stmt->execute();
    } catch (PDOException $e) {
        if (isUniqueViolation($e)) {
            sendError(
                'DUPLICATE_RECORD',
                sprintf('A financial record for business %d on %s already exists.', $businessId, $recordDate),
                409
            );
        }
        if (isForeignKeyViolation($e)) {
            // Business deleted between the check above and the insert.
            sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
        }
        throw $e;
    }

    $id   = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT ' . FIN_SELECT_COLUMNS . ' FROM financial_records WHERE id = :id');
    $stmt->execute(['id' => $id]);

    header('Location: /api/financials.php?business_id=' . $businessId);
    sendJsonResponse(formatRecord($stmt->fetch()), 'Financial record created.', 201);
}

/**
 * Validate an amount for a NUMERIC(15,2) column: 0 or more, at most 2 decimals.
 * SQLite does not enforce the column type, so this is the real guard.
 * Accepts JSON numbers (20000, 20000.5) and plain numeric strings ("20000.50").
 * Rejects booleans, null, negatives, exponents and anything too large.
 *
 * @return array{value: string, cents: int}
 */
function validateMoney(mixed $value, string $field): array
{
    if (is_int($value)) {
        $text = (string) $value;
    } elseif (is_float($value) && is_finite($value)) {
        // Shortest round-trip form, e.g. 20000.5 -> "20000.5"; 1e20 -> "1.0e+20" (rejected).
        $text = (string) json_encode($value);
    } elseif (is_string($value)) {
        $text = trim($value);
    } else {
        $text = '';
    }

    if (preg_match('/^(\d{1,13})(?:\.(\d{1,2}))?$/', $text, $m) !== 1) {
        sendError(
            'VALIDATION_ERROR',
            sprintf('%s must be a number from 0 to 9999999999999.99 with at most 2 decimal places.', $field),
            400
        );
    }

    $cents = (int) $m[1] * 100 + (int) str_pad($m[2] ?? '', 2, '0');

    return ['value' => centsToString($cents), 'cents' => $cents];
}

/** 2000050 -> "20000.50" */
function centsToString(int $cents): string
{
    return sprintf('%d.%02d', intdiv($cents, 100), $cents % 100);
}

/** customer_count: whole number from 0 up to the INT UNSIGNED maximum. */
function validateCustomerCount(mixed $value): int
{
    if (is_string($value) && preg_match('/^\d+$/', trim($value)) === 1) {
        $value = filter_var(trim($value), FILTER_VALIDATE_INT);
    }
    if (!is_int($value) || $value < 0 || $value > FIN_MAX_CUSTOMERS) {
        sendError('VALIDATION_ERROR', 'customer_count must be a whole number of 0 or more.', 400);
    }
    return $value;
}

/** notes: optional string; empty or whitespace-only becomes null. */
function validateNotes(mixed $value): ?string
{
    if ($value === null) {
        return null;
    }
    if (!is_string($value)) {
        sendError('VALIDATION_ERROR', 'notes must be a string or null.', 400);
    }
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    if (strlen($value) > FIN_MAX_NOTES_BYTES) {
        sendError('VALIDATION_ERROR', sprintf('notes must be at most %d bytes.', FIN_MAX_NOTES_BYTES), 400);
    }
    return $value;
}

// ---------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------

/** Stop with 404 when the business does not exist. */
function requireBusiness(int $businessId): void
{
    $stmt = getDB()->prepare('SELECT 1 FROM businesses WHERE id = :id');
    $stmt->execute(['id' => $businessId]);
    if ($stmt->fetchColumn() === false) {
        sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
    }
}

/** Turn a DB row into API types, adding profit and profit_margin (%). */
function formatRecord(array $row): array
{
    $record = [
        'id'          => (int) $row['id'],
        'business_id' => (int) $row['business_id'],
        'record_date' => $row['record_date'],
    ];
    foreach (FIN_MONEY_FIELDS as $field) {
        $record[$field] = (float) $row[$field];
    }
    $record['customer_count'] = (int) $row['customer_count'];
    $record['profit']         = calculateProfit($row['revenue'], $row['expenses']);
    $record['profit_margin']  = calculateProfitMargin($row['revenue'], $row['expenses']);
    $record['notes']          = $row['notes'];
    $record['created_at']     = $row['created_at'];

    return $record;
}
