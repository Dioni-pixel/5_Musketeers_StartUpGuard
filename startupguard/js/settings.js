// StartupGuard - business profile page script
//
// Read-only view of the business record, its products and tracking scope,
// from api/dashboard.php and api/competitors.php.

document.addEventListener('DOMContentLoaded', async () => {
  const root = document.getElementById('profile');
  root.replaceChildren(skeleton(160), skeleton(160));
  const id = getBusinessId();
  const [dash, comp] = await Promise.allSettled([StartupGuardAPI.getDashboard(id), StartupGuardAPI.getCompetitors(id)]);
  if (dash.status === 'rejected') {
    showErrorIn(root, dash.reason, 'Could not load the business profile');
    return;
  }
  const d = dash.value;
  const b = d.business;
  setCurrency(b.currency);
  setBusiness(b);

  const field = (label, value, full = false) => el('div', { class: `field${full ? ' full' : ''}` },
    el('label', { text: label }), el('div', { class: 'readonly-value', text: value === null || value === undefined || value === '' ? '—' : String(value) }));
  const section = (title, description, iconName, ...fields) => el('section', { class: 'card settings-section' },
    el('div', { class: 'intro' },
      el('span', { class: 'chip-icon' }, icon(iconName)),
      el('div', {}, el('h2', { text: title }), el('p', { text: description }))),
    el('div', { class: 'settings-fields' }, ...fields));

  const c = comp.status === 'fulfilled' ? comp.value : null;
  root.replaceChildren(
    section('Company Profile', 'Basic information used across reports and AI reviews.', 'building-2',
      field('Company Name', b.name), field('Industry', b.industry),
      field('City', b.city), field('Country', b.country),
      field('Website', b.website), field('Founded', b.founded_year),
      field('Employees', b.employee_count), field('Currency', b.currency),
      field('Description', b.description, true)),
    section('Financial Settings', 'Used to calculate burn, runway and simulations.', 'wallet',
      field('Current Cash Balance', money0(b.cash_balance)),
      field('Latest Financial Record', d.metrics.period ? monthLabel(d.metrics.period, true) : 'None yet'),
      field('Records on File', `${d.financial_history.length} month${d.financial_history.length === 1 ? '' : 's'} (latest 12 shown)`),
      field('Runway Warning', `Flagged under ${RUNWAY_THRESHOLDS.medium} months`)),
    section('Products', 'Your active products, compared with competitor products in the same category.', 'tag',
      ...(d.product_list.length ? d.product_list.map((p) => field(`${p.category || 'Product'}`, `${p.name} · ${money(p.price, p.currency)}`)) : [field('Products', 'None recorded', true)])),
    section('Market Settings', 'Which competitors and signals StartupGuard tracks.', 'map-pin',
      field('Market Location', [b.city, b.country].filter(Boolean).join(', ')),
      field('Competitors Tracked', c ? c.competitors.map((x) => x.name).join(', ') : String(d.competitors.total)),
      field('Competitor Products', c ? String(c.summary.product_count) : '—'),
      field('Market Events on File', String(d.metrics.market_event_count))),
  );
});
