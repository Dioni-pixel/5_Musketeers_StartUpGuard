<?php
// StartupGuard - dashboard endpoint
//
// GET /api/dashboard.php?business_id=1
//     Everything the main dashboard needs in one response: the business,
//     its latest and previous financial records, recent history, counts,
//     pending decisions, recent competitor events, the latest AI analysis
//     (overall and per analysis type), the business's own active products,
//     and the headline metrics.
//
// Every metric is a plain PHP calculation on database values (no AI):
//   profit         = revenue - expenses
//   profit_margin  = profit / revenue * 100            (null when revenue is 0)
//   *_growth       = (current - previous) / previous * 100
//                    (null when there is no previous record or previous is 0)
//   monthly_burn   = expenses - revenue of the latest month, or 0 when not losing money
//   runway_months  = cash_balance / monthly_burn       (null when burn is 0, i.e. not burning cash)
// Money and percentages are rounded to 2 decimals, runway to 1.

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const DASH_HISTORY_MONTHS = 12;  // financial_history: most recent N records
const DASH_RECENT_EVENTS  = 5;   // recent_competitor_events: most recent N across all competitors

requireMethod('GET');

if (!array_key_exists('business_id', $_GET)) {
    sendError('VALIDATION_ERROR', 'business_id is required.', 400);
}
$businessId = validatePositiveInteger($_GET['business_id'], 'business_id');

$pdo = getDB();

// ---------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT id, name, industry, description, city, country, website, employee_count,
            cash_balance, currency, founded_year, created_at, updated_at
       FROM businesses WHERE id = :id'
);
$stmt->execute(['id' => $businessId]);
$businessRow = $stmt->fetch();
if ($businessRow === false) {
    sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
}

$business = [
    'id'             => (int) $businessRow['id'],
    'name'           => $businessRow['name'],
    'industry'       => $businessRow['industry'],
    'description'    => $businessRow['description'],
    'city'           => $businessRow['city'],
    'country'        => $businessRow['country'],
    'website'        => $businessRow['website'],
    'employee_count' => (int) $businessRow['employee_count'],
    'cash_balance'   => (float) $businessRow['cash_balance'],
    'currency'       => $businessRow['currency'],
    'founded_year'   => $businessRow['founded_year'] === null ? null : (int) $businessRow['founded_year'],
    'created_at'     => $businessRow['created_at'],
    'updated_at'     => $businessRow['updated_at'],
];

// ---------------------------------------------------------------------
// Financial records: latest N, newest first; [0] is latest, [1] previous
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT id, record_date, revenue, expenses, salaries, marketing_cost,
            operational_cost, other_cost, customer_count, notes
       FROM financial_records
      WHERE business_id = :business_id
      ORDER BY record_date DESC
      LIMIT :limit'
);
$stmt->bindValue(':business_id', $businessId, PDO::PARAM_INT);
$stmt->bindValue(':limit', DASH_HISTORY_MONTHS, PDO::PARAM_INT);
$stmt->execute();
$records = array_map('dashFormatRecord', $stmt->fetchAll());

$latest   = $records[0] ?? null;
$previous = $records[1] ?? null;

// ---------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT COUNT(*) AS total, COALESCE(SUM(active = 1), 0) AS active
       FROM products WHERE business_id = :business_id'
);
$stmt->execute(['business_id' => $businessId]);
$productCounts = array_map('intval', $stmt->fetch());

$stmt = $pdo->prepare(
    "SELECT COUNT(*) AS total,
            COALESCE(SUM(threat_level = 'low'), 0)      AS low,
            COALESCE(SUM(threat_level = 'medium'), 0)   AS medium,
            COALESCE(SUM(threat_level = 'high'), 0)     AS high,
            COALESCE(SUM(threat_level = 'critical'), 0) AS critical
       FROM competitors WHERE business_id = :business_id"
);
$stmt->execute(['business_id' => $businessId]);
$competitorCounts = array_map('intval', $stmt->fetch());

$stmt = $pdo->prepare(
    'SELECT COUNT(*)
       FROM market_events e
       JOIN competitors c ON c.id = e.competitor_id
      WHERE c.business_id = :business_id'
);
$stmt->execute(['business_id' => $businessId]);
$marketEventCount = (int) $stmt->fetchColumn();

