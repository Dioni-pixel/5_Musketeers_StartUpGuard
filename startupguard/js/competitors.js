// StartupGuard - competitors page script
// Competitor price cuts are shown in red: they put pressure on the business.
//
// Everything comes from api/competitors.php (summary, competitors with their
// products and price history, market events). Prices, changes and
// trajectories are calculated in PHP; this file formats them.

const TRAJECTORY_TEXT = { INCREASING: 'Rising', DECREASING: 'Falling', STABLE: 'Stable', INSUFFICIENT_DATA: 'Not enough data' };
const THREAT_LEVEL = { low: 'low', medium: 'medium', high: 'high', critical: 'critical' };

document.addEventListener('DOMContentLoaded', async () => {
  setupChartDefaults();
  document.getElementById('kpis').replaceChildren(...[1, 2, 3, 4].map(() => el('div', { class: 'card stat' }, skeleton(86))));
  document.getElementById('cards').replaceChildren(...[1, 2, 3, 4].map(() => el('li', { class: 'card stat' }, skeleton(150))));
  document.getElementById('overview').replaceChildren(skeleton(200));

  try {
    const data = await StartupGuardAPI.getCompetitors(getBusinessId());
    setCurrency(data.summary.currency || data.business.currency);
    setBusiness(data.business);
    renderKpis(data);
    renderCards(data);
    priceHistoryChart(data, { canvas: 'history-chart', legend: 'history-legend', filter: 'history-filter', mode: 'history-mode', sub: 'history-sub' });
    renderOverview(data);
  } catch (error) {
    ['kpis', 'cards', 'overview'].forEach((id) => showErrorIn(document.getElementById(id), error, 'Could not load competitors'));
  }
});

function renderKpis(data) {
  const s = data.summary;
  const trend = s.pricing_trajectory;
  document.getElementById('kpis').replaceChildren(
    statCard({ label: 'Competitors Tracked', value: String(s.competitor_count), iconName: 'radar', foot: [el('span', { text: `${s.active_product_count} active products` })] }),
    statCard({
      label: 'Price Range', value: `${money(s.min_price, s.currency)} – ${money(s.max_price, s.currency)}`, iconName: 'tag', tone: 'tone-neutral',
      foot: [el('span', { text: `Cheapest: ${s.cheapest_product ? s.cheapest_product.name : '—'}` })],
    }),
    statCard({
      label: 'Price Changes', value: String(s.activity.price_changes_last_90_days), iconName: 'percent', tone: 'tone-amber',
      foot: [el('span', { text: 'in the last 90 days' })],
    }),
    statCard({
      label: 'Market Pricing', value: TRAJECTORY_TEXT[trend] || humanize(trend), iconName: trend === 'INCREASING' ? 'trending-up' : trend === 'DECREASING' ? 'trending-down' : 'activity',
      tone: trend === 'DECREASING' ? 'tone-red' : trend === 'INCREASING' ? 'tone-green' : 'tone-neutral',
      foot: [changePill(s.average_net_change_percentage, true), el('span', { text: 'avg net change per product' })],
    }),
  );
}

