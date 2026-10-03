// StartupGuard - financials page script
//
// Everything comes from api/dashboard.php: the metrics (calculated in PHP)
// and the financial records (latest 12 months, each with its profit and
// margin). The AI card shows the latest FINANCIAL review from analyze.php
// and can run a new one.

const fin = { businessId: 1, data: null };

document.addEventListener('DOMContentLoaded', async () => {
  fin.businessId = getBusinessId();
  setupChartDefaults();
  document.getElementById('kpis').replaceChildren(...Array.from({ length: 6 }, () => el('div', { class: 'card stat' }, skeleton(86))));
  ['history', 'analysis'].forEach((id) => document.getElementById(id).replaceChildren(skeleton(200)));

  try {
    const data = await StartupGuardAPI.getDashboard(fin.businessId);
    fin.data = data;
    setCurrency(data.metrics.currency || data.business.currency);
    setBusiness(data.business);
    renderKpis(data);
    renderCharts(data.financial_history || []);
    renderHistory(data.financial_history || []);
    renderStoredAnalysis(data);
  } catch (error) {
    ['kpis', 'history', 'analysis'].forEach((id) => showErrorIn(document.getElementById(id), error, 'Could not load the financials'));
  }
});

function renderKpis(data) {
  const m = data.metrics;
  const has = Boolean(m.period);
  const runway = runwayStatus(m.runway_months);
  const vsLast = (v, goodWhenUp) => (v === null || v === undefined ? [el('span', { text: 'No previous month' })] : [changePill(v, goodWhenUp), el('span', { text: 'vs last month' })]);
  const period = has ? monthLabel(m.period, true) : 'No records';

  document.getElementById('kpis').replaceChildren(
    statCard({ label: 'Revenue', value: money0(m.revenue), iconName: 'euro', foot: vsLast(m.revenue_growth, true) }),
    statCard({ label: 'Expenses', value: money0(m.expenses), iconName: 'receipt', tone: 'tone-red', foot: vsLast(m.expense_growth, false) }),
    statCard({
      label: 'Profit / Loss', value: signedMoney(m.profit), negative: m.profit < 0,
      iconName: m.profit < 0 ? 'trending-down' : 'trending-up', tone: m.profit < 0 ? 'tone-red' : 'tone-green',
      foot: [el('span', { text: has ? `${pct(m.profit_margin)} margin, ${period}` : period })],
    }),
    statCard({ label: 'Cash Balance', value: money0(m.cash_balance), iconName: 'piggy-bank', tone: 'tone-green', foot: [el('span', { text: 'Current' })] }),
    statCard({
      label: 'Burn Rate', value: has ? el('span', {}, money0(m.monthly_burn), el('small', { text: '/mo' })) : '—', title: has ? `${money0(m.monthly_burn)}/mo` : '—',
      iconName: 'flame', tone: 'tone-amber', foot: [el('span', { text: has ? `Expenses − revenue, ${period}` : 'No records' })],
    }),
    statCard({
      label: 'Runway', value: !has ? '—' : m.runway_months === null ? 'Not burning' : `${Number(m.runway_months).toFixed(1)} mo`,
      iconName: 'hourglass', tone: 'tone-purple', foot: has ? [badge(runway.level, runway.label), el('span', { text: 'at current burn' })] : [],
    }),
  );
}

