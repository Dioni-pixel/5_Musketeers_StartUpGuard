<?php
// StartupGuard - decisions endpoint (business decision simulator)
//
// GET  /api/decisions.php?business_id=1[&status=proposed][&id=N]
//      The business's current state and its decisions, each with its
//      projected state and the change against today.
//
// POST /api/decisions.php   (JSON body)
//      Create a proposed decision and return it with its projection.
//      Required: business_id, title, decision_type.
//      Optional: description, estimated_cost (initial investment, >= 0, default 0),
//      expected_revenue_change (monthly, can be negative),
//      expected_monthly_cost_change (monthly, can be negative),
//      expected_customer_change (can be negative), risk_level, decision_date.
//      New decisions are always 'proposed'. 201 on success, 404 unknown business.
//
// Every number is a plain PHP calculation on database values (no AI).
// Money is added up in whole cents so results are exact.
//
//   Current state (same rules as the dashboard):
//     revenue, expenses   = latest financial record
//     cash_balance        = businesses.cash_balance
//     profit              = revenue - expenses
//     monthly_burn        = max(0, expenses - revenue)
//     runway_months       = cash / burn   (null = not burning cash; 0 when cash <= 0)
//
//   Projected state for a decision:
//     cash_balance        = cash - estimated_cost   (can go negative; runway is then 0)
//     revenue             = revenue + expected_revenue_change
//     expenses            = expenses + expected_monthly_cost_change
//     profit, burn, runway as above
//     runway_difference   = projected runway - current runway
//                           (null when either runway is unlimited)
//
// Money and percentages are rounded to 2 decimals, runway to 1.

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const DEC_STATUSES            = ['proposed', 'approved', 'rejected', 'implemented', 'cancelled'];
const DEC_RISK_LEVELS         = ['low', 'medium', 'high', 'critical'];
const DEC_MAX_TITLE           = 200;
const DEC_MAX_TYPE            = 50;
const DEC_MAX_DESCRIPTION     = 65535;
const DEC_MAX_CUSTOMER_CHANGE = 2147483647;
const DEC_SELECT_COLUMNS      = 'id, business_id, title, description, decision_type, status, estimated_cost,
                                 expected_revenue_change, expected_monthly_cost_change, expected_customer_change,
                                 risk_level, ai_recommendation, actual_outcome, decision_date, created_at, updated_at';

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

    $status = null;
    if (isset($_GET['status']) && $_GET['status'] !== '') {
        $status = decValidateEnum($_GET['status'], 'status', DEC_STATUSES);
    }

    $decisionId = null;
    if (isset($_GET['id']) && $_GET['id'] !== '') {
        $decisionId = validatePositiveInteger($_GET['id'], 'id');
    }

    $business = decLoadBusiness($businessId);
    $current  = decCurrentState($business);

    $where  = ['business_id = :business_id'];
    $params = ['business_id' => $businessId];
    if ($status !== null) {
        $where[]          = 'status = :status';
        $params['status'] = $status;
    }
    if ($decisionId !== null) {
        $where[]      = 'id = :id';
        $params['id'] = $decisionId;
    }

    $stmt = getDB()->prepare(
        'SELECT ' . DEC_SELECT_COLUMNS . ' FROM business_decisions WHERE ' . implode(' AND ', $where)
        . ' ORDER BY decision_date IS NULL, decision_date ASC, id ASC'
    );
    $stmt->execute($params);
    $rows = $stmt->fetchAll();

    if ($decisionId !== null && $rows === []) {
        sendError(
            'DECISION_NOT_FOUND',
            sprintf('Decision %d was not found for business %d.', $decisionId, $businessId),
            404
        );
    }

    $decisions = array_map(static fn (array $row): array => decWithProjection($row, $current), $rows);

    sendJsonResponse([
        'business_id'   => $businessId,
        'business_name' => $business['name'],
        'currency'      => $business['currency'],
        'current_state' => decPublicState($current),
        'count'         => count($decisions),
        'decisions'     => $decisions,
    ]);
}

// ---------------------------------------------------------------------
// POST
// ---------------------------------------------------------------------

