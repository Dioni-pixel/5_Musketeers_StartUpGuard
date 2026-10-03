<?php
// StartupGuard - benchmark companies endpoint
//
// GET /api/benchmark-companies.php?business_id=1
//
// The large public companies in data/benchmark-companies.json with the
// margins and growth rates calculated by benchmarks.php (the same numbers
// the AI analysis gets), plus the business's latest monthly profit margin
// for comparison. These companies are reference points, not competitors:
// they are kept out of competitors.php and its price and threat figures.
//
// 200 {business: {id, name, profit_margin, period}, benchmarks: {...}}
// 404 BENCHMARKS_NOT_FOUND when the data file is missing or unreadable.

declare(strict_types=1);

require_once __DIR__ . '/db.php';
require_once __DIR__ . '/benchmarks.php';

requireMethod('GET');

if (!isset($_GET['business_id'])) {
    sendError('VALIDATION_ERROR', 'business_id is required.', 400);
}
$businessId = validatePositiveInteger($_GET['business_id'], 'business_id');

$pdo = getDB();

$stmt = $pdo->prepare('SELECT id, name FROM businesses WHERE id = :id');
$stmt->execute(['id' => $businessId]);
$business = $stmt->fetch();
if ($business === false) {
    sendError('BUSINESS_NOT_FOUND', sprintf('Business %d was not found.', $businessId), 404);
}

$stmt = $pdo->prepare(
    'SELECT record_date, revenue, expenses FROM financial_records
      WHERE business_id = :business_id ORDER BY record_date DESC LIMIT 1'
);
$stmt->execute(['business_id' => $businessId]);
$latest = $stmt->fetch();
$margin = $latest === false ? null : calculateProfitMargin($latest['revenue'], $latest['expenses']);

$benchmarks = bmBenchmarks($margin);
if ($benchmarks === null) {
    sendError('BENCHMARKS_NOT_FOUND', 'No benchmark data. Put data/benchmark-companies.json in the project folder.', 404);
}

sendJsonResponse([
    'business'   => [
        'id'            => (int) $business['id'],
        'name'          => $business['name'],
        'profit_margin' => $margin,
        'period'        => $latest === false ? null : $latest['record_date'],
    ],
    'benchmarks' => $benchmarks,
]);
