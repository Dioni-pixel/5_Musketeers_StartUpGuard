<?php
// StartupGuard - competitor intelligence endpoint
//
// GET /api/competitors.php?business_id=1
//     Competitors of a business with their products, current prices, full
//     price history, market events, activity counts and a pricing trajectory,
//     plus ready-to-plot series under "charts".
//
// This is descriptive intelligence: every number is a plain PHP calculation
// on recorded data. Nothing here predicts what a competitor will do next.
//
// Rules:
//   price_change            = current - previous, from the product's latest two
//                             price_history rows (null with fewer than two)
//   price_change_percentage = price_change / previous * 100 (null when previous is 0)
//   price stats (avg/min/max) use active products priced in the business currency
//   time windows count back from today's date on the server (UTC), inclusive:
//     last 30 days, last 90 days, last year = 365 days
//   price_changes_last_90_days = price_history rows in the window that follow an
//                             earlier row of the same product (a product's first
//                             row is its initial price, not a change)
//   expansions / partnerships = market_events with event_type EXPANSION / PARTNERSHIP
//   pricing trajectory (product): net change from the first to the latest recorded
//     price.  > +2%  INCREASING,  < -2%  DECREASING,  otherwise STABLE.
//     Fewer than two recorded prices: INSUFFICIENT_DATA.
//   pricing trajectory (competitor / market): the average of the product net
//     changes above with the same thresholds; INSUFFICIENT_DATA when no product
//     has two recorded prices.
//
// Queries: one each for business, competitors, products, price history and
// market events, whatever the number of competitors (no per-row queries).

declare(strict_types=1);

require_once __DIR__ . '/db.php';

const COMP_TRAJECTORY_THRESHOLD = 2.0;  // percent; smaller net moves count as STABLE
const COMP_TIMELINE_MONTHS      = 12;   // charts.events_timeline: months ending this month

requireMethod('GET');

if (!array_key_exists('business_id', $_GET)) {
    sendError('VALIDATION_ERROR', 'business_id is required.', 400);
}
$businessId = validatePositiveInteger($_GET['business_id'], 'business_id');

$pdo = getDB();

// ---------------------------------------------------------------------
// Time windows (UTC dates, inclusive)
// ---------------------------------------------------------------------

$today    = new DateTimeImmutable('today', new DateTimeZone('UTC'));
$from30   = $today->modify('-30 days')->format('Y-m-d');
$from90   = $today->modify('-90 days')->format('Y-m-d');
$fromYear = $today->modify('-365 days')->format('Y-m-d');

// ---------------------------------------------------------------------
// Business
// ---------------------------------------------------------------------

$stmt = $pdo->prepare('SELECT id, name, currency FROM businesses WHERE id = :id');
$stmt->execute(['id' => $businessId]);
$businessRow = $stmt->fetch();
if ($businessRow === false) {
    sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
}
$currency = $businessRow['currency'];

// ---------------------------------------------------------------------
// Competitors
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT id, name, website, industry, city, country, description, estimated_size,
            estimated_market_share, threat_level, source_url, last_updated, created_at
       FROM competitors
      WHERE business_id = :business_id
      ORDER BY name ASC, id ASC'
);
$stmt->execute(['business_id' => $businessId]);

$competitors = [];  // keyed by id while building, re-indexed before sending
foreach ($stmt->fetchAll() as $r) {
    $competitors[(int) $r['id']] = [
        'id'                     => (int) $r['id'],
        'name'                   => $r['name'],
        'website'                => $r['website'],
        'industry'               => $r['industry'],
        'city'                   => $r['city'],
        'country'                => $r['country'],
        'description'            => $r['description'],
        'estimated_size'         => $r['estimated_size'],
        'estimated_market_share' => $r['estimated_market_share'] === null ? null : (float) $r['estimated_market_share'],
        'threat_level'           => $r['threat_level'],
        'source_url'             => $r['source_url'],
        'last_updated'           => $r['last_updated'],
        'created_at'             => $r['created_at'],
        'pricing'                => null,  // filled below
        'activity'               => null,  // filled below
        'latest_event'           => null,
        'products'               => [],
    ];
}

