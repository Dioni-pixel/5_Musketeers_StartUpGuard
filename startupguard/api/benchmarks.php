<?php
// StartupGuard - benchmark companies for the AI analysis
//
// Reads data/benchmark-companies.json (quarterly SEC figures for a few large
// public companies) and turns it into margins and growth rates, calculated
// here in PHP, so the AI can compare trends without doing any maths.
//
// These companies are reference points, not competitors: they are many
// times bigger than the business being analysed, so only percentages are
// worth comparing. The file holds financial figures only, no business
// decisions.
//
// Used by analyze.php. Not an endpoint: it sends nothing by itself.

declare(strict_types=1);

require_once __DIR__ . '/helpers.php';

const BM_FILE = __DIR__ . '/../data/benchmark-companies.json';

/**
 * Benchmark section for the AI context, or null when the file is missing or
 * unreadable (the analysis then runs without it).
 *
 * @param float|null $ourProfitMargin the business's latest monthly profit margin (%)
 */
function bmBenchmarks(?float $ourProfitMargin, string $file = BM_FILE): ?array
{
    if (!is_file($file)) {
        return null;
    }
    $data = json_decode((string) file_get_contents($file), true);
    if (!is_array($data) || !is_array($data['companies'] ?? null)) {
        error_log("StartupGuard benchmarks: $file is not valid benchmark JSON, skipped.");
        return null;
    }

    $companies = [];
    foreach ($data['companies'] as $c) {
        if (!is_array($c) || !is_array($c['quarters'] ?? null) || $c['quarters'] === []) {
            continue;
        }
        $companies[] = bmCompany($c);
    }
    if ($companies === []) {
        return null;
    }

    return [
        'source'        => (string) ($data['source'] ?? ''),
        'generated'     => (string) ($data['generated'] ?? ''),
        'currency'      => 'USD',
        'companies'     => $companies,
        'comparison'    => bmComparison($companies, $ourProfitMargin),
    ];
}

/** One company: per-quarter margins and growth, plus period totals. */
function bmCompany(array $c): array
{
    $quarters = [];
    $prevRevenue = null;
    foreach ($c['quarters'] as $q) {
        $revenue = bmNum($q['revenue'] ?? null);
        $quarters[] = [
            'quarter'                    => (string) ($q['quarter'] ?? ''),
            'period_start'               => (string) ($q['period_start'] ?? ''),
            'period_end'                 => (string) ($q['period_end'] ?? ''),
            'revenue_usd_billions'       => $revenue === null ? null : round($revenue / 1e9, 2),
            'revenue_growth_vs_previous_quarter' => ($prevRevenue === null || $revenue === null)
                ? null
                : calculatePercentageChange($prevRevenue, $revenue),
            'gross_margin'               => bmShare($q['gross_profit'] ?? null, $revenue),
            'operating_margin'           => bmShare($q['operating_income'] ?? null, $revenue),
            'pretax_margin'              => bmShare($q['pretax_income'] ?? null, $revenue),
            'net_margin'                 => bmShare($q['net_income'] ?? null, $revenue),
            'rnd_share_of_revenue'       => bmShare($q['research_and_development'] ?? null, $revenue),
            'operating_cash_flow_margin' => bmShare($q['operating_cash_flow'] ?? null, $revenue),
            'liabilities_to_assets'      => bmShare($q['total_liabilities'] ?? null, bmNum($q['total_assets'] ?? null)),
        ];
        $prevRevenue = $revenue;
    }

    // Totals over the quarters in the file (the same span as year_to_date).
    $sum = static function (string $field) use ($c): ?float {
        $total = 0.0;
        foreach ($c['quarters'] as $q) {
            $v = bmNum($q[$field] ?? null);
            if ($v === null) {
                return null;
            }
            $total += $v;
        }
        return $total;
    };
    $revenue = $sum('revenue');

    $first = $quarters[0];
    $last  = $quarters[count($quarters) - 1];

    $netMargins = array_values(array_filter(array_column($quarters, 'net_margin'), 'is_float'));

    return [
        'name'           => (string) ($c['name'] ?? ''),
        'ticker'         => (string) ($c['ticker'] ?? ''),
        'sector'         => (string) ($c['sector'] ?? ''),
        'fiscal_year'    => $c['fiscal_year'] ?? null,
        'status'         => (string) ($c['status'] ?? ''),
        'period_covered' => $c['period_covered'] ?? null,
        'data_notes'     => array_values(array_map('strval', (array) ($c['notes'] ?? []))),
        'quarters'       => $quarters,
        'period'         => [
            'quarters_reported'                   => count($quarters),
            'revenue_usd_billions'                => $revenue === null ? null : round($revenue / 1e9, 2),
            'revenue_change_first_to_latest_quarter' => ($first['revenue_usd_billions'] === null || $last['revenue_usd_billions'] === null || count($quarters) < 2)
                ? null
                : calculatePercentageChange(bmNum($c['quarters'][0]['revenue']), bmNum($c['quarters'][count($c['quarters']) - 1]['revenue'])),
            'gross_margin'                        => bmShare($sum('gross_profit'), $revenue),
            'operating_margin'                    => bmShare($sum('operating_income'), $revenue),
            'pretax_margin'                       => bmShare($sum('pretax_income'), $revenue),
            'net_margin'                          => bmShare($sum('net_income'), $revenue),
            'rnd_share_of_revenue'                => bmShare($sum('research_and_development'), $revenue),
            'operating_cash_flow_margin'          => bmShare($sum('operating_cash_flow'), $revenue),
            'net_margin_change_first_to_latest_quarter_points' => (count($netMargins) >= 2)
                ? round($netMargins[count($netMargins) - 1] - $netMargins[0], 2)
                : null,
            'operating_margin_trend'              => bmTrend($first['operating_margin'], $last['operating_margin']),
        ],
    ];
}

