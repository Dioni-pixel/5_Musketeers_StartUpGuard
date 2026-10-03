// StartupGuard - decision simulator page script
//
// GET api/decisions.php lists the stored decisions with their projections;
// POST stores a new proposed decision and returns its projection. Cash,
// burn and runway before and after are calculated in PHP. The cash chart
// draws a straight line from those values (cash falls by the monthly burn
// each month); the AI recommendation is a DECISION review from analyze.php.

const sim = { businessId: 1, data: null, current: null };

document.addEventListener('DOMContentLoaded', () => {
  sim.businessId = getBusinessId();
  setupChartDefaults();
  document.getElementById('decision-form').addEventListener('submit', onSubmit);
  load();
});

async function load(openId = null) {
  document.getElementById('saved').replaceChildren(skeleton(120));
  try {
    const data = await StartupGuardAPI.getDecisions(sim.businessId);
    sim.data = data;
    setCurrency(data.currency);
    renderPosition(data.current_state);
    renderSaved(data);
    const requested = openId || Number(new URLSearchParams(window.location.search).get('decision')) || null;
    const d = requested ? data.decisions.find((x) => x.id === requested) : null;
    if (d) showResult(d);
  } catch (error) {
    showErrorIn(document.getElementById('saved'), error, 'Could not load decisions');
    showErrorIn(document.getElementById('position'), error, 'Could not load the current position');
  }
  // The header shows the business; decisions.php only has its name, so fill the industry from the dashboard.
  StartupGuardAPI.getDashboard(sim.businessId).then((d) => setBusiness(d.business)).catch(() => {});
}

function renderPosition(cs) {
  const root = document.getElementById('position');
  if (!cs) {
    root.replaceChildren(el('div', { style: 'grid-column:1/-1' }, el('dd', { style: 'white-space:normal;font-size:14px', text: 'No financial records yet, so no projection can be made.' })));
    return;
  }
  const item = (k, v) => el('div', {}, el('dt', { text: k }), el('dd', { text: v, title: v }));
  root.replaceChildren(
    item('Cash balance', money0(cs.cash_balance)),
    item('Monthly burn', money0(cs.monthly_burn)),
    item('Runway', months(cs.runway_months)),
    item('Revenue', money0(cs.revenue)));
}

// ---------------------------------------------------------------------
// New scenario
// ---------------------------------------------------------------------