function renderCharts(history) {
  const labels = history.map((r) => monthLabel(r.record_date));
  const [blue, red, green, amber, purple, cyan] = SERIES_VARS.map(cssVar);
  document.getElementById('range-sub').textContent = history.length
    ? `Monthly, ${monthLabel(history[0].record_date, true)} to ${monthLabel(history[history.length - 1].record_date, true)}`
    : 'No financial records yet';

  document.getElementById('trend-legend').replaceChildren(legendList([{ label: 'Revenue', color: blue }, { label: 'Expenses', color: red }]));
  const area = (label, key, color, alpha) => ({
    label, data: history.map((r) => r[key]), borderColor: color, backgroundColor: areaGradient(color, alpha),
    fill: true, borderWidth: 2.25, tension: 0.35, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: color,
  });
  const moneyTip = { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${money0(ctx.parsed.y)}` } };

  drawChart('trend', document.getElementById('trend-chart'), {
    type: 'line',
    data: { labels, datasets: [area('Revenue', 'revenue', blue, 0.22), area('Expenses', 'expenses', red, 0.12)] },
    options: { scales: axes({ yFormat: kMoney }), plugins: { tooltip: moneyTip } },
  });

  drawChart('profit', document.getElementById('profit-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Profit',
        data: history.map((r) => r.profit),
        backgroundColor: history.map((r) => (r.profit < 0 ? red : green)),
        borderRadius: 6, maxBarThickness: 28,
      }],
    },
    options: {
      scales: axes({ yFormat: kMoney }),
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${signedMoney(ctx.parsed.y)} (${pct(history[ctx.dataIndex].profit_margin)} margin)` } } },
    },
  });

  const parts = [
    { label: 'Salaries', key: 'salaries', color: blue },
    { label: 'Marketing', key: 'marketing_cost', color: purple },
    { label: 'Operations', key: 'operational_cost', color: amber },
    { label: 'Other', key: 'other_cost', color: cyan },
  ];
  document.getElementById('costs-legend').replaceChildren(legendList(parts.map((p) => ({ label: p.label, color: p.color, dot: true }))));
  drawChart('costs', document.getElementById('costs-chart'), {
    type: 'bar',
    data: {
      labels,
      datasets: parts.map((p) => ({ label: p.label, data: history.map((r) => r[p.key]), backgroundColor: p.color, maxBarThickness: 28, borderRadius: 2 })),
    },
    options: {
      scales: axes({ yFormat: kMoney, stacked: true }),
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${money0(ctx.parsed.y)}`,
            footer: (items) => `Total expenses ${money0(history[items[0].dataIndex].expenses)}`,
          },
        },
      },
    },
  });

  drawChart('customers', document.getElementById('customers-chart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Customers', data: history.map((r) => r.customer_count), borderColor: purple, backgroundColor: purple,
        borderWidth: 2.25, tension: 0.35, pointRadius: 0, pointHoverRadius: 4,
      }],
    },
    options: { scales: axes(), plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.y} customers` } } } },
  });
}

function renderHistory(history) {
  const root = document.getElementById('history');
  if (!history.length) {
    root.replaceChildren(el('p', { class: 'empty', style: 'padding:0 20px 20px', text: 'No financial records yet.' }));
    return;
  }
  const rows = history.slice().reverse();
  root.replaceChildren(el('table', { class: 'data', style: 'min-width:640px' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', text: 'Month' }),
      ...['Revenue', 'Expenses', 'Net', 'Margin', 'Customers'].map((h) => el('th', { scope: 'col', class: 'num', text: h })),
      el('th', { scope: 'col', text: 'Notes' }))),
    el('tbody', {}, rows.map((r) => el('tr', {},
      el('th', { scope: 'row', text: monthLabel(r.record_date, true) }),
      el('td', { class: 'num', text: money0(r.revenue) }),
      el('td', { class: 'num', text: money0(r.expenses) }),
      el('td', { class: `num ${r.profit < 0 ? 'text-red' : 'text-green'}`, style: 'font-weight:500', text: signedMoney(r.profit) }),
      el('td', { class: 'num', text: pct(r.profit_margin) }),
      el('td', { class: 'num', text: String(r.customer_count) }),
      el('td', { class: 'muted', style: 'min-width:220px', text: r.notes || '' }))))));
}

function renderStoredAnalysis(data) {
  const row = data.latest_ai_analysis_by_type && data.latest_ai_analysis_by_type.FINANCIAL;
  if (!row) {
    document.getElementById('analysis').replaceChildren(
      el('p', { class: 'muted', style: 'margin-bottom:16px', text: 'No financial review yet. Claude reads the monthly records, burn and runway, then rates the financial risk and recommends what to change.' }),
      runButton('Run financial review'));
    return;
  }
  document.getElementById('ai-meta').textContent = analysisMeta(row.analysis_type, row.model_used, row.created_at);
  showResult(analysisFromRow(row));
}

function runButton(label) {
  const button = iconButton('btn-ai', 'sparkles', label, { 'data-ai-run': '' });
  button.addEventListener('click', runReview);
  return button;
}

function showResult(analysis) {
  document.getElementById('analysis').replaceChildren(
    renderAnalysis(analysis, { type: 'FINANCIAL', compact: true }),
    el('div', { style: 'margin-top:16px' }, runButton('Run again')));
}

async function runReview() {
  const root = document.getElementById('analysis');
  const months = fin.data ? fin.data.financial_history.length : 0;
  const result = await runAiInto(root, {
    businessId: fin.businessId,
    type: 'FINANCIAL',
    what: 'Claude is reviewing the financials',
    sent: [`${months} months of financial records`, 'cash, burn and runway'],
  });
  if (!result) return;
  document.getElementById('ai-meta').textContent = analysisMeta(result.analysis_type, result.model_used, result.created_at);
  showResult(result.analysis);
}