/** The business's latest profit margin next to each company's latest-quarter net margin. */
function bmComparison(array $companies, ?float $ourProfitMargin): array
{
    $rows = [];
    $margins = [];
    foreach ($companies as $c) {
        $last = $c['quarters'][count($c['quarters']) - 1];
        $m = $last['net_margin'];
        if ($m !== null) {
            $margins[] = $m;
        }
        $rows[] = [
            'company'                         => $c['name'],
            'latest_quarter'                  => $last['quarter'] . ' ending ' . $last['period_end'],
            'net_margin'                      => $m,
            'our_margin_minus_theirs_points'  => ($m === null || $ourProfitMargin === null) ? null : round($ourProfitMargin - $m, 2),
        ];
    }

    $median = null;
    if ($margins !== []) {
        sort($margins);
        $n = count($margins);
        $median = round($n % 2 ? $margins[intdiv($n, 2)] : ($margins[$n / 2 - 1] + $margins[$n / 2]) / 2, 2);
    }

    return [
        'our_latest_profit_margin'               => $ourProfitMargin,
        'benchmark_median_net_margin'            => $median,
        'our_margin_minus_median_points'         => ($median === null || $ourProfitMargin === null) ? null : round($ourProfitMargin - $median, 2),
        'by_company'                             => $rows,
    ];
}

/** $part / $whole * 100, rounded; null when either is missing or $whole is 0. */
function bmShare(mixed $part, mixed $whole): ?float
{
    $part  = bmNum($part);
    $whole = bmNum($whole);
    if ($part === null || $whole === null || $whole == 0.0) {
        return null;
    }
    return round($part / $whole * 100, 2);
}

/** Change in percentage points: above +1 IMPROVING, below -1 WEAKENING, otherwise STABLE. */
function bmTrend(?float $from, ?float $to): string
{
    if ($from === null || $to === null) {
        return 'INSUFFICIENT_DATA';
    }
    $diff = $to - $from;
    return $diff > 1 ? 'IMPROVING' : ($diff < -1 ? 'WEAKENING' : 'STABLE');
}

function bmNum(mixed $v): ?float
{
    return is_int($v) || is_float($v) ? (float) $v : null;
}
