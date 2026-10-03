// StartupGuard - market analysis page script
//
// Built from api/competitors.php: activity counts, the events timeline and
// per-category pricing trajectories are calculated in PHP; market events are
// the recorded rows. The AI card shows the latest COMPETITOR review from
// analyze.php and can run a new one.

const mkt = { businessId: 1, data: null, aiRow: null };

const EVENT_TYPES = {
  PARTNERSHIP: { label: 'Partnerships', icon: 'handshake', tone: '', color: '--chart-1' },
  PRODUCT_LAUNCH: { label: 'Product launches', icon: 'rocket', tone: 'tone-purple', color: '--chart-5' },
  EXPANSION: { label: 'Expansion', icon: 'building-2', tone: 'tone-red', color: '--chart-2' },
  PRICE_CHANGE: { label: 'Price changes', icon: 'tag', tone: 'tone-amber', color: '--chart-4' },
  FUNDING: { label: 'Funding', icon: 'piggy-bank', tone: 'tone-green', color: '--chart-3' },
};
const SECTION_CARDS = [
  { type: 'PARTNERSHIP', title: 'Recent Business Deals' },
  { type: 'PRODUCT_LAUNCH', title: 'New Product Launches' },
  { type: 'EXPANSION', title: 'Competitor Expansion' },
  { type: 'PRICE_CHANGE', title: 'Pricing Changes' },
];

document.addEventListener('DOMContentLoaded', async () => {
  mkt.businessId = getBusinessId();
  setupChartDefaults();
  document.getElementById('kpis').replaceChildren(...[1, 2, 3, 4].map(() => el('div', { class: 'card stat' }, skeleton(86))));
  ['trends', 'timeline', 'analysis'].forEach((id) => document.getElementById(id).replaceChildren(skeleton(160)));

  const [comp, dash] = await Promise.allSettled([
    StartupGuardAPI.getCompetitors(mkt.businessId),
    StartupGuardAPI.getDashboard(mkt.businessId),
  ]);

  if (comp.status === 'fulfilled') {
    try {
      const data = comp.value;
      mkt.data = data;
      setCurrency(data.summary.currency);
      setBusiness(data.business);
      renderKpis(data);
      renderActivityChart(data);
      renderTrends(data);
      renderSections(data);
      renderTimeline(data);
    } catch (error) {
      showErrorIn(document.getElementById('kpis'), error, 'Could not show the market data');
    }
  } else {
    ['kpis', 'trends', 'timeline'].forEach((id) => showErrorIn(document.getElementById(id), comp.reason, 'Could not load market data'));
  }

  if (dash.status === 'fulfilled') {
    setBusiness(dash.value.business);
    const row = dash.value.latest_ai_analysis_by_type && dash.value.latest_ai_analysis_by_type.COMPETITOR;
    if (row) {
      document.getElementById('ai-meta').textContent = analysisMeta(row.analysis_type, row.model_used, row.created_at);
      showResult(analysisFromRow(row));
    } else {
      document.getElementById('analysis').replaceChildren(
        el('p', { class: 'muted', style: 'margin-bottom:16px;line-height:1.6', text: 'No market review yet. StartupGuard reads competitor prices, price history and market events, then says what they mean for your business.' }),
        runButton('Run market review'));
    }
  } else {
    showErrorIn(document.getElementById('analysis'), dash.reason, 'Could not load the AI review');
  }
});

function renderKpis(data) {
  const a = data.summary.activity;
  document.getElementById('kpis').replaceChildren(
    statCard({ label: 'Market Activity', value: el('span', {}, String(a.events_last_30_days), el('small', { text: ' events' })), title: `${a.events_last_30_days} events`,
      iconName: 'activity', foot: [el('span', { text: `Last 30 days · ${a.events_last_90_days} in 90 days` })] }),
    statCard({ label: 'Price Changes', value: String(a.price_changes_last_90_days), iconName: 'tag', tone: 'tone-amber', foot: [el('span', { text: 'Last 90 days' })] }),
    statCard({ label: 'Expansions', value: String(a.expansions_last_year), iconName: 'building-2', tone: 'tone-red', foot: [el('span', { text: 'New locations, last 12 months' })] }),
    statCard({ label: 'Partnerships', value: String(a.partnerships_last_year), iconName: 'handshake', tone: 'tone-green', foot: [el('span', { text: 'Business deals, last 12 months' })] }),
  );
}