function handlePost(): never
{
    $body = getJsonBody();

    $allowed = [
        'business_id', 'title', 'description', 'decision_type', 'status', 'estimated_cost',
        'expected_revenue_change', 'expected_monthly_cost_change', 'expected_customer_change',
        'risk_level', 'decision_date',
    ];
    $unknown = array_diff(array_keys($body), $allowed);
    if ($unknown !== []) {
        sendError('VALIDATION_ERROR', 'Unknown field(s): ' . implode(', ', $unknown) . '.', 400);
    }

    $missing = array_values(array_filter(
        ['business_id', 'title', 'decision_type'],
        static fn ($f) => !array_key_exists($f, $body)
    ));
    if ($missing !== []) {
        sendError('VALIDATION_ERROR', 'Missing required field(s): ' . implode(', ', $missing) . '.', 400);
    }

    if (array_key_exists('status', $body) && $body['status'] !== 'proposed') {
        sendError('VALIDATION_ERROR', "New decisions are always created with status 'proposed'.", 400);
    }

    $businessId   = validatePositiveInteger($body['business_id'], 'business_id');
    $title        = decValidateText($body['title'], 'title', DEC_MAX_TITLE, true);
    $decisionType = decValidateText($body['decision_type'], 'decision_type', DEC_MAX_TYPE, true);
    $description  = decValidateText($body['description'] ?? null, 'description', DEC_MAX_DESCRIPTION, false);

    // estimated_cost defaults to 0 like the column; the monthly changes stay null when not given.
    $estimatedCost = decValidateMoney($body['estimated_cost'] ?? 0, 'estimated_cost', false);
    $revenueChange = ($body['expected_revenue_change'] ?? null) === null
        ? null : decValidateMoney($body['expected_revenue_change'], 'expected_revenue_change', true);
    $costChange    = ($body['expected_monthly_cost_change'] ?? null) === null
        ? null : decValidateMoney($body['expected_monthly_cost_change'], 'expected_monthly_cost_change', true);

    $customerChange = decValidateCustomerChange($body['expected_customer_change'] ?? null);

    $riskLevel = ($body['risk_level'] ?? null) === null
        ? null : decValidateEnum($body['risk_level'], 'risk_level', DEC_RISK_LEVELS);
    $decisionDate = ($body['decision_date'] ?? null) === null
        ? null : validateDate($body['decision_date'], 'decision_date');

    $business = decLoadBusiness($businessId);

    $pdo = getDB();
    try {
        $stmt = $pdo->prepare(
            "INSERT INTO business_decisions
               (business_id, title, description, decision_type, status, estimated_cost,
                expected_revenue_change, expected_monthly_cost_change, expected_customer_change,
                risk_level, decision_date)
             VALUES
               (:business_id, :title, :description, :decision_type, 'proposed', :estimated_cost,
                :revenue_change, :cost_change, :customer_change,
                :risk_level, :decision_date)"
        );
        $stmt->bindValue(':business_id', $businessId, PDO::PARAM_INT);
        $stmt->bindValue(':title', $title, PDO::PARAM_STR);
        decBindNullable($stmt, ':description', $description);
        $stmt->bindValue(':decision_type', $decisionType, PDO::PARAM_STR);
        // Money is bound as exact decimal strings; the NUMERIC column stores them as numbers.
        $stmt->bindValue(':estimated_cost', decCentsToString($estimatedCost), PDO::PARAM_STR);
        decBindNullable($stmt, ':revenue_change', $revenueChange === null ? null : decCentsToString($revenueChange));
        decBindNullable($stmt, ':cost_change', $costChange === null ? null : decCentsToString($costChange));
        $stmt->bindValue(
            ':customer_change',
            $customerChange,
            $customerChange === null ? PDO::PARAM_NULL : PDO::PARAM_INT
        );
        decBindNullable($stmt, ':risk_level', $riskLevel);
        decBindNullable($stmt, ':decision_date', $decisionDate);
        $stmt->execute();
    } catch (PDOException $e) {
        if (isForeignKeyViolation($e)) {
            // Business deleted between the check above and the insert.
            sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
        }
        throw $e;
    }

    $id   = (int) $pdo->lastInsertId();
    $stmt = $pdo->prepare('SELECT ' . DEC_SELECT_COLUMNS . ' FROM business_decisions WHERE id = :id');
    $stmt->execute(['id' => $id]);

    $current = decCurrentState($business);

    header('Location: /api/decisions.php?business_id=' . $businessId . '&id=' . $id);
    sendJsonResponse([
        'business_id'   => $businessId,
        'business_name' => $business['name'],
        'currency'      => $business['currency'],
        'current_state' => decPublicState($current),
        'decision'      => decWithProjection($stmt->fetch(), $current),
    ], 'Decision created.', 201);
}

// ---------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------

/** Load the business or stop with 404. */
function decLoadBusiness(int $businessId): array
{
    $stmt = getDB()->prepare('SELECT id, name, cash_balance, currency FROM businesses WHERE id = :id');
    $stmt->execute(['id' => $businessId]);
    $row = $stmt->fetch();
    if ($row === false) {
        sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
    }
    return $row;
}

/**
 * Current state: the business's cash and its latest financial record.
 * Revenue, expenses and customers are null when there are no records yet.
 */