async function onSubmit(event) {
  event.preventDefault();
  const form = event.target;
  const errorBox = document.getElementById('form-error');
  errorBox.replaceChildren();
  const number = (name) => {
    const raw = form.elements[name].value.trim();
    return raw === '' ? null : Number(raw);
  };
  const title = form.elements.title.value.trim();
  if (!title) {
    errorBox.replaceChildren(el('p', { class: 'error', text: 'Give the decision a name.' }));
    form.elements.title.focus();
    return;
  }
  const body = {
    business_id: sim.businessId,
    title,
    decision_type: form.elements.decision_type.value,
    description: form.elements.description.value.trim() || null,
    estimated_cost: number('estimated_cost') ?? 0,
    expected_revenue_change: number('expected_revenue_change'),
    expected_monthly_cost_change: number('expected_monthly_cost_change'),
    expected_customer_change: number('expected_customer_change'),
  };

  const button = document.getElementById('simulate');
  const fields = document.getElementById('form-fields');
  setButtonLoading(button, true, 'Calculating…');
  fields.disabled = true;
  try {
    const created = await StartupGuardAPI.createDecision(body);
    await load(created.decision.id);
  } catch (error) {
    errorBox.replaceChildren(el('div', { class: 'error', role: 'alert' },
      el('strong', { text: 'Could not simulate this decision. ' }), error.message, el('span', { class: 'detail', text: error.code || '' })));
  } finally {
    setButtonLoading(button, false);
    fields.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Result view
// ---------------------------------------------------------------------

function showResult(d) {
  sim.current = d;
  const root = document.getElementById('result');
  document.getElementById('form-card').hidden = true;
  root.hidden = false;

  const back = iconButton('btn-secondary', 'rotate-ccw', 'Try Another Scenario');
  back.addEventListener('click', () => {
    root.hidden = true;
    root.replaceChildren();
    document.getElementById('form-card').hidden = false;
    document.getElementById('form-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const p = d.projection;
  const cs = sim.data.current_state;
  const head = el('div', { class: 'result-head' },
    el('div', { style: 'min-width:0' },
      el('p', { class: 'eyebrow muted', text: `Scenario results · ${humanize(d.decision_type)} · ${humanize(d.status)}` }),
      el('h2', { text: d.title }),
      d.description ? el('p', { class: 'muted', style: 'margin-top:4px', text: d.description }) : null),
    el('div', { class: 'risk-chip' }, 'Risk Level',
      d.risk_level ? badge(levelOf(d.risk_level), d.risk_level) : el('span', { class: 'muted small', text: 'Ask AI below' })));

  if (!p) {
    root.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:24px' },
      head, el('section', { class: 'card pad' }, el('p', { class: 'empty', text: d.projection_unavailable_reason || 'No projection available.' })), el('div', {}, back)));
    return;
  }

  const ps = p.projected_state;
  const after = p.cash_negative_after_investment ? { level: 'critical', label: 'Cash negative' } : runwayStatus(ps.runway_months);
  const toneOf = { low: 'text-green', medium: 'text-amber', high: 'text-red', critical: 'text-red', neutral: '' };
  const metric = (label, value, cls = '') => el('section', { class: 'card pad' },
    el('p', { class: 'stat-label', text: label }), el('p', { class: `metric-value ${cls}`, text: value }));
  const burnText = (v) => (v > 0 ? `${money0(v)}/mo` : 'Not burning');
  const big = (v) => (v === null ? '∞' : Number(v).toFixed(1));
  const diff = p.runway_difference_months;

  const aiBody = el('div', { class: 'text', id: 'decision-ai' });
  const card = el('section', { class: 'card ai-tint' },
    el('div', { class: 'ai-hero row-top' }, el('span', { class: 'chip-icon xl tone-ai-solid' }, icon('sparkles')), aiBody));

  root.replaceChildren(el('div', { style: 'display:flex;flex-direction:column;gap:24px;animation:rise-in .4s ease-out' },
    head,
    el('div', { class: 'grid grid-sm-2 grid-xl-4' },
      metric('Current Runway', monthsLong(cs.runway_months)),
      metric('Projected Runway', monthsLong(ps.runway_months), toneOf[after.level]),
      metric('Current Burn Rate', burnText(cs.monthly_burn)),
      metric('Projected Burn Rate', burnText(ps.monthly_burn), ps.monthly_burn > cs.monthly_burn ? 'text-red' : 'text-green')),
    el('div', { class: 'grid grid-xl-5' },
      el('section', { class: 'card pad-lg xl-span-2', style: 'display:flex;flex-direction:column;justify-content:center' },
        el('p', { style: 'font-weight:600', text: 'Runway impact' }),
        el('div', { class: 'runway-compare', style: 'margin-top:20px' },
          el('div', { class: 'runway-box' }, el('p', { class: 'eyebrow', text: 'Before' }), el('p', { class: 'big', text: big(cs.runway_months) }), el('p', { class: 'unit', text: 'months runway' })),
          el('span', { class: 'runway-arrow' }, icon('arrow-right', 'sm')),
          el('div', { class: `runway-box ${after.level}` }, el('p', { class: 'eyebrow', text: 'After' }), el('p', { class: 'big', text: big(ps.runway_months) }), el('p', { class: 'unit', text: 'months runway' }))),
        diff !== null ? el('p', { class: 'runway-delta' }, 'Runway changes by ',
          el('strong', { class: diff < 0 ? 'text-red' : 'text-green', text: `${diff > 0 ? '+' : diff < 0 ? '−' : ''}${monthsLong(Math.abs(diff))}` }), ' ', badge(after.level, after.label)) : null,
        el('div', { class: 'calc', style: 'margin-top:16px' },
          el('p', { class: 'eyebrow', text: 'Calculated by the server' }),
          el('ol', {},
            el('li', {}, `Cash ${money0(cs.cash_balance)} − ${money0(p.inputs.initial_investment)} investment = `, el('strong', { text: money0(p.cash_after_investment) })),
            el('li', {}, `Burn: expenses ${money0(ps.expenses)} − revenue ${money0(ps.revenue)} = `, el('strong', { text: burnText(ps.monthly_burn) })),
            ps.runway_months !== null ? el('li', {}, `Runway ${money0(ps.cash_balance)} ÷ ${money0(ps.monthly_burn)} = `, el('strong', { text: monthsLong(ps.runway_months) })) : null)),
        p.cash_negative_after_investment ? el('p', { class: 'error', style: 'margin-top:12px', text: `Cash would go negative (${money0(p.cash_after_investment)}) after the investment.` }) : null),
      el('section', { class: 'card xl-span-3' },
        cardHeader('Cash Projection', 'Next 24 months at constant monthly burn, from the values above'),
        el('div', { class: 'card-body' },
          legendList([{ label: 'Current plan', color: cssVar('--chart-1') }, { label: 'With decision', color: cssVar('--chart-2'), dashed: true }]),
          el('div', { class: 'chart-box h256' }, el('canvas', { id: 'cash-chart', role: 'img', 'aria-label': 'Line chart of projected cash with and without the decision' }))))),
    card,
    el('div', { class: 'row' }, back)));

  drawCashChart(cs, p);
  renderDecisionAi(d);
  root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function drawCashChart(cs, p) {
  const ps = p.projected_state;
  const n = 24;
  const line = (start, burn) => Array.from({ length: n + 1 }, (_, m) => Math.max(0, start - Math.max(0, burn) * m));
  drawChart('cash', document.getElementById('cash-chart'), {
    type: 'line',
    data: {
      labels: Array.from({ length: n + 1 }, (_, m) => (m === 0 ? 'Now' : `M${m}`)),
      datasets: [
        { label: 'Current plan', data: line(cs.cash_balance, cs.monthly_burn), borderColor: cssVar('--chart-1'), backgroundColor: cssVar('--chart-1'), borderWidth: 2.25, pointRadius: 0, pointHoverRadius: 4, tension: 0 },
        { label: 'With decision', data: line(p.cash_after_investment, ps.monthly_burn), borderColor: cssVar('--chart-2'), backgroundColor: cssVar('--chart-2'), borderWidth: 2.25, borderDash: [6, 4], pointRadius: 0, pointHoverRadius: 4, tension: 0 },
      ],
    },
    options: {
      scales: (() => { const s = axes({ yFormat: kMoney, yMin: 0 }); s.x.ticks.maxTicksLimit = 9; return s; })(),
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${money0(ctx.parsed.y)}` } } },
    },
  });
}

function renderDecisionAi(d) {
  const root = document.getElementById('decision-ai');
  const ask = iconButton('btn-ai', 'sparkles', d.risk_level ? 'Ask AI again' : 'Get AI recommendation', { 'data-ai-run': '' });
  ask.addEventListener('click', () => askAi(d));
  root.replaceChildren(
    el('p', { class: 'eyebrow', text: 'StartupGuard AI Recommendation' }),
    d.ai_recommendation
      ? el('p', { class: 'lead', text: d.ai_recommendation })
      : el('p', { class: 'lead muted', text: 'Claude reviews this projection together with competitor prices and market events, rates the risk and recommends what to do.' }),
    el('div', { class: 'actions', style: 'margin-top:16px' }, ask));
}

async function askAi(d) {
  const root = document.getElementById('decision-ai');
  const result = await runAiInto(root, {
    businessId: sim.businessId,
    type: 'DECISION',
    decision: d,
    what: `Claude is reviewing "${d.title}"`,
    sent: ['this projection', 'financial history', 'competitor prices', 'market events'],
  });
  if (!result) return;
  // analyze.php stored the rating and summary on the decision.
  d.risk_level = String(result.analysis.overall_risk || '').toLowerCase() || d.risk_level;
  d.ai_recommendation = result.analysis.summary || d.ai_recommendation;
  const again = iconButton('btn-secondary', 'rotate-ccw', 'Ask AI again', { 'data-ai-run': '' });
  again.addEventListener('click', () => askAi(d));
  root.replaceChildren(
    el('p', { class: 'eyebrow', text: 'StartupGuard AI Recommendation' }),
    el('p', { class: 'muted small', style: 'margin:2px 0 14px', text: analysisMeta(result.analysis_type, result.model_used, result.created_at) }),
    renderAnalysis(result.analysis, { type: 'DECISION', title: d.title }),
    el('div', { class: 'actions', style: 'margin-top:16px' }, again));
  const chip = document.querySelector('#result .risk-chip');
  if (chip) chip.replaceChildren('Risk Level', badge(levelOf(d.risk_level), d.risk_level));
  renderSaved(sim.data);
}

// ---------------------------------------------------------------------
// Saved scenarios (all stored decisions)
// ---------------------------------------------------------------------

function renderSaved(data) {
  const root = document.getElementById('saved');
  if (!data.decisions.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No decisions yet. Simulate one above.' }));
    return;
  }
  const decisions = data.decisions.slice().sort((a, b) => b.id - a.id);
  root.replaceChildren(el('ul', { class: 'divided' }, decisions.map((d) => {
    const ps = d.projection && d.projection.projected_state;
    const status = !d.projection ? { level: 'neutral', label: 'No projection' }
      : d.projection.cash_negative_after_investment ? { level: 'critical', label: 'Cash negative' } : runwayStatus(ps.runway_months);
    const open = el('button', { type: 'button', class: 'btn btn-secondary', style: 'height:34px', text: 'Open' });
    open.addEventListener('click', () => showResult(d));
    return el('li', { class: 'list-row', style: 'flex-wrap:wrap' },
      el('div', { class: 'main', style: 'min-width:180px' },
        el('p', { class: 'title', text: d.title }),
        el('p', { class: 'sub', text: `${humanize(d.decision_type)} · ${humanize(d.status)}${d.decision_date ? ` · ${dayLabel(d.decision_date, true)}` : ''}` })),
      el('span', { class: 'tabular', style: 'font-weight:500', text: ps ? `${months(data.current_state.runway_months)} → ${months(ps.runway_months)}` : '—' }),
      badge(status.level, status.label),
      d.risk_level ? badge(levelOf(d.risk_level), `AI: ${d.risk_level}`) : el('span', { class: 'badge neutral', text: 'Not reviewed' }),
      open);
  })));
}