// ---------------------------------------------------------------------
// Pending decisions: status 'proposed' (not yet approved or rejected)
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    "SELECT id, title, description, decision_type, status, estimated_cost,
            expected_revenue_change, expected_monthly_cost_change, expected_customer_change,
            risk_level, ai_recommendation, decision_date, created_at
       FROM business_decisions
      WHERE business_id = :business_id AND status = 'proposed'
      ORDER BY decision_date IS NULL, decision_date ASC, id ASC"
);
$stmt->execute(['business_id' => $businessId]);
$pendingDecisions = array_map(static fn (array $r): array => [
    'id'                           => (int) $r['id'],
    'title'                        => $r['title'],
    'description'                  => $r['description'],
    'decision_type'                => $r['decision_type'],
    'status'                       => $r['status'],
    'estimated_cost'               => (float) $r['estimated_cost'],
    'expected_revenue_change'      => dashNullableFloat($r['expected_revenue_change']),
    'expected_monthly_cost_change' => dashNullableFloat($r['expected_monthly_cost_change']),
    'expected_customer_change'     => $r['expected_customer_change'] === null ? null : (int) $r['expected_customer_change'],
    'risk_level'                   => $r['risk_level'],
    'ai_recommendation'            => $r['ai_recommendation'],
    'decision_date'                => $r['decision_date'],
    'created_at'                   => $r['created_at'],
], $stmt->fetchAll());

// ---------------------------------------------------------------------
// Recent competitor events (newest first, across all competitors)
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT e.id, e.competitor_id, c.name AS competitor_name, c.threat_level,
            e.event_type, e.title, e.description, e.event_date,
            e.source_name, e.source_url, e.importance_score
       FROM market_events e
       JOIN competitors c ON c.id = e.competitor_id
      WHERE c.business_id = :business_id
      ORDER BY e.event_date DESC, e.importance_score DESC, e.id DESC
      LIMIT :limit'
);
$stmt->bindValue(':business_id', $businessId, PDO::PARAM_INT);
$stmt->bindValue(':limit', DASH_RECENT_EVENTS, PDO::PARAM_INT);
$stmt->execute();
$recentEvents = array_map(static fn (array $r): array => [
    'id'               => (int) $r['id'],
    'competitor_id'    => (int) $r['competitor_id'],
    'competitor_name'  => $r['competitor_name'],
    'threat_level'     => $r['threat_level'],
    'event_type'       => $r['event_type'],
    'title'            => $r['title'],
    'description'      => $r['description'],
    'event_date'       => $r['event_date'],
    'source_name'      => $r['source_name'],
    'source_url'       => $r['source_url'],
    'importance_score' => (int) $r['importance_score'],
], $stmt->fetchAll());

// ---------------------------------------------------------------------
// Latest AI analysis (null when none yet)
// ---------------------------------------------------------------------

// Newest row first; the first row of each analysis_type is that type's latest.
$stmt = $pdo->prepare(
    'SELECT id, business_decision_id, analysis_type, risk_level, financial_risk, market_risk,
            summary, recommendations, model_used, created_at
       FROM ai_analysis
      WHERE business_id = :business_id
      ORDER BY created_at DESC, id DESC'
);
$stmt->execute(['business_id' => $businessId]);
$latestAnalysis       = null;
$latestAnalysisByType = [];
foreach ($stmt->fetchAll() as $analysisRow) {
    $type = $analysisRow['analysis_type'];
    if ($latestAnalysis !== null && isset($latestAnalysisByType[$type])) {
        continue;
    }
    $formatted = dashFormatAnalysis($analysisRow);
    $latestAnalysis ??= $formatted;
    $latestAnalysisByType[$type] ??= $formatted;
}

// ---------------------------------------------------------------------
// The business's own active products (for price comparisons)
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT id, name, description, category, price, cost
       FROM products
      WHERE business_id = :business_id AND active = 1
      ORDER BY category, name'
);
$stmt->execute(['business_id' => $businessId]);
$productList = array_map(static fn (array $r): array => [
    'id'          => (int) $r['id'],
    'name'        => $r['name'],
    'description' => $r['description'],
    'category'    => $r['category'],
    'price'       => (float) $r['price'],
    'cost'        => (float) $r['cost'],
    'currency'    => $business['currency'],
], $stmt->fetchAll());

// ---------------------------------------------------------------------
// Metrics (deterministic PHP, latest month vs previous month)
// ---------------------------------------------------------------------

// Burn uses the latest month only: calculateBurnRate() over one record is
// max(0, expenses - revenue). Runway = cash / burn, null when burn is 0.
$monthlyBurn = $latest === null ? null : calculateBurnRate([$latest]);
$runway      = $monthlyBurn === null ? null : calculateRunway($business['cash_balance'], $monthlyBurn);