function decCurrentState(array $business): array
{
    $stmt = getDB()->prepare(
        'SELECT record_date, revenue, expenses, customer_count
           FROM financial_records
          WHERE business_id = :business_id
          ORDER BY record_date DESC
          LIMIT 1'
    );
    $stmt->execute(['business_id' => (int) $business['id']]);
    $latest = $stmt->fetch();

    if ($latest === false) {
        return decBuildState(decToCents($business['cash_balance']), null, null, null, null);
    }

    return decBuildState(
        decToCents($business['cash_balance']),
        decToCents($latest['revenue']),
        decToCents($latest['expenses']),
        (int) $latest['customer_count'],
        $latest['record_date']
    );
}

/**
 * Derive profit, margin, burn and runway from cash, revenue and expenses (in cents).
 * The cents values are kept under '_cents' for exact differences; decPublicState() drops them.
 */
function decBuildState(int $cash, ?int $revenue, ?int $expenses, ?int $customers, ?string $basedOn): array
{
    $hasFinancials = $revenue !== null && $expenses !== null;
    $profit = $hasFinancials ? $revenue - $expenses : null;
    $burn   = $hasFinancials ? max(0, $expenses - $revenue) : null;

    return [
        'based_on_record_date' => $basedOn,
        'cash_balance'         => decCentsToFloat($cash),
        'revenue'              => decCentsToFloat($revenue),
        'expenses'             => decCentsToFloat($expenses),
        'profit'               => decCentsToFloat($profit),
        'profit_margin'        => $hasFinancials ? calculateProfitMargin($revenue / 100, $expenses / 100) : null,
        'monthly_burn'         => decCentsToFloat($burn),
        'runway_months'        => $burn === null ? null : calculateRunway($cash / 100, $burn / 100),
        'is_burning_cash'      => $burn === null ? null : $burn > 0,
        'customer_count'       => $customers,
        '_cents'               => [
            'cash'     => $cash,
            'revenue'  => $revenue,
            'expenses' => $expenses,
            'profit'   => $profit,
            'burn'     => $burn,
        ],
    ];
}

/** Decision row in API types, plus its projected state and the change against the current state. */
function decWithProjection(array $row, array $current): array
{
    $decision = decFormatDecision($row);

    $investment     = decToCents($row['estimated_cost']);
    $revenueChange  = $row['expected_revenue_change'] === null ? 0 : decToCents($row['expected_revenue_change']);
    $costChange     = $row['expected_monthly_cost_change'] === null ? 0 : decToCents($row['expected_monthly_cost_change']);
    $customerChange = $row['expected_customer_change'] === null ? 0 : (int) $row['expected_customer_change'];

    $c = $current['_cents'];
    if ($c['revenue'] === null) {
        $decision['projection'] = null;
        $decision['projection_unavailable_reason'] = 'The business has no financial records yet.';
        return $decision;
    }

    $projected = decBuildState(
        $c['cash'] - $investment,
        $c['revenue'] + $revenueChange,
        $c['expenses'] + $costChange,
        max(0, $current['customer_count'] + $customerChange),
        $current['based_on_record_date']
    );
    $p = $projected['_cents'];

    // Difference of the two displayed (rounded) runways, so the numbers on screen add up.
    $runwayDifference = ($current['runway_months'] === null || $projected['runway_months'] === null)
        ? null
        : round($projected['runway_months'] - $current['runway_months'], 1);

    $decision['projection'] = [
        'inputs'                         => [
            'initial_investment'     => decCentsToFloat($investment),
            'monthly_revenue_change' => decCentsToFloat($revenueChange),
            'monthly_expense_change' => decCentsToFloat($costChange),
            'customer_change'        => $customerChange,
        ],
        'cash_after_investment'          => decCentsToFloat($p['cash']),
        'cash_negative_after_investment' => $p['cash'] < 0,
        'projected_state'                => decPublicState($projected),
        'changes'                        => [
            'cash_balance'   => decCentsToFloat($p['cash'] - $c['cash']),
            'revenue'        => decCentsToFloat($p['revenue'] - $c['revenue']),
            'expenses'       => decCentsToFloat($p['expenses'] - $c['expenses']),
            'profit'         => decCentsToFloat($p['profit'] - $c['profit']),
            'monthly_burn'   => decCentsToFloat($p['burn'] - $c['burn']),
            'customer_count' => $projected['customer_count'] - $current['customer_count'],
        ],
        'runway_difference_months'       => $runwayDifference,
    ];

    return $decision;
}

/** Drop the internal cents values before sending a state. */
function decPublicState(array $state): array
{
    unset($state['_cents']);
    return $state;
}

