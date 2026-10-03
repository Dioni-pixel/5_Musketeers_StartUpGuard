// StartupGuard - page shell (sidebar, mobile drawer, header account)
//
// Every page has an empty <aside id="sidebar"> and a <header class="page-header">
// in its HTML; this file fills the sidebar, wires the mobile menu, moves the
// header buttons to a second row on phones, and draws icons for elements
// with a data-icon attribute. Loads after icons.js and api.js.

const NAV_ITEMS = [
  { page: 'dashboard', href: 'dashboard.html', label: 'Dashboard', icon: 'layout-dashboard' },
  { page: 'financials', href: 'financials.html', label: 'Financials', icon: 'wallet' },
  { page: 'competitors', href: 'competitors.html', label: 'Competitors', icon: 'swords' },
  { page: 'market', href: 'market.html', label: 'Market Analysis', icon: 'globe' },
  { page: 'decisions', href: 'decisions.html', label: 'Decision Simulator', icon: 'flask-conical' },
  { page: 'insights', href: 'insights.html', label: 'AI Insights', icon: 'sparkles' },
];
const NAV_SETTINGS = { page: 'settings', href: 'settings.html', label: 'Business Profile', icon: 'settings' };

/** An inline Lucide icon. `cls` adds size classes such as 'sm' or 'spin'. */
function icon(name, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', `icon ${cls}`.trim());
  svg.innerHTML = ICONS[name] || '';  // constant markup from icons.js, never API data
  return svg;
}

/** The StartupGuard shield logo from the design. */
function logoMark(cls = 'logo-mark') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 32 32');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  svg.innerHTML =
    '<rect width="32" height="32" rx="9" fill="#2563EB"/>' +
    '<path d="M16 6.5 24 9.5v6.2c0 4.9-3.3 8.4-8 9.8-4.7-1.4-8-4.9-8-9.8V9.5l8-3Z" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>' +
    '<path d="M12.5 19v-2.5M16 19v-5.5M19.5 19v-3.8" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>';
  return svg;
}

/** Keep ?business_id= on internal links so every page shows the same business. */
function pageHref(href) {
  const id = new URLSearchParams(window.location.search).get('business_id');
  return id && /^\d+$/.test(id) ? `${href}?business_id=${id}` : href;
}

function initials(name) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 'SG';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

function buildSidebar() {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const current = document.body.dataset.page;
  const closeDrawer = () => setDrawer(false);

  const navLink = (item) => el('a', {
    class: 'nav-link',
    href: pageHref(item.href),
    title: item.label,
    'aria-current': item.page === current ? 'page' : null,
  }, icon(item.icon), el('span', { class: 'nav-text', text: item.label }));

  const close = el('button', { type: 'button', class: 'icon-button close-nav', 'aria-label': 'Close navigation' }, icon('x', 'lg'));
  close.addEventListener('click', closeDrawer);

  sidebar.setAttribute('aria-label', 'Main navigation');
  sidebar.replaceChildren(
    el('div', { class: 'sidebar-brand' },
      el('a', { href: pageHref('dashboard.html'), 'aria-label': 'StartupGuard AI home' },
        logoMark(),
        el('span', { class: 'brand-name' }, 'StartupGuard ', el('span', { text: 'AI' }))),
      close),
    el('nav', {},
      el('p', { class: 'sidebar-label', text: 'Workspace' }),
      el('ul', { class: 'nav-list' }, NAV_ITEMS.map((item) => el('li', {}, navLink(item))))),
    el('div', { class: 'sidebar-footer' },
      navLink(NAV_SETTINGS),
      el('div', { class: 'account-card', id: 'sidebar-account' },
        el('span', { class: 'avatar', text: '…' }),
        el('div', { class: 'who' },
          el('p', { class: 'name', text: 'Loading…' }),
          el('p', { class: 'role', text: '' })))),
  );

  const scrim = document.getElementById('sidebar-scrim');
  if (scrim) scrim.addEventListener('click', closeDrawer);
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) closeDrawer(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeDrawer(); });

  const menu = document.getElementById('menu-button');
  if (menu) menu.addEventListener('click', () => setDrawer(true));
}

function setDrawer(open) {
  document.getElementById('sidebar')?.classList.toggle('open', open);
  document.getElementById('sidebar-scrim')?.classList.toggle('open', open);
}

/** Show the business in the sidebar and header (name, industry, initials). */
function setBusiness(business) {
  if (!business || !business.name) return;
  const role = [business.industry, business.city].filter(Boolean).join(' · ');
  const sidebar = document.getElementById('sidebar-account');
  if (sidebar) {
    sidebar.replaceChildren(
      el('span', { class: 'avatar', text: initials(business.name), title: business.name }),
      el('div', { class: 'who' }, el('p', { class: 'name', text: business.name }), el('p', { class: 'role', text: role })));
  }
  const header = document.getElementById('header-account');
  if (header) {
    header.replaceChildren(
      el('span', { class: 'avatar sm', text: initials(business.name), title: business.name }),
      el('span', { class: 'who' },
        el('span', { class: 'name', style: 'display:block', text: business.name }),
        el('span', { class: 'role', style: 'display:block', text: business.industry || '' })));
  }
}

/** On phones the header buttons sit on their own row under the title. */
function placeHeaderActions() {
  const wide = document.getElementById('header-actions');
  const narrow = document.getElementById('header-actions-mobile');
  if (!wide || !narrow) return;
  const query = window.matchMedia('(min-width: 640px)');
  const place = () => {
    const [from, to] = query.matches ? [narrow, wide] : [wide, narrow];
    while (from.firstChild) to.append(from.firstChild);
  };
  place();
  query.addEventListener('change', place);
}

/** <span data-icon="sparkles" data-icon-class="sm"> gets its icon prepended. */
function drawStaticIcons(root = document) {
  root.querySelectorAll('[data-icon]').forEach((node) => {
    node.prepend(icon(node.dataset.icon, node.dataset.iconClass || ''));
    node.removeAttribute('data-icon');
  });
}

document.addEventListener('DOMContentLoaded', () => {
  buildSidebar();
  drawStaticIcons();
  placeHeaderActions();
  document.querySelectorAll('a[data-page-link]').forEach((a) => { a.href = pageHref(a.getAttribute('href')); });
});
