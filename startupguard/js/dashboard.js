// StartupGuard - dashboard page script (StartupGuard AI design)
//
// Loads api/dashboard.php, api/competitors.php and api/decisions.php in
// parallel. Every number shown comes from those responses; this file only
// picks, formats and draws them. AI reviews go through api/analyze.php.
//
// The top of the page keeps the Phase 13 live-demo order:
//   1 Business health, 2 Competitor signals (A/B/C),
//   3 Decision under review, 4 AI risk review.
// Charts and lists sit below the "Supporting data" divider.

const state = {
  businessId: 1,
  dashboard: null,
  competitors: null,
  decisions: null,
  spotlight: null,        // pending decision shown under "Decision under review"
  pricingProductId: null, // own product picked in "Your Pricing vs Market"
};

document.addEventListener('DOMContentLoaded', () => {
  state.businessId = getBusinessId();
  setupChartDefaults();
  document.getElementById('analysis-run').addEventListener('click', () => startAnalysis({ scroll: true }));
  loadAll();
});

// ---------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------

async function loadAll() {
  document.getElementById('kpis').replaceChildren(...[1, 2, 3, 4].map(() => el('div', { class: 'card stat' }, skeleton(86))));
  ['health-checks', 'signals', 'pricing-vs', 'spotlight', 'analysis', 'price-changes', 'events', 'decisions']
    .forEach((id) => document.getElementById(id).replaceChildren(skeleton(140)));

  const [dash, comp, dec] = await Promise.allSettled([
    StartupGuardAPI.getDashboard(state.businessId),
    StartupGuardAPI.getCompetitors(state.businessId),
    StartupGuardAPI.getDecisions(state.businessId),
  ]);

  // Each section renders on its own, so one failing endpoint does not blank the page.
  guard(dash, ['kpis', 'events'], 'Could not load the dashboard', (data) => {
    state.dashboard = data;
    setCurrency(data.metrics.currency || data.business.currency);
    setBusiness(data.business);
    renderHeader(data);
    renderKpis(data);
    renderTrendChart(data);
    renderEvents(data);
  });

  guard(comp, ['signals', 'price-changes'], 'Could not load competitors', (data) => {
    state.competitors = data;
    renderSignals(data);
    priceHistoryChart(data, { canvas: 'history-chart', legend: 'history-legend', filter: 'history-filter', mode: 'history-mode', sub: 'history-sub' });
    renderPriceChanges(data);
  });

  guard(dec, ['spotlight', 'decisions'], 'Could not load decisions', (data) => {
    state.decisions = data;
    renderSpotlight(data);
    renderDecisions(data);
  });

  if (dash.status === 'fulfilled' && comp.status === 'fulfilled') {
    guard(dash, ['pricing-vs'], 'Could not compare prices', renderPricingVs);
  } else {
    showErrorIn(document.getElementById('pricing-vs'), (dash.reason || comp.reason), 'Could not compare prices');
  }

  // After decisions, so a decision review can name its decision.
  guard(dash, ['analysis'], 'Could not show the AI review', renderLatestAnalysis);
  renderHealthChecks();
}

function guard(result, containerIds, context, render) {
  const fail = (error) => containerIds.forEach((id) => showErrorIn(document.getElementById(id), error, context));
  if (result.status === 'rejected') return fail(result.reason);
  try {
    render(result.value);
  } catch (error) {
    fail(error);
  }
}

// ---------------------------------------------------------------------
// 1. Business health
// ---------------------------------------------------------------------

function renderHeader(data) {
  const b = data.business;
  document.title = `${b.name} · StartupGuard AI`;
  document.getElementById('health-period').textContent = data.metrics.period
    ? `Latest month: ${monthLabel(data.metrics.period, true)}`
    : 'No financial records yet';
  document.getElementById('generated-at').textContent =
    `${b.name} · data as of ${data.generated_at} UTC. Numbers are calculated by the server from the business's records; the AI review is written by Claude from those numbers.`;
}