// ---------------------------------------------------------------------
// Price history: every row for this business's products, oldest first.
// The latest two rows per product are the last two of each list.
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT ph.competitor_product_id, ph.price, ph.currency, ph.recorded_at
       FROM price_history ph
       JOIN competitor_products p ON p.id = ph.competitor_product_id
       JOIN competitors c         ON c.id = p.competitor_id
      WHERE c.business_id = :business_id
      ORDER BY ph.competitor_product_id ASC, ph.recorded_at ASC, ph.id ASC'
);
$stmt->execute(['business_id' => $businessId]);

$historyByProduct = [];
foreach ($stmt->fetchAll() as $r) {
    $historyByProduct[(int) $r['competitor_product_id']][] = [
        'recorded_at' => $r['recorded_at'],
        'price'       => (float) $r['price'],
        'currency'    => $r['currency'],
    ];
}

// ---------------------------------------------------------------------
// Products, with latest change and trajectory from their history
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT p.id, p.competitor_id, p.name, p.description, p.category, p.current_price,
            p.currency, p.product_url, p.active, p.last_checked
       FROM competitor_products p
       JOIN competitors c ON c.id = p.competitor_id
      WHERE c.business_id = :business_id
      ORDER BY c.name ASC, c.id ASC, p.name ASC, p.id ASC'
);
$stmt->execute(['business_id' => $businessId]);

$allProducts    = [];
$priceChanges90 = [];  // competitor_id => count
$latestChange   = null;
foreach ($stmt->fetchAll() as $r) {
    $productId    = (int) $r['id'];
    $competitorId = (int) $r['competitor_id'];
    $history      = $historyByProduct[$productId] ?? [];

    // Compare prices only within the product's current currency.
    $comparable = array_values(array_filter(
        $history,
        static fn (array $h): bool => $h['currency'] === $r['currency']
    ));

    $count    = count($comparable);
    $current  = $count >= 1 ? $comparable[$count - 1] : null;
    $previous = $count >= 2 ? $comparable[$count - 2] : null;

    $change = null;
    if ($previous !== null) {
        $change = [
            'previous_price'          => $previous['price'],
            'current_price'           => $current['price'],
            'price_change'            => compMoneyDiff($current['price'], $previous['price']),
            'price_change_percentage' => calculatePercentageChange($previous['price'], $current['price']),
            'previous_recorded_at'    => $previous['recorded_at'],
            'changed_at'              => $current['recorded_at'],
        ];
    }

    $netChange = $count >= 2 ? compNetChange($comparable[0]['price'], $current['price']) : null;

    for ($i = 1; $i < $count; $i++) {
        if ($comparable[$i]['recorded_at'] >= $from90) {
            $priceChanges90[$competitorId] = ($priceChanges90[$competitorId] ?? 0) + 1;
        }
    }

    $product = [
        'id'                      => $productId,
        'competitor_id'           => $competitorId,
        'name'                    => $r['name'],
        'description'             => $r['description'],
        'category'                => $r['category'],
        'current_price'           => (float) $r['current_price'],
        'currency'                => $r['currency'],
        'product_url'             => $r['product_url'],
        'active'                  => (int) $r['active'] === 1,
        'last_checked'            => $r['last_checked'],
        'previous_price'          => $change['previous_price'] ?? null,
        'price_change'            => $change['price_change'] ?? null,
        'price_change_percentage' => $change['price_change_percentage'] ?? null,
        'last_price_change_at'    => $change['changed_at'] ?? null,
        'price_points'            => $count,
        'first_recorded_price'    => $count >= 1 ? $comparable[0]['price'] : null,
        'net_change_percentage'   => $netChange,
        'pricing_trajectory'      => compTrajectory($netChange),
        'price_history'           => array_map(static fn (array $h): array => [
            'date'     => $h['recorded_at'],
            'price'    => $h['price'],
            'currency' => $h['currency'],
        ], $history),
    ];

    if ($change !== null && ($latestChange === null || $change['changed_at'] > $latestChange['changed_at'])) {
        $latestChange = [
            'competitor_id'   => $competitorId,
            'competitor_name' => $competitors[$competitorId]['name'],
            'product_id'      => $productId,
            'product_name'    => $r['name'],
            'currency'        => $r['currency'],
        ] + $change;
    }

    $allProducts[] = $product;
    $competitors[$competitorId]['products'][] = $product;
}

// ---------------------------------------------------------------------
// Market events: all for this business, newest first
// ---------------------------------------------------------------------

