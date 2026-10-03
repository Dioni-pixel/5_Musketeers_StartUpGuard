// StartupGuard - benchmark companies section (Competitors and Market pages)
//
// Shows the large public companies from api/benchmark-companies.php in their
// own section, separate from the local competitors: they are reference
// points for margins and growth, not rivals, and never enter the competitor
// counts, price statistics or threat levels. Every number is calculated in
// PHP (api/benchmarks.php); this file only formats it.
//
// Runs on its own when the page has <section id="benchmarks">. The page's
// data-page attribute picks the view: "competitors" = latest-quarter table,
// "market" = net margin chart + trend list.

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('benchmarks');
  if (!root) return;
  const body = root.querySelector('[data-benchmarks-body]');
  body.replaceChildren(skeleton(200));

  try {
    const data = await apiGet('benchmark-companies.php', { business_id: getBusinessId() });
    if (document.body.dataset.page === 'market') renderBenchmarkTrends(body, data);
    else renderBenchmarkTable(body, data);
  } catch (error) {
    showErrorIn(body, error, 'Could not load the benchmark companies');
  }
});

const BM_TREND = { IMPROVING: ['low', 'Improving'], WEAKENING: ['high', 'Weakening'], STABLE: ['neutral', 'Stable'], INSUFFICIENT_DATA: ['neutral', 'Not reported'] };

function bmPercent(value) {
  return value === null || value === undefined ? '—' : `${Number(value).toFixed(1)}%`;
}