function renderCards(data) {
  const root = document.getElementById('cards');
  if (!data.competitors.length) {
    root.replaceChildren(el('li', { class: 'card pad' }, el('p', { class: 'empty', text: 'No competitors tracked yet.' })));
    return;
  }
  root.replaceChildren(...data.competitors.map((c) => {
    const pr = c.pricing;
    const latest = c.latest_event;
    return el('li', {}, el('section', { class: 'card flex-col pad', style: 'height:100%' },
      el('div', { class: 'row', style: 'flex-wrap:nowrap;gap:12px' },
        el('span', { class: 'chip-icon lg tone-navy', text: c.name.slice(0, 2) }),
        el('div', { style: 'min-width:0' },
          el('h2', { class: 'truncate', style: 'font-size:14px;font-weight:600', text: c.name }),
          el('p', { class: 'muted small row', style: 'gap:4px' }, icon('map-pin', 'xs'), [c.city, c.country].filter(Boolean).join(', ')))),
      el('div', { class: 'row between', style: 'margin-top:20px;align-items:flex-end' },
        el('p', { class: 'stat-value', style: 'margin:0' },
          pr.priced_product_count ? money(pr.min_price, data.summary.currency) : '—',
          pr.priced_product_count > 1 ? el('small', { text: ` – ${money(pr.max_price, data.summary.currency)}` }) : null),
        pr.average_net_change_percentage !== null ? changePill(pr.average_net_change_percentage, true) : el('span', { class: 'muted small', text: 'No change' })),
      el('p', { class: 'muted small', style: 'margin-top:4px', text: `${pr.product_count} product${pr.product_count === 1 ? '' : 's'} · pricing ${(TRAJECTORY_TEXT[pr.pricing_trajectory] || '').toLowerCase()}` }),
      el('p', { class: 'muted small row', style: 'gap:6px;margin-top:10px' }, icon('users', 'sm'),
        `${c.estimated_market_share !== null ? `${c.estimated_market_share}% market share` : 'Share unknown'} · ${humanize(c.estimated_size || 'size unknown')}`),
      latest ? el('p', { class: 'small', style: 'margin-top:10px' }, el('span', { class: 'muted', text: `${dayLabel(latest.event_date)}: ` }), latest.title) : null,
      el('div', { class: 'row between', style: 'margin-top:auto;padding-top:16px;border-top:1px solid var(--border);margin-top:16px' },
        el('span', { class: 'muted small', style: 'font-weight:500', text: 'Threat Level' }),
        badge(THREAT_LEVEL[c.threat_level] || 'neutral', c.threat_level || 'Unknown'))));
  }));
}

function renderOverview(data) {
  const rows = data.competitors.flatMap((c) => c.products.map((p) => ({ ...p, competitor: c })))
    .sort((a, b) => a.competitor.name.localeCompare(b.competitor.name) || a.name.localeCompare(b.name));
  const root = document.getElementById('overview');
  if (!rows.length) {
    root.replaceChildren(el('p', { class: 'empty', style: 'padding:0 20px 20px', text: 'No competitor products recorded.' }));
    return;
  }
  root.replaceChildren(el('table', { class: 'data', style: 'min-width:860px' },
    el('thead', {}, el('tr', {},
      el('th', { scope: 'col', text: 'Competitor' }),
      el('th', { scope: 'col', text: 'Product' }),
      el('th', { scope: 'col', class: 'num', text: 'Price' }),
      el('th', { scope: 'col', class: 'num', text: 'Previous Price' }),
      el('th', { scope: 'col', text: 'Change' }),
      el('th', { scope: 'col', text: 'Recent Activity' }),
      el('th', { scope: 'col', text: 'Threat Level' }))),
    el('tbody', {}, rows.map((p) => el('tr', {},
      el('th', { scope: 'row', text: p.competitor.name }),
      el('td', {}, el('p', { text: p.name }), el('p', { class: 'muted small', text: [p.category, p.description].filter(Boolean).join(' · ') })),
      el('td', { class: 'num', style: 'font-weight:500', text: money2(p.current_price, p.currency) }),
      el('td', { class: 'num muted', text: p.previous_price !== null ? money2(p.previous_price, p.currency) : '—' }),
      el('td', {}, p.price_change_percentage !== null
        ? el('div', {}, changePill(p.price_change_percentage, true), el('p', { class: 'muted small', text: dayLabel(p.last_price_change_at, true) }))
        : el('span', { class: 'muted small', text: 'No change' })),
      el('td', {}, p.competitor.latest_event
        ? [el('p', { text: p.competitor.latest_event.title }), el('p', { class: 'muted small', text: dayLabel(p.competitor.latest_event.event_date, true) })]
        : el('span', { class: 'muted small', text: '—' })),
      el('td', {}, badge(THREAT_LEVEL[p.competitor.threat_level] || 'neutral', p.competitor.threat_level || '—')))))));
}