$stmt = $pdo->prepare(
    'SELECT e.id, e.competitor_id, c.name AS competitor_name, e.event_type, e.title,
            e.description, e.event_date, e.source_name, e.source_url, e.importance_score
       FROM market_events e
       JOIN competitors c ON c.id = e.competitor_id
      WHERE c.business_id = :business_id
      ORDER BY e.event_date DESC, e.importance_score DESC, e.id DESC'
);
$stmt->execute(['business_id' => $businessId]);

$emptyActivity = [
    'events_last_30_days'    => 0,
    'events_last_90_days'    => 0,
    'expansions_last_year'   => 0,
    'partnerships_last_year' => 0,
    'total_events'           => 0,
];
$events   = [];
$activity = [];  // competitor_id => counts
foreach ($stmt->fetchAll() as $r) {
    $event = [
        'id'               => (int) $r['id'],
        'competitor_id'    => (int) $r['competitor_id'],
        'competitor_name'  => $r['competitor_name'],
        'event_type'       => strtoupper((string) $r['event_type']),
        'title'            => $r['title'],
        'description'      => $r['description'],
        'event_date'       => $r['event_date'],
        'source_name'      => $r['source_name'],
        'source_url'       => $r['source_url'],
        'importance_score' => (int) $r['importance_score'],
    ];
    $events[] = $event;

    $cid = $event['competitor_id'];
    $a   = $activity[$cid] ?? $emptyActivity;
    $a['total_events']++;
    if ($event['event_date'] >= $from30) {
        $a['events_last_30_days']++;
    }
    if ($event['event_date'] >= $from90) {
        $a['events_last_90_days']++;
    }
    if ($event['event_date'] >= $fromYear && $event['event_type'] === 'EXPANSION') {
        $a['expansions_last_year']++;
    }
    if ($event['event_date'] >= $fromYear && $event['event_type'] === 'PARTNERSHIP') {
        $a['partnerships_last_year']++;
    }
    $activity[$cid] = $a;

    // Events arrive newest first, so the first one seen is the latest.
    if ($competitors[$cid]['latest_event'] === null) {
        $competitors[$cid]['latest_event'] = $event;
    }
}

// ---------------------------------------------------------------------
// Per-competitor pricing and activity
// ---------------------------------------------------------------------

$activityTotals = [
    'events_last_30_days'        => 0,
    'events_last_90_days'        => 0,
    'price_changes_last_90_days' => 0,
    'expansions_last_year'       => 0,
    'partnerships_last_year'     => 0,
    'total_events'               => 0,
];

foreach ($competitors as $cid => $c) {
    $a = $activity[$cid] ?? $emptyActivity;
    $a = [
        'events_last_30_days'        => $a['events_last_30_days'],
        'events_last_90_days'        => $a['events_last_90_days'],
        'price_changes_last_90_days' => $priceChanges90[$cid] ?? 0,
        'expansions_last_year'       => $a['expansions_last_year'],
        'partnerships_last_year'     => $a['partnerships_last_year'],
        'total_events'               => $a['total_events'],
    ];
    foreach ($a as $k => $v) {
        $activityTotals[$k] += $v;
    }

    $competitors[$cid]['activity'] = $a;
    $competitors[$cid]['pricing']  = compPricingSummary($c['products'], $currency);
}

$competitorNames = array_column($competitors, 'name', 'id');
$competitors     = array_values($competitors);

// ---------------------------------------------------------------------
// Market summary
// ---------------------------------------------------------------------

$marketPricing = compPricingSummary($allProducts, $currency);

$byCategory = [];
foreach ($allProducts as $p) {
    $byCategory[$p['category'] ?? 'Uncategorized'][] = $p;
}
ksort($byCategory);
$categoryStats = [];
foreach ($byCategory as $category => $products) {
    $categoryStats[] = ['category' => (string) $category] + compPricingSummary($products, $currency);
}

$summary = [
    'currency'                      => $currency,
    'competitor_count'              => count($competitors),
    'product_count'                 => count($allProducts),
    'active_product_count'          => count(array_filter($allProducts, static fn (array $p): bool => $p['active'])),
    'priced_product_count'          => $marketPricing['priced_product_count'],
    'other_currency_product_count'  => $marketPricing['other_currency_product_count'],
    'average_price'                 => $marketPricing['average_price'],
    'min_price'                     => $marketPricing['min_price'],
    'max_price'                     => $marketPricing['max_price'],
    'cheapest_product'              => $marketPricing['cheapest_product'],
    'most_expensive_product'        => $marketPricing['most_expensive_product'],
    'latest_price_change'           => $latestChange,
    'pricing_trajectory'            => $marketPricing['pricing_trajectory'],
    'average_net_change_percentage' => $marketPricing['average_net_change_percentage'],
    'activity'                      => $activityTotals,
    'by_category'                   => $categoryStats,
];