function bmPoints(value) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(1)} pts`;
}

function bmSource(data) {
  const b = data.benchmarks;
  return el('p', { class: 'muted small', style: 'margin-top:12px;line-height:1.5',
    text: `Source: ${b.source || 'SEC filings'}, ${b.generated}. Figures in USD; fiscal years differ per company. Financial figures only, no business decisions. These companies are benchmarks, not competitors.` });
}

/** Competitors page: one row per company, latest quarter. */
function renderBenchmarkTable(body, data) {
  const ours = data.business;
  const rows = data.benchmarks.companies.map((c) => {
    const q = c.quarters[c.quarters.length - 1];
    const vs = data.benchmarks.comparison.by_company.find((r) => r.company === c.name);
    const opMargin = q.operating_margin !== null ? bmPercent(q.operating_margin)
      : q.pretax_margin !== null ? `${bmPercent(q.pretax_margin)} pretax` : '—';
    return el('tr', {},
      el('th', { scope: 'row' }, el('p', { text: c.name }), el('p', { class: 'muted small', style: 'font-weight:400', text: [c.ticker, c.sector].filter(Boolean).join(' · ') })),
      el('td', {}, el('p', { text: `${q.quarter} FY${c.fiscal_year}` }), el('p', { class: 'muted small', text: `ended ${dayLabel(q.period_end, true)}` })),
      el('td', { class: 'num' }, el('p', { text: q.revenue_usd_billions !== null ? `$${q.revenue_usd_billions.toFixed(1)}B` : '—' })),
      el('td', {}, q.revenue_growth_vs_previous_quarter !== null
        ? changePill(q.revenue_growth_vs_previous_quarter, true)
        : el('span', { class: 'muted small', text: 'First quarter' })),
      el('td', { class: 'num', text: bmPercent(q.gross_margin) }),
      el('td', { class: 'num', text: opMargin }),
      el('td', { class: 'num', style: 'font-weight:500', text: bmPercent(q.net_margin) }),
      el('td', { class: 'num', text: vs ? bmPoints(vs.our_margin_minus_theirs_points) : '—' }));
  });

  body.replaceChildren(
    el('p', { class: 'muted small', style: 'padding:0 20px 12px', text: ours.profit_margin !== null
      ? `${ours.name}'s latest profit margin: ${bmPercent(ours.profit_margin)} (${monthLabel(ours.period, true)}). The last column is ${ours.name}'s margin minus theirs.`
      : `${ours.name} has no profit margin yet, so there is nothing to compare.` }),
    el('div', { class: 'table-wrap' }, el('table', { class: 'data', style: 'min-width:900px' },
      el('thead', {}, el('tr', {},
        el('th', { scope: 'col', text: 'Company' }),
        el('th', { scope: 'col', text: 'Latest Quarter' }),
        el('th', { scope: 'col', class: 'num', text: 'Revenue' }),
        el('th', { scope: 'col', text: 'vs Previous Quarter' }),
        el('th', { scope: 'col', class: 'num', text: 'Gross Margin' }),
        el('th', { scope: 'col', class: 'num', text: 'Operating Margin' }),
        el('th', { scope: 'col', class: 'num', text: 'Net Margin' }),
        el('th', { scope: 'col', class: 'num', text: `${ours.name} vs Them` }))),
      el('tbody', {}, rows))),
    el('div', { style: 'padding:0 20px 20px' }, bmSource(data)));
}

/** Market page: latest net margin chart (with the business) and each company's trend this fiscal year. */
function renderBenchmarkTrends(body, data) {
  const ours = data.business;
  const cmp = data.benchmarks.comparison;
  const bars = cmp.by_company.filter((r) => r.net_margin !== null).map((r) => ({ label: r.company, value: r.net_margin, ours: false }));
  if (ours.profit_margin !== null) bars.push({ label: ours.name, value: ours.profit_margin, ours: true });
  bars.sort((a, b) => b.value - a.value);

  const canvas = el('canvas', { role: 'img', 'aria-label': `Bar chart of net margin: ${bars.map((b) => `${b.label} ${bmPercent(b.value)}`).join(', ')}` });

  const list = el('ul', { class: 'stack', style: 'gap:0' }, data.benchmarks.companies.map((c) => {
    const p = c.period;
    const [level, text] = BM_TREND[p.operating_margin_trend] || BM_TREND.INSUFFICIENT_DATA;
    return el('li', { class: 'list-row', style: 'padding:12px 0;border-top:1px solid var(--border)' },
      el('div', { class: 'main' },
        el('p', { class: 'title', text: c.name }),
        el('p', { class: 'sub', text: `${p.quarters_reported} quarter${p.quarters_reported === 1 ? '' : 's'} of FY${c.fiscal_year} · revenue $${p.revenue_usd_billions.toFixed(1)}B · net margin ${bmPercent(p.net_margin)} (${bmPoints(p.net_margin_change_first_to_latest_quarter_points)} first to latest quarter)` })),
      el('div', { class: 'side' },
        p.revenue_change_first_to_latest_quarter !== null
          ? el('span', { class: 'row', style: 'gap:6px' }, el('span', { class: 'muted small', text: 'Revenue' }), changePill(p.revenue_change_first_to_latest_quarter, true))
          : el('span', { class: 'muted small', text: 'One quarter only' }),
        el('span', { class: 'row', style: 'gap:6px' }, el('span', { class: 'muted small', text: 'Operating margin' }), badge(level, text))));
  }));

  body.replaceChildren(
    el('div', { class: 'grid grid-xl-3' },
      el('div', { class: 'xl-span-2' },
        el('p', { class: 'muted small', style: 'margin-bottom:8px', text: cmp.benchmark_median_net_margin !== null && ours.profit_margin !== null
          ? `Net margin, latest quarter. Median of the five: ${bmPercent(cmp.benchmark_median_net_margin)}; ${ours.name} (${monthLabel(ours.period, true)}): ${bmPercent(ours.profit_margin)}, ${bmPoints(cmp.our_margin_minus_median_points)} versus the median.`
          : 'Net margin, latest quarter.' }),
        el('div', { class: 'chart-box h256' }, canvas)),
      el('div', {}, el('p', { class: 'muted small', style: 'margin-bottom:8px', text: 'Change from the first to the latest quarter of this fiscal year' }), list)),
    bmSource(data));

  drawChart('benchmarks', canvas, {
    type: 'bar',
    data: {
      labels: bars.map((b) => b.label),
      datasets: [{
        data: bars.map((b) => b.value),
        backgroundColor: bars.map((b) => (b.ours ? cssVar('--chart-5') : b.value < 0 ? cssVar('--chart-2') : cssVar('--chart-1'))),
        borderRadius: 4,
        maxBarThickness: 28,
      }],
    },
    options: {
      indexAxis: 'y',
      scales: {
        x: { grid: { color: cssVar('--chart-grid') }, border: { display: false }, ticks: { callback: (v) => `${v}%` } },
        y: { grid: { display: false }, border: { display: false } },
      },
      plugins: { tooltip: { callbacks: { label: (ctx) => ` Net margin ${bmPercent(ctx.parsed.x)}` } } },
      interaction: { mode: 'nearest', axis: 'y', intersect: false },
    },
  });
}