function renderKpis(data) {
  const m = data.metrics;
  const hasRecords = Boolean(m.period);
  const runway = runwayStatus(m.runway_months);
  const vsLast = (value, goodWhenUp) => (value === null || value === undefined
    ? [el('span', { text: 'No previous month' })]
    : [changePill(value, goodWhenUp), el('span', { text: 'vs last month' })]);

  document.getElementById('kpis').replaceChildren(
    statCard({ label: 'Monthly Revenue', value: money0(m.revenue), iconName: 'euro', foot: vsLast(m.revenue_growth, true) }),
    statCard({ label: 'Monthly Expenses', value: money0(m.expenses), iconName: 'receipt', tone: 'tone-red', foot: vsLast(m.expense_growth, false) }),
    statCard({
      label: 'Cash Balance', value: money0(m.cash_balance), iconName: 'piggy-bank', tone: 'tone-green',
      foot: hasRecords
        ? [el('span', { class: m.profit < 0 ? 'text-red' : 'text-green', text: `${signedMoney(m.profit)} profit` }), el('span', { text: `this month (${pct(m.profit_margin)} margin)` })]
        : [el('span', { text: 'Current balance' })],
    }),
    statCard({
      label: 'Runway',
      value: !hasRecords ? '—' : m.runway_months === null ? 'Not burning' : `${Number(m.runway_months).toFixed(1)} months`,
      iconName: 'hourglass', tone: 'tone-purple',
      foot: !hasRecords ? [badge('neutral', 'No data')]
        : m.monthly_burn > 0 ? [badge(runway.level, runway.label), el('span', { text: `At ${money0(m.monthly_burn)} / mo burn` })]
          : [badge('low', 'Not burning cash')],
    }),
  );
  renderHealthInsight(data);
}

/**
 * One line under the tiles: what looks fine on the surface and what is
 * changing underneath, from the first and latest financial records.
 */
function renderHealthInsight(data) {
  const box = document.getElementById('health-insight');
  const history = data.financial_history || [];
  const m = data.metrics;
  box.hidden = true;
  if (history.length < 2 || !m.period) return;

  const first = history[0];
  const last = history[history.length - 1];
  const growth = (a, b) => (a > 0 ? ((b / a) - 1) * 100 : null);
  const revenueGrowth = growth(first.revenue, last.revenue);
  const expenseGrowth = growth(first.expenses, last.expenses);
  const lossWidened = last.profit < 0 && last.profit < first.profit;
  const costsFaster = revenueGrowth !== null && expenseGrowth !== null && expenseGrowth > revenueGrowth;
  if (!lossWidened && !costsFaster) return;

  const since = new Date(`${first.record_date.slice(0, 10)}T00:00:00Z`)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const runway = runwayStatus(m.runway_months);
  const parts = [];
  if (lossWidened) parts.push(`the monthly loss grew from ${money0(Math.abs(first.profit))} to ${money0(Math.abs(last.profit))} since ${since}`);
  if (costsFaster) parts.push(`expenses rose ${pct(expenseGrowth, 0)} while revenue rose ${pct(revenueGrowth, 0)}`);

  box.replaceChildren(
    el('span', { class: 'chip-icon tone-amber' }, icon('triangle-alert')),
    el('div', {},
      el('span', { class: 'label', text: 'Hidden risk' }),
      runway.level === 'low' && m.runway_months !== null
        ? el('strong', { text: `On the surface, ${monthsLong(m.runway_months)} of runway looks healthy. ` })
        : null,
      `Underneath, ${parts.join(', and ')}.`));
  box.hidden = false;
}