// ---------------------------------------------------------------------
// Chart series (parallel arrays: labels[i] goes with values[i])
// ---------------------------------------------------------------------

$label = static fn (array $p): string => ($competitorNames[$p['competitor_id']] ?? '') . ' · ' . $p['name'];

// Months for the timeline, oldest first, ending with the current month.
$months     = [];
$firstMonth = $today->modify('first day of this month');
for ($i = COMP_TIMELINE_MONTHS - 1; $i >= 0; $i--) {
    $months[] = $firstMonth->modify(sprintf('-%d months', $i))->format('Y-m');
}
$monthIndex = array_flip($months);

$eventTypes = array_values(array_unique(array_column($events, 'event_type')));
sort($eventTypes);
$timeline   = array_fill_keys($eventTypes, array_fill(0, count($months), 0));
$typeCounts = array_fill_keys($eventTypes, 0);
foreach ($events as $e) {
    $typeCounts[$e['event_type']]++;
    $month = substr($e['event_date'], 0, 7);
    if (isset($monthIndex[$month])) {
        $timeline[$e['event_type']][$monthIndex[$month]]++;
    }
}

$pricedProducts  = array_values(array_filter($allProducts, static fn (array $p): bool => $p['active'] && $p['currency'] === $currency));
$changedProducts = array_values(array_filter($allProducts, static fn (array $p): bool => $p['price_change'] !== null));

$charts = [
    // Bar chart: current price of every active product in the business currency.
    'price_comparison' => [
        'currency'    => $currency,
        'labels'      => array_map($label, $pricedProducts),
        'product_ids' => array_column($pricedProducts, 'id'),
        'competitors' => array_map(static fn (array $p): string => $competitorNames[$p['competitor_id']] ?? '', $pricedProducts),
        'categories'  => array_column($pricedProducts, 'category'),
        'values'      => array_column($pricedProducts, 'current_price'),
    ],
    // Line (stepped) chart: one series per product; points are {x: date, y: price}.
    'price_history' => [
        'series' => array_map(static fn (array $p): array => [
            'product_id'    => $p['id'],
            'competitor_id' => $p['competitor_id'],
            'label'         => $label($p),
            'currency'      => $p['currency'],
            'trajectory'    => $p['pricing_trajectory'],
            'points'        => array_map(static fn (array $h): array => ['x' => $h['date'], 'y' => $h['price']], $p['price_history']),
        ], $allProducts),
    ],
    // Bar chart: latest change of each product that has one.
    'latest_price_changes' => [
        'labels'      => array_map($label, $changedProducts),
        'product_ids' => array_column($changedProducts, 'id'),
        'amounts'     => array_column($changedProducts, 'price_change'),
        'percentages' => array_column($changedProducts, 'price_change_percentage'),
        'changed_at'  => array_column($changedProducts, 'last_price_change_at'),
    ],
    // Stacked bar chart: market events per month, one series per event type.
    'events_timeline' => [
        'labels' => $months,
        'series' => array_map(static fn (string $type): array => ['event_type' => $type, 'data' => $timeline[$type]], $eventTypes),
    ],
    // Doughnut: all market events by type.
    'events_by_type' => [
        'labels' => $eventTypes,
        'values' => array_values($typeCounts),
    ],
    // Grouped bar chart: activity per competitor.
    'activity_by_competitor' => [
        'labels'                     => array_column($competitors, 'name'),
        'competitor_ids'             => array_column($competitors, 'id'),
        'events_last_30_days'        => array_map(static fn (array $c): int => $c['activity']['events_last_30_days'], $competitors),
        'events_last_90_days'        => array_map(static fn (array $c): int => $c['activity']['events_last_90_days'], $competitors),
        'price_changes_last_90_days' => array_map(static fn (array $c): int => $c['activity']['price_changes_last_90_days'], $competitors),
        'expansions_last_year'       => array_map(static fn (array $c): int => $c['activity']['expansions_last_year'], $competitors),
        'partnerships_last_year'     => array_map(static fn (array $c): int => $c['activity']['partnerships_last_year'], $competitors),
    ],
];