/** Turn a business_decisions row into API types. */
function decFormatDecision(array $r): array
{
    return [
        'id'                           => (int) $r['id'],
        'business_id'                  => (int) $r['business_id'],
        'title'                        => $r['title'],
        'description'                  => $r['description'],
        'decision_type'                => $r['decision_type'],
        'status'                       => $r['status'],
        'estimated_cost'               => (float) $r['estimated_cost'],
        'expected_revenue_change'      => $r['expected_revenue_change'] === null ? null : (float) $r['expected_revenue_change'],
        'expected_monthly_cost_change' => $r['expected_monthly_cost_change'] === null ? null : (float) $r['expected_monthly_cost_change'],
        'expected_customer_change'     => $r['expected_customer_change'] === null ? null : (int) $r['expected_customer_change'],
        'risk_level'                   => $r['risk_level'],
        'ai_recommendation'            => $r['ai_recommendation'],
        'actual_outcome'               => $r['actual_outcome'],
        'decision_date'                => $r['decision_date'],
        'created_at'                   => $r['created_at'],
        'updated_at'                   => $r['updated_at'],
    ];
}

// ---------------------------------------------------------------------
// Money in cents
// ---------------------------------------------------------------------

/** DB amount (int, float or numeric string, at most 2 decimals) to whole cents. */
function decToCents(mixed $value): int
{
    return (int) round(toNumber($value, 'amount') * 100);
}

function decCentsToFloat(?int $cents): ?float
{
    return $cents === null ? null : $cents / 100;
}

/** -150050 -> "-1500.50" */
function decCentsToString(int $cents): string
{
    $abs = abs($cents);
    return sprintf('%s%d.%02d', $cents < 0 ? '-' : '', intdiv($abs, 100), $abs % 100);
}

// ---------------------------------------------------------------------
// Validation (each stops with 400 VALIDATION_ERROR)
// ---------------------------------------------------------------------

/**
 * Amount with at most 13 digits before the point and 2 after, returned in cents.
 * Accepts JSON numbers and plain numeric strings; negatives only when $allowNegative.
 * Rejects booleans, null, exponents and anything too large.
 */
function decValidateMoney(mixed $value, string $field, bool $allowNegative): int
{
    if (is_int($value)) {
        $text = (string) $value;
    } elseif (is_float($value) && is_finite($value)) {
        $text = (string) json_encode($value);  // shortest form, e.g. 4500.5 -> "4500.5"
    } elseif (is_string($value)) {
        $text = trim($value);
    } else {
        $text = '';
    }

    $sign = $allowNegative ? '(-?)' : '()';
    if (preg_match('/^' . $sign . '(\d{1,13})(?:\.(\d{1,2}))?$/', $text, $m) !== 1) {
        sendError(
            'VALIDATION_ERROR',
            $allowNegative
                ? sprintf('%s must be a number (negative allowed) with at most 2 decimal places.', $field)
                : sprintf('%s must be a number of 0 or more with at most 2 decimal places.', $field),
            400
        );
    }

    $cents = (int) $m[2] * 100 + (int) str_pad($m[3] ?? '', 2, '0');
    return $m[1] === '-' ? -$cents : $cents;
}

/** Whole number, negative allowed; null when not given. */
function decValidateCustomerChange(mixed $value): ?int
{
    if ($value === null) {
        return null;
    }
    if (is_string($value) && preg_match('/^-?\d+$/', trim($value)) === 1) {
        $value = filter_var(trim($value), FILTER_VALIDATE_INT);
    }
    if (!is_int($value) || abs($value) > DEC_MAX_CUSTOMER_CHANGE) {
        sendError('VALIDATION_ERROR', 'expected_customer_change must be a whole number (negative allowed).', 400);
    }
    return $value;
}

/**
 * Trimmed UTF-8 string of at most $max characters. A required field must not be
 * empty; an optional one that is empty or null becomes null.
 */
function decValidateText(mixed $value, string $field, int $max, bool $required): ?string
{
    if ($value === null && !$required) {
        return null;
    }
    if (!is_string($value)) {
        sendError('VALIDATION_ERROR', sprintf('%s must be a string.', $field), 400);
    }
    $value = trim($value);
    if ($value === '') {
        if ($required) {
            sendError('VALIDATION_ERROR', sprintf('%s must not be empty.', $field), 400);
        }
        return null;
    }
    // Counts characters, not bytes, without needing mbstring.
    $length = preg_match_all('/./us', $value);
    if ($length === false || $length > $max) {
        sendError('VALIDATION_ERROR', sprintf('%s must be valid text of at most %d characters.', $field, $max), 400);
    }
    return $value;
}

/** Value must be exactly one of $options. */
function decValidateEnum(mixed $value, string $field, array $options): string
{
    if (!is_string($value) || !in_array($value, $options, true)) {
        sendError('VALIDATION_ERROR', sprintf('%s must be one of: %s.', $field, implode(', ', $options)), 400);
    }
    return $value;
}

function decBindNullable(PDOStatement $stmt, string $name, ?string $value): void
{
    $stmt->bindValue($name, $value, $value === null ? PDO::PARAM_NULL : PDO::PARAM_STR);
}