$metrics = [
    'period'                 => $latest['record_date'] ?? null,
    'previous_period'        => $previous['record_date'] ?? null,
    'currency'               => $business['currency'],
    'cash_balance'           => $business['cash_balance'],
    'revenue'                => $latest['revenue'] ?? null,
    'expenses'               => $latest['expenses'] ?? null,
    'profit'                 => $latest['profit'] ?? null,
    'profit_margin'          => $latest['profit_margin'] ?? null,
    'customer_count'         => $latest['customer_count'] ?? null,
    'revenue_growth'         => dashGrowth($previous['revenue'] ?? null, $latest['revenue'] ?? null),
    'expense_growth'         => dashGrowth($previous['expenses'] ?? null, $latest['expenses'] ?? null),
    'customer_growth'        => dashGrowth($previous['customer_count'] ?? null, $latest['customer_count'] ?? null),
    'monthly_burn'           => $monthlyBurn,
    'runway_months'          => $runway,
    'is_profitable'          => $latest === null ? null : $latest['profit'] >= 0,
    'product_count'          => $productCounts['total'],
    'active_product_count'   => $productCounts['active'],
    'competitor_count'       => $competitorCounts['total'],
    'market_event_count'     => $marketEventCount,
    'pending_decision_count' => count($pendingDecisions),
];

sendJsonResponse([
    'business'                  => $business,
    'metrics'                   => $metrics,
    'latest_financial_record'   => $latest,
    'previous_financial_record' => $previous,
    'financial_history'         => array_reverse($records),  // oldest to newest, for charts
    'products'                  => [
        'total'  => $productCounts['total'],
        'active' => $productCounts['active'],
    ],
    'product_list'              => $productList,
    'competitors'               => [
        'total'           => $competitorCounts['total'],
        'by_threat_level' => [
            'low'      => $competitorCounts['low'],
            'medium'   => $competitorCounts['medium'],
            'high'     => $competitorCounts['high'],
            'critical' => $competitorCounts['critical'],
        ],
    ],
    'pending_decisions'         => $pendingDecisions,
    'recent_competitor_events'  => $recentEvents,
    'latest_ai_analysis'        => $latestAnalysis,
    'latest_ai_analysis_by_type' => (object) $latestAnalysisByType,  // {} when none
    'generated_at'              => gmdate('Y-m-d H:i:s'),
]);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** Turn an ai_analysis row into API types; recommendations holds the whole analysis JSON. */
function dashFormatAnalysis(array $row): array
{
    return [
        'id'                   => (int) $row['id'],
        'business_decision_id' => $row['business_decision_id'] === null ? null : (int) $row['business_decision_id'],
        'analysis_type'        => $row['analysis_type'],
        'risk_level'           => $row['risk_level'],
        'financial_risk'       => $row['financial_risk'] === null ? null : (int) $row['financial_risk'],
        'market_risk'          => $row['market_risk'] === null ? null : (int) $row['market_risk'],
        'summary'              => $row['summary'],
        // Stored as JSON text (the schema checks it is valid); sent as real JSON.
        'recommendations'      => $row['recommendations'] === null
            ? null
            : json_decode((string) $row['recommendations'], true),
        'model_used'           => $row['model_used'],
        'created_at'           => $row['created_at'],
    ];
}

/** Turn a financial_records row into API types, adding profit and profit_margin (%). */
function dashFormatRecord(array $row): array
{
    return [
        'id'               => (int) $row['id'],
        'record_date'      => $row['record_date'],
        'revenue'          => (float) $row['revenue'],
        'expenses'         => (float) $row['expenses'],
        'salaries'         => (float) $row['salaries'],
        'marketing_cost'   => (float) $row['marketing_cost'],
        'operational_cost' => (float) $row['operational_cost'],
        'other_cost'       => (float) $row['other_cost'],
        'customer_count'   => (int) $row['customer_count'],
        'profit'           => calculateProfit($row['revenue'], $row['expenses']),
        'profit_margin'    => calculateProfitMargin($row['revenue'], $row['expenses']),
        'notes'            => $row['notes'],
    ];
}

/** Growth in % from previous to current; null when either is missing or previous is 0. */
function dashGrowth(int|float|null $previous, int|float|null $current): ?float
{
    if ($previous === null || $current === null) {
        return null;
    }
    return calculatePercentageChange($previous, $current);
}

function dashNullableFloat(mixed $value): ?float
{
    return $value === null ? null : (float) $value;
}