sendJsonResponse([
    'business'      => [
        'id'       => (int) $businessRow['id'],
        'name'     => $businessRow['name'],
        'currency' => $currency,
    ],
    'as_of'         => $today->format('Y-m-d'),
    'windows'       => [
        'last_30_days_from' => $from30,
        'last_90_days_from' => $from90,
        'last_year_from'    => $fromYear,
    ],
    'methodology'   => [
        'type'              => 'descriptive',
        'note'              => 'Based on recorded history only. Trajectories describe past price movement and are not forecasts.',
        'trajectory_rule'   => sprintf(
            'Net change from the first to the latest recorded price: above +%1$s%% INCREASING, below -%1$s%% DECREASING, otherwise STABLE; fewer than two recorded prices is INSUFFICIENT_DATA. Competitor and market trajectories use the average product net change.',
            COMP_TRAJECTORY_THRESHOLD + 0
        ),
        'price_stats_scope' => 'Active products priced in the business currency.',
    ],
    'summary'       => $summary,
    'competitors'   => $competitors,
    'market_events' => $events,
    'charts'        => $charts,
    'generated_at'  => gmdate('Y-m-d H:i:s'),
]);

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

/** $a - $b for money, computed in cents so 5.99 - 7.99 is exactly -2.0. */
function compMoneyDiff(float $a, float $b): float
{
    return (round($a * 100) - round($b * 100)) / 100;
}

/** Net % change from the first to the latest price. */
function compNetChange(float $first, float $latest): float
{
    $pct = calculatePercentageChange($first, $latest);
    if ($pct === null) {
        // Undefined from 0: treat any positive price as an increase, 0 -> 0 as none.
        return $latest > 0 ? 100.0 : 0.0;
    }
    return $pct;
}

/** Map a net % change (null = fewer than two prices) to a trajectory label. */
function compTrajectory(?float $netChange): string
{
    if ($netChange === null) {
        return 'INSUFFICIENT_DATA';
    }
    if ($netChange > COMP_TRAJECTORY_THRESHOLD) {
        return 'INCREASING';
    }
    if ($netChange < -COMP_TRAJECTORY_THRESHOLD) {
        return 'DECREASING';
    }
    return 'STABLE';
}

/**
 * Price stats and trajectory for a set of products.
 * avg/min/max: active products in $currency. Trajectory: average net change
 * of the products that have at least two recorded prices.
 */
function compPricingSummary(array $products, string $currency): array
{
    $priced        = array_values(array_filter($products, static fn (array $p): bool => $p['active'] && $p['currency'] === $currency));
    $otherCurrency = count(array_filter($products, static fn (array $p): bool => $p['active'] && $p['currency'] !== $currency));

    $cheapest = null;
    $priciest = null;
    $sumCents = 0;
    foreach ($priced as $p) {
        $sumCents += (int) round($p['current_price'] * 100);
        if ($cheapest === null || $p['current_price'] < $cheapest['current_price']) {
            $cheapest = $p;
        }
        if ($priciest === null || $p['current_price'] > $priciest['current_price']) {
            $priciest = $p;
        }
    }

    $netChanges = array_values(array_filter(
        array_column($products, 'net_change_percentage'),
        static fn ($v): bool => $v !== null
    ));
    $avgNet = $netChanges === [] ? null : round(array_sum($netChanges) / count($netChanges), 2);

    $ref = static fn (?array $p): ?array => $p === null ? null : [
        'product_id'    => $p['id'],
        'competitor_id' => $p['competitor_id'],
        'name'          => $p['name'],
        'price'         => $p['current_price'],
    ];

    return [
        'product_count'                 => count($products),
        'priced_product_count'          => count($priced),
        'other_currency_product_count'  => $otherCurrency,
        'average_price'                 => $priced === [] ? null : round($sumCents / count($priced) / 100, 2),
        'min_price'                     => $cheapest['current_price'] ?? null,
        'max_price'                     => $priciest['current_price'] ?? null,
        'cheapest_product'              => $ref($cheapest),
        'most_expensive_product'        => $ref($priciest),
        'products_with_history'         => count($netChanges),
        'average_net_change_percentage' => $avgNet,
        'pricing_trajectory'            => compTrajectory($avgNet),
    ];
}