function renderActivityChart(data) {
  const t = data.charts.events_timeline;
  const series = t.series.filter((s) => s.data.some((v) => v > 0));
  const colorOf = (type) => cssVar((EVENT_TYPES[type] || { color: '--chart-6' }).color);
  document.getElementById('activity-sub').textContent = `Competitor events per month, ${monthLabel(`${t.labels[0]}-01`, true)} to ${monthLabel(`${t.labels[t.labels.length - 1]}-01`, true)}`;
  document.getElementById('activity-legend').replaceChildren(legendList(series.map((s) => ({
    label: (EVENT_TYPES[s.event_type] || {}).label || humanize(s.event_type), color: colorOf(s.event_type), dot: true,
  }))));
  drawChart('activity', document.getElementById('activity-chart'), {
    type: 'bar',
    data: {
      labels: t.labels.map((l) => monthLabel(`${l}-01`)),
      datasets: series.map((s) => ({
        label: (EVENT_TYPES[s.event_type] || {}).label || humanize(s.event_type),
        data: s.data, backgroundColor: colorOf(s.event_type), maxBarThickness: 26, borderRadius: 2,
      })),
    },
    options: {
      scales: (() => { const sc = axes({ stacked: true }); sc.y.ticks.precision = 0; return sc; })(),
      plugins: { tooltip: { filter: (item) => item.parsed.y > 0 } },
    },
  });
}

function renderTrends(data) {
  const cats = data.summary.by_category || [];
  const root = document.getElementById('trends');
  if (!cats.length) {
    root.replaceChildren(el('p', { class: 'empty', text: 'No competitor products recorded.' }));
    return;
  }
  root.replaceChildren(el('ul', { class: 'divided' }, cats.map((c) => {
    const change = c.average_net_change_percentage;
    const up = change !== null && change > 0;
    const flat = change === null || change === 0;
    return el('li', { class: 'list-row' },
      el('span', { class: `chip-icon md ${flat ? 'tone-neutral' : up ? 'tone-green' : 'tone-red'}` },
        icon(flat ? 'minus' : up ? 'arrow-up-right' : 'arrow-down-right')),
      el('div', { class: 'main' },
        el('p', { class: 'title', style: 'font-weight:500', text: c.category }),
        el('p', { class: 'sub truncate', text: `${c.product_count} product${c.product_count === 1 ? '' : 's'} · ${money(c.min_price)}${c.max_price !== c.min_price ? ` – ${money(c.max_price)}` : ''}` })),
      el('span', { class: 'tabular', style: 'font-weight:600', text: change === null ? 'No history' : pct(change) }));
  })));
}

function renderSections(data) {
  const root = document.getElementById('sections');
  root.replaceChildren(...SECTION_CARDS.map((s) => {
    const style = EVENT_TYPES[s.type];
    const events = data.market_events.filter((e) => e.event_type === s.type).slice(0, 3);
    return el('section', { class: 'card pad' },
      el('div', { class: 'row', style: 'gap:10px' },
        el('span', { class: `chip-icon md ${style.tone}` }, icon(style.icon)),
        el('h2', { style: 'font-size:14px;font-weight:600', text: s.title })),
      el('div', { class: 'mini-list', style: 'margin-top:16px' },
        events.length ? events.map((e) => el('div', { class: 'mini-item' },
          el('div', { class: 'top' }, el('p', { class: 'title', text: e.competitor_name }), el('span', { class: 'date', text: dayLabel(e.event_date) })),
          el('p', { class: 'sub', text: e.title })))
          : el('p', { class: 'empty', text: 'None recorded.' })));
  }));
}

function renderTimeline(data) {
  const root = document.getElementById('timeline');
  if (!data.market_events.length) {
    root.replaceChildren(el('li', {}, el('p', { class: 'empty', text: 'No market events recorded.' })));
    return;
  }
  root.replaceChildren(...data.market_events.map((e) => {
    const style = EVENT_TYPES[e.event_type] || { icon: 'activity', tone: 'tone-neutral' };
    return el('li', {},
      el('span', { class: `chip-icon ${style.tone}` }, icon(style.icon)),
      el('div', { class: 'body' },
        el('div', {},
          el('p', { class: 'title', text: e.title }),
          e.description ? el('p', { class: 'sub', text: e.description }) : null,
          el('div', { class: 'row meta' },
            el('span', { class: 'tag', text: e.competitor_name }),
            el('span', { class: 'tag', text: humanize(e.event_type) }),
            el('span', { class: 'muted small', text: `Importance ${e.importance_score}/10${e.source_name ? ` · ${e.source_name}` : ''}` }))),
        el('time', { datetime: e.event_date, text: dayLabel(e.event_date, true) })));
  }));
}

function runButton(label) {
  const button = iconButton('btn-ai', 'sparkles', label, { 'data-ai-run': '' });
  button.addEventListener('click', runReview);
  return button;
}

function showResult(analysis) {
  document.getElementById('analysis').replaceChildren(
    renderAnalysis(analysis, { type: 'COMPETITOR', compact: true }),
    el('div', { style: 'margin-top:16px' }, runButton('Run again')));
}

async function runReview() {
  const d = mkt.data;
  const result = await runAiInto(document.getElementById('analysis'), {
    businessId: mkt.businessId,
    type: 'COMPETITOR',
    what: 'StartupGuard is reviewing the market',
    sent: d ? [`${d.competitors.length} competitors`, `${d.summary.product_count} products with price history`, `${d.market_events.length} market events`] : [],
  });
  if (!result) return;
  document.getElementById('ai-meta').textContent = analysisMeta(result.analysis_type, result.model_used, result.created_at);
  showResult(result.analysis);
}