function renderTrendChart(data) {
  const history = data.financial_history || [];
  const blue = cssVar('--chart-1');
  const red = cssVar('--chart-2');
  document.getElementById('trend-legend').replaceChildren(legendList([{ label: 'Revenue', color: blue }, { label: 'Expenses', color: red }]));
  document.getElementById('trend-sub').textContent = history.length
    ? `Monthly, ${monthLabel(history[0].record_date, true)} to ${monthLabel(history[history.length - 1].record_date, true)}`
    : 'No financial records yet';

  const area = (label, key, color, alpha) => ({
    label,
    data: history.map((r) => r[key]),
    borderColor: color,
    backgroundColor: areaGradient(color, alpha),
    fill: true,
    borderWidth: 2.25,
    tension: 0.35,
    pointRadius: 0,
    pointHoverRadius: 4,
    pointHoverBackgroundColor: color,
  });

  drawChart('trend', document.getElementById('trend-chart'), {
    type: 'line',
    data: {
      labels: history.map((r) => monthLabel(r.record_date)),
      datasets: [area('Revenue', 'revenue', blue, 0.22), area('Expenses', 'expenses', red, 0.12)],
    },
    options: {
      scales: axes({ yFormat: kMoney }),
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${money0(ctx.parsed.y)}`,
            footer: (items) => {
              const r = history[items[0].dataIndex];
              return `Profit ${signedMoney(r.profit)} (${pct(r.profit_margin)} margin)`;
            },
          },
        },
      },
    },
  });
}

/** Startup Health card: fixed-threshold checks on API numbers, plus the latest AI rating. */
function renderHealthChecks() {
  const root = document.getElementById('health-checks');
  const checks = [];
  const add = (level, label, what, why) => checks.push({ level, label, what, why });

  const dash = state.dashboard;
  if (dash) {
    const m = dash.metrics;
    if (!m.period) {
      add('neutral', 'No data', 'Cash runway', 'No financial records yet.');
    } else {
      const r = runwayStatus(m.runway_months);
      add(r.level, r.label, 'Cash runway',
        m.runway_months === null ? 'Revenue covers expenses this month.'
          : `${months(m.runway_months)} at ${money0(m.monthly_burn)}/mo burn. Under ${RUNWAY_THRESHOLDS.medium} months is flagged.`);
    }
    if (m.profit_margin !== null) {
      const level = m.profit_margin < 0 ? 'high' : m.profit_margin < 10 ? 'medium' : 'low';
      add(level, m.profit_margin < 0 ? 'Loss' : m.profit_margin < 10 ? 'Thin' : 'Healthy', 'Profitability',
        `${pct(m.profit_margin)} profit margin in the latest month.`);
    }
    if (m.revenue_growth !== null && m.expense_growth !== null) {
      const worse = m.expense_growth > m.revenue_growth;
      add(worse ? 'medium' : 'low', worse ? 'Costs faster' : 'On track', 'Costs vs revenue',
        `Expenses ${pct(m.expense_growth)} vs revenue ${pct(m.revenue_growth)} month over month.`);
    }
    const t = dash.competitors.by_threat_level;
    add(t.critical ? 'critical' : t.high ? 'high' : t.medium ? 'medium' : 'low',
      t.critical ? `${t.critical} critical` : t.high ? `${t.high} high` : t.medium ? `${t.medium} medium` : 'Low',
      'Competitive threat', `${dash.competitors.total} competitors tracked: ${t.high} high, ${t.medium} medium threat.`);
  }
  if (state.competitors) {
    const cuts = state.competitors.competitors.flatMap((c) => c.products)
      .filter((p) => p.price_change < 0 && p.last_price_change_at && p.last_price_change_at.slice(0, 10) >= state.competitors.windows.last_90_days_from);
    add(cuts.length ? 'medium' : 'low', cuts.length ? `${cuts.length} cut${cuts.length === 1 ? '' : 's'}` : 'None', 'Price cuts, 90 days',
      cuts.length ? cuts.map((p) => `${p.name} ${pct(p.price_change_percentage)}`).join(', ') : 'No competitor lowered a price.');
  }

  if (!checks.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No data to check yet.' }));
    return;
  }

  const flagged = checks.filter((c) => LEVEL_ORDER[c.level] >= LEVEL_ORDER.medium).length;
  const worst = worstLevel(checks.map((c) => c.level));
  document.getElementById('health-badge').replaceChildren(badge(worst, worst === 'neutral' ? 'No data' : worst));

  const latest = dash && dash.latest_ai_analysis;
  root.replaceChildren(
    el('div', { class: 'row', style: 'align-items:flex-end' },
      el('span', { style: 'font-size:36px;font-weight:600;letter-spacing:-0.02em;line-height:1', class: 'tabular', text: String(flagged) }),
      el('span', { class: 'muted', style: 'padding-bottom:2px', text: `of ${checks.length} checks need attention` })),
    el('ul', { class: 'check-list' }, checks.map((c) => el('li', {},
      el('div', {}, el('span', { class: 'what', text: c.what }), el('span', { class: 'why', text: c.why })),
      badge(c.level, c.label)))),
    el('div', { class: 'risk-strip' },
      el('span', { text: 'AI overall risk' }),
      latest && latest.risk_level ? badge(levelOf(latest.risk_level), latest.risk_level) : el('span', { class: 'muted small', text: 'Not reviewed yet' })),
  );
}

// ---------------------------------------------------------------------
// 2. Competitor signals and pricing
// ---------------------------------------------------------------------

// One signal per kind of move. Price cuts come from the recorded price history
// (a product whose latest change was a cut), joined to the same-day
// PRICE_CHANGE event when there is one. Expansions and partnerships are market
// events. Within a kind the most important, then most recent, wins; a
// competitor already shown is skipped when another exists, so the three
// signals name different competitors.
const SIGNAL_KINDS = [
  { key: 'price', label: 'Lowered prices', icon: 'tag', level: 'high' },
  { key: 'EXPANSION', label: 'New location', icon: 'map-pin', level: 'high' },
  { key: 'PARTNERSHIP', label: 'Partnership', icon: 'handshake', level: 'medium' },
];

function signalCandidates(data, kind) {
  const byImportanceThenDate = (a, b) => (b.importance - a.importance) || b.date.localeCompare(a.date);
  if (kind.key === 'price') {
    return data.competitors.flatMap((c) => c.products
      .filter((p) => p.price_change !== null && p.price_change < 0 && p.last_price_change_at)
      .map((p) => {
        const day = p.last_price_change_at.slice(0, 10);
        const event = data.market_events.find((e) => e.competitor_id === c.id && e.event_type === 'PRICE_CHANGE' && e.event_date === day);
        return { competitorId: c.id, competitorName: c.name, product: p, event, date: day, importance: event ? event.importance_score : 0 };
      }))
      .sort(byImportanceThenDate);
  }
  return data.market_events
    .filter((e) => e.event_type === kind.key)
    .map((e) => ({ competitorId: e.competitor_id, competitorName: e.competitor_name, event: e, date: e.event_date, importance: e.importance_score }))
    .sort(byImportanceThenDate);
}

function renderSignals(data) {
  const root = document.getElementById('signals');
  const used = new Set();
  const picks = [];
  for (const kind of SIGNAL_KINDS) {
    const candidates = signalCandidates(data, kind);
    const pick = candidates.find((c) => !used.has(c.competitorId)) || candidates[0];
    if (!pick) continue;
    used.add(pick.competitorId);
    picks.push({ kind, ...pick });
  }

  if (!picks.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No competitor price cuts, expansions or partnerships recorded yet.' }));
    return;
  }

  root.replaceChildren(el('ul', { class: 'divided' }, picks.map((s, i) => {
    const p = s.product;
    const detail = p
      ? el('p', { class: 'price-move' },
        el('span', { class: 'muted', text: `${p.name}: ${money(p.previous_price, p.currency)} →` }),
        el('strong', { text: money(p.current_price, p.currency) }),
        changePill(p.price_change_percentage, true))
      : el('p', { class: 'sub', text: s.event.description || '' });
    return el('li', { class: 'list-row', style: 'align-items:flex-start' },
      el('span', { class: `chip-icon lg ${s.kind.level === 'high' ? 'tone-red' : 'tone-amber'}` }, icon(s.kind.icon)),
      el('div', { class: 'main' },
        el('p', { class: 'signal-letter', text: `Competitor ${String.fromCharCode(65 + i)} · ${s.competitorName}` }),
        el('p', { class: 'title', text: s.event ? s.event.title : `${p.name} price cut` }),
        detail),
      el('div', { class: 'side' },
        badge(s.kind.level, s.kind.label),
        el('span', { class: 'muted small', text: dayLabel(s.date) }),
        s.importance ? el('span', { class: 'muted small', text: `Importance ${s.importance}/10` }) : null));
  })));
}

/**
 * Own product vs competitor products in the same category. No market average:
 * a category can mix monthly and annual plans (each description says which).
 */
function renderPricingVs(data) {
  const root = document.getElementById('pricing-vs');
  const own = (data.product_list || []);
  const competitorProducts = state.competitors.competitors.flatMap((c) =>
    c.products.filter((p) => p.active && p.current_price !== null).map((p) => ({ ...p, competitor_name: c.name })));
  const sameCategory = (product) => competitorProducts.filter((p) => p.category === product.category && p.currency === product.currency);
  const comparable = own.filter((p) => sameCategory(p).length);

  if (!comparable.length) {
    root.replaceChildren(el('p', { class: 'empty', text: own.length
      ? 'No competitor product is recorded in the same category as your products.'
      : 'No products recorded for this business yet.' }));
    return;
  }
  if (!comparable.some((p) => p.id === state.pricingProductId)) {
    // Default: the category with the most competitor products.
    state.pricingProductId = comparable.slice().sort((a, b) => sameCategory(b).length - sameCategory(a).length)[0].id;
  }
  const product = comparable.find((p) => p.id === state.pricingProductId);
  const rivals = sameCategory(product).sort((a, b) => a.current_price - b.current_price);
  const cheapest = rivals[0];
  const diff = ((product.price - cheapest.current_price) / cheapest.current_price) * 100;
  const maxPrice = Math.max(product.price, ...rivals.map((r) => r.current_price));

  const picker = el('div', { class: 'chips', role: 'group', 'aria-label': 'Your product' }, comparable.map((p) => {
    const b = el('button', { type: 'button', class: 'pill-button', 'aria-pressed': String(p.id === product.id), text: p.category || p.name });
    b.addEventListener('click', () => { state.pricingProductId = p.id; renderPricingVs(data); });
    return b;
  }));

  root.replaceChildren(
    picker,
    el('div', { class: 'tiles-3', style: 'margin-top:16px' },
      el('div', { class: 'tile blue' }, el('p', { class: 'label', text: 'Your price' }), el('p', { class: 'value', text: money(product.price, product.currency) })),
      el('div', { class: 'tile' }, el('p', { class: 'label', text: 'Cheapest competitor' }), el('p', { class: 'value', text: money(cheapest.current_price, cheapest.currency) })),
      el('div', { class: `tile ${diff > 0 ? 'amber' : 'green'}` }, el('p', { class: 'label', text: 'Difference' }), el('p', { class: 'value', text: pct(diff) }))),
    el('div', { class: 'bar-rows', style: 'margin-top:20px' },
      [{ name: `${product.name} (you)`, price: product.price, you: true, title: product.description },
        ...rivals.map((r) => ({ name: `${r.competitor_name} · ${r.name}`, price: r.current_price, title: r.description }))]
        .map((row) => el('div', { class: 'bar-row', title: row.title || '' },
          el('span', { class: `name${row.you ? ' you' : ''}`, text: row.name }),
          progressBar((row.price / maxPrice) * 100, row.you ? 'bg-primary' : 'bg-slate'),
          el('span', { class: 'value', text: money(row.price, product.currency) })))),
    el('p', { class: 'muted small', style: 'margin-top:14px', text: `${product.category} plans can differ in length or size: ${rivals.map((r) => `${r.name}: ${r.description}`).join(' · ')}` }),
  );
}

// ---------------------------------------------------------------------
// 3. Decision under review
// ---------------------------------------------------------------------

/** The pending decision that cuts runway the most (or the first pending one). */
function pickSpotlight(data) {
  const pending = data.decisions.filter((d) => d.status === 'proposed');
  const projected = pending.filter((d) => d.projection && d.projection.runway_difference_months !== null)
    .sort((a, b) => a.projection.runway_difference_months - b.projection.runway_difference_months);
  return projected[0] || pending[0] || null;
}

function renderSpotlight(data) {
  const root = document.getElementById('spotlight');
  const d = pickSpotlight(data);
  state.spotlight = d;
  if (!d) {
    root.replaceChildren(el('p', { class: 'empty' }, 'No pending decisions. ',
      el('a', { href: pageHref('decisions.html'), text: 'Simulate one in the decision simulator.' })));
    return;
  }

  const cur = data.currency;
  const p = d.projection;
  const head = el('div', { class: 'result-head' },
    el('div', { style: 'min-width:0;flex:1' },
      el('p', { class: 'eyebrow muted', text: `Pending decision · ${humanize(d.decision_type)}` }),
      el('h2', { text: d.title }),
      d.description ? el('p', { class: 'muted', style: 'margin-top:4px;max-width:760px', text: d.description }) : null),
    d.risk_level ? el('div', { class: 'risk-chip' }, 'AI risk', badge(levelOf(d.risk_level), d.risk_level)) : null);

  const signed = (v) => (v === null || v === undefined ? '—' : signedMoney(v, cur));
  const tile = (label, value, cls = '') => el('div', { class: `tile ${cls}` }, el('p', { class: 'label', text: label }), el('p', { class: 'value', text: value }));
  const inputs = el('div', { class: 'decision-inputs' },
    tile('Initial investment', money0(d.estimated_cost, cur)),
    tile('Monthly expenses', signed(d.expected_monthly_cost_change), d.expected_monthly_cost_change > 0 ? 'red' : ''),
    tile('Monthly revenue', signed(d.expected_revenue_change), d.expected_revenue_change > 0 ? 'green' : ''));

  const action = spotlightAction(d);
  if (!p) {
    root.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:20px' },
      head, inputs, el('p', { class: 'empty', text: d.projection_unavailable_reason || 'No projection available.' }), action));
    return;
  }

  const now = data.current_state;
  const ps = p.projected_state;
  const after = p.cash_negative_after_investment ? { level: 'critical', label: 'Cash negative' } : runwayStatus(ps.runway_months);
  const diff = p.runway_difference_months;
  const big = (v) => (v === null ? '∞' : Number(v).toFixed(1));

  const compare = el('div', {},
    el('div', { class: 'runway-compare' },
      el('div', { class: 'runway-box' },
        el('p', { class: 'eyebrow', text: 'Now' }), el('p', { class: 'big', text: big(now.runway_months) }), el('p', { class: 'unit', text: 'months runway' })),
      el('span', { class: 'runway-arrow' }, icon('arrow-right', 'sm')),
      el('div', { class: `runway-box ${after.level}` },
        el('p', { class: 'eyebrow', text: 'After' }), el('p', { class: 'big', text: big(ps.runway_months) }), el('p', { class: 'unit', text: 'months runway' }))),
    diff !== null ? el('p', { class: 'runway-delta' }, 'Runway changes by ',
      el('strong', { class: diff < 0 ? 'text-red' : 'text-green', text: `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${monthsLong(Math.abs(diff))}` }),
      ' ', badge(after.level, after.label)) : null);

  // Every number below is a field of the decisions API response.
  const math = el('div', { class: 'calc' },
    el('p', { class: 'eyebrow', text: 'How the projection is calculated (server-side, from the database)' }),
    el('ol', {},
      el('li', {}, 'Cash: ', el('strong', { text: money0(now.cash_balance, cur) }), ` − ${money0(p.inputs.initial_investment, cur)} investment = `,
        el('strong', { text: money0(p.cash_after_investment, cur) })),
      el('li', {}, 'Monthly burn: expenses ', el('strong', { text: money0(ps.expenses, cur) }), ' − revenue ', el('strong', { text: money0(ps.revenue, cur) }),
        ' = ', el('strong', { text: `${money0(ps.monthly_burn, cur)}/mo` }), ` (today ${money0(now.monthly_burn, cur)}/mo)`),
      ps.runway_months !== null
        ? el('li', {}, 'Runway: ', el('strong', { text: money0(ps.cash_balance, cur) }), ' ÷ ', el('strong', { text: `${money0(ps.monthly_burn, cur)}/mo` }),
          ' = ', el('strong', { text: monthsLong(ps.runway_months) }))
        : el('li', { text: 'Runway: revenue would cover expenses, so the business would stop burning cash.' })));

  root.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:20px' }, ...[
    head,
    el('div', { class: 'grid grid-xl-5', style: 'align-items:start' },
      el('div', { class: 'xl-span-2' }, compare),
      el('div', { class: 'xl-span-3', style: 'display:flex;flex-direction:column;gap:16px' }, inputs, math)),
    p.cash_negative_after_investment
      ? el('p', { class: 'error', text: `Cash would go negative (${money0(p.cash_after_investment, cur)}) after the investment.` })
      : null,
    action,
  ].filter(Boolean)));
}

function spotlightAction(d) {
  const button = iconButton('btn-ai btn-lg', 'sparkles', d.risk_level ? 'Ask AI again about this decision' : 'Ask AI: is this decision safe?', { 'data-ai-run': '' });
  button.addEventListener('click', () => startAnalysis({ scroll: true, decision: d }));
  return el('div', { class: 'row', style: 'gap:12px' },
    button,
    el('span', { class: 'muted small', text: 'Claude reviews this projection together with competitor prices and market events.' }));
}

// ---------------------------------------------------------------------
// 4. AI risk review
// ---------------------------------------------------------------------

function decisionTitle(id) {
  const d = state.decisions && id ? state.decisions.decisions.find((x) => x.id === id) : null;
  return d ? d.title : null;
}

function renderLatestAnalysis(data) {
  const row = data.latest_ai_analysis;
  if (!row) {
    document.getElementById('ai-meta').textContent = '';
    document.getElementById('analysis').replaceChildren(...emptyAnalysis());
    return;
  }
  document.getElementById('ai-meta').textContent = analysisMeta(row.analysis_type, row.model_used, row.created_at);
  showAnalysis(analysisFromRow(row), row.analysis_type, row.analysis_type === 'DECISION' ? decisionTitle(row.business_decision_id) : null);
}

function emptyAnalysis() {
  const d = state.spotlight;
  const full = iconButton(d ? 'btn-secondary' : 'btn-ai', 'sparkles', 'Full business review', { 'data-ai-run': '' });
  full.addEventListener('click', () => startAnalysis({}));
  let review = null;
  if (d) {
    review = iconButton('btn-ai', 'shield-alert', `Review "${d.title}"`, { 'data-ai-run': '' });
    review.addEventListener('click', () => startAnalysis({ decision: d }));
  }
  return [
    el('p', { class: 'eyebrow', text: 'StartupGuard AI Recommendation' }),
    el('p', { class: 'lead', text: d
      ? 'No AI review yet. Claude weighs the decision\'s projection against competitor prices and market events, then rates the risk and recommends what to do.'
      : 'No AI review yet. Claude reviews the financials, competitor prices and pending decisions, then rates the risks and recommends actions.' }),
    el('div', { class: 'actions', style: 'margin-top:16px' }, review, full,
      el('a', { class: 'btn btn-secondary', href: pageHref('insights.html'), text: 'View insights' })),
  ];
}

function showAnalysis(analysis, type, title) {
  const top = topRecommendation(analysis);
  const again = iconButton('btn-secondary', 'rotate-ccw', 'Run again', { 'data-ai-run': '' });
  again.addEventListener('click', () => startAnalysis(type === 'DECISION' && state.spotlight ? { decision: state.spotlight } : {}));
  document.getElementById('analysis').replaceChildren(
    el('p', { class: 'eyebrow', text: 'StartupGuard AI Recommendation' }),
    top ? el('p', { class: 'lead' }, el('strong', { text: top })) : null,
    el('div', { class: 'actions', style: 'margin:14px 0 20px' },
      el('a', { class: 'btn btn-ai', href: pageHref('insights.html'), text: 'View insights' }),
      el('a', { class: 'btn btn-secondary', href: pageHref('decisions.html'), text: 'Simulate' }),
      again),
    renderAnalysis(analysis, { type, title }));
}

/** Run a full review, or a DECISION review when `decision` is given. */
async function startAnalysis({ scroll = false, decision = null } = {}) {
  const root = document.getElementById('analysis');
  if (scroll) document.getElementById('ai-step').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const sent = [];
  const dash = state.dashboard;
  if (dash && dash.financial_history) sent.push(`${dash.financial_history.length} months of financials`);
  if (state.competitors) sent.push(`${state.competitors.competitors.length} competitors and their price history`, `${state.competitors.market_events.length} market events`);
  sent.push(decision ? `the "${decision.title}" projection` : 'pending decisions');

  const result = await runAiInto(root, {
    businessId: state.businessId,
    type: decision ? 'DECISION' : 'FULL_ANALYSIS',
    decision,
    buttons: [document.getElementById('analysis-run')],
    what: decision ? `Claude is reviewing "${decision.title}"` : `Claude is analyzing ${dash ? dash.business.name : 'the business'}`,
    sent,
  });
  if (!result) return;

  document.getElementById('ai-meta').textContent = analysisMeta(result.analysis_type, result.model_used, result.created_at);
  showAnalysis(result.analysis, result.analysis_type, decision ? decision.title : null);
  if (dash) {
    // Same values analyze.php stored; refreshes the health card's AI line without a reload.
    dash.latest_ai_analysis = { risk_level: String(result.analysis.overall_risk || '').toLowerCase() || null };
    renderHealthChecks();
  }
  if (decision && state.decisions) {
    decision.risk_level = String(result.analysis.overall_risk || '').toLowerCase() || decision.risk_level;
    renderSpotlight(state.decisions);
    renderDecisions(state.decisions);
  }
}

// ---------------------------------------------------------------------
// Supporting data
// ---------------------------------------------------------------------

function renderPriceChanges(data) {
  const changes = data.competitors
    .flatMap((c) => c.products.map((p) => ({ ...p, competitor_name: c.name })))
    .filter((p) => p.previous_price !== null && p.last_price_change_at)
    .sort((a, b) => b.last_price_change_at.localeCompare(a.last_price_change_at))
    .slice(0, 6);
  const root = document.getElementById('price-changes');
  document.getElementById('changes-sub').textContent = `${data.summary.activity.price_changes_last_90_days} price changes in the last 90 days`;
  if (!changes.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No competitor price changes recorded yet.' }));
    return;
  }
  root.replaceChildren(el('ul', { class: 'divided' }, changes.map((p) => el('li', { class: 'list-row' },
    el('div', { class: 'main' },
      el('p', { class: 'title truncate', text: p.name }),
      el('p', { class: 'sub truncate', text: `${p.competitor_name} · ${dayLabel(p.last_price_change_at)}` })),
    el('div', { class: 'side' },
      el('span', { class: 'tabular' }, el('span', { class: 'muted', text: `${money(p.previous_price, p.currency)} → ` }), el('strong', { text: money(p.current_price, p.currency) })),
      changePill(p.price_change_percentage, true))))));
}

const EVENT_STYLES = {
  EXPANSION: { icon: 'building-2', tone: 'tone-red' },
  PRICE_CHANGE: { icon: 'tag', tone: 'tone-amber' },
  PARTNERSHIP: { icon: 'handshake', tone: '' },
  PRODUCT_LAUNCH: { icon: 'rocket', tone: 'tone-purple' },
  FUNDING: { icon: 'piggy-bank', tone: 'tone-green' },
};

function renderEvents(data) {
  const events = data.recent_competitor_events || [];
  const root = document.getElementById('events');
  if (!events.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No competitor events recorded.' }));
    return;
  }
  root.replaceChildren(el('ul', { class: 'divided' }, events.map((e) => {
    const style = EVENT_STYLES[e.event_type] || { icon: 'activity', tone: 'tone-neutral' };
    return el('li', { class: 'list-row', style: 'align-items:flex-start' },
      el('span', { class: `chip-icon lg ${style.tone}` }, icon(style.icon)),
      el('div', { class: 'main' },
        el('p', { class: 'title', text: e.title }),
        e.description ? el('p', { class: 'sub', text: e.description }) : null),
      el('div', { class: 'side' },
        el('span', { class: 'tag', text: humanize(e.event_type) }),
        el('span', { class: 'muted small', text: dayLabel(e.event_date) }),
        el('span', { class: 'muted small', text: `Importance ${e.importance_score}/10` })));
  })));
}

function renderDecisions(data) {
  const root = document.getElementById('decisions');
  const pending = data.decisions.filter((d) => d.status === 'proposed');
  const current = data.current_state;
  if (!pending.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No pending decisions. Add one in the decision simulator.' }));
    return;
  }
  document.getElementById('decisions-sub').textContent = current
    ? `${pending.length} pending · runway today ${months(current.runway_months)} at ${money0(current.monthly_burn, data.currency)}/mo burn`
    : `${pending.length} pending`;

  const scaleMax = Math.max(36, ...[current && current.runway_months, ...pending.map((d) => d.projection && d.projection.projected_state.runway_months)]
    .filter((v) => v !== null && v !== undefined).map((v) => Math.ceil(v / 6) * 6));
  const BAR = { low: 'bg-green', medium: 'bg-amber', high: 'bg-red', critical: 'bg-red', neutral: 'bg-slate' };

  root.replaceChildren(el('ul', { class: 'divided' }, pending.map((d) => {
    const p = d.projection;
    if (!p) {
      return el('li', { class: 'list-row' }, el('div', { class: 'main' },
        el('p', { class: 'title', text: d.title }), el('p', { class: 'sub', text: d.projection_unavailable_reason || 'No projection available.' })));
    }
    const ps = p.projected_state;
    const status = p.cash_negative_after_investment ? { level: 'critical', label: 'Cash negative' } : runwayStatus(ps.runway_months);
    return el('li', { style: 'padding:14px 0' },
      el('div', { class: 'row between' },
        el('div', { style: 'min-width:0' },
          el('p', { class: 'title', style: 'font-weight:600', text: d.title }),
          el('div', { class: 'row', style: 'margin-top:4px' },
            el('span', { class: 'tag', text: humanize(d.decision_type) }),
            d.risk_level ? badge(levelOf(d.risk_level), `AI: ${d.risk_level}`) : null)),
        el('div', { class: 'side', style: 'display:flex;flex-direction:column;align-items:flex-end;gap:4px' },
          el('strong', { class: 'tabular', text: `${months(current.runway_months)} → ${months(ps.runway_months)}` }),
          badge(status.level, status.label))),
      el('div', { style: 'margin-top:10px', title: `Runway after this decision, out of ${scaleMax} months` },
        progressBar(((ps.runway_months ?? scaleMax) / scaleMax) * 100, BAR[status.level])));
  })));
}
