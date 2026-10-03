// StartupGuard - shared UI pieces for the page scripts
//
// Formatting, stat cards, badges, Chart.js defaults and the AI analysis
// view. Nothing here computes business metrics: every number comes from the
// PHP API and is only formatted. Loads after api.js and layout.js.

const RUNWAY_THRESHOLDS = { critical: 6, high: 12, medium: 18 }; // months, same as Phase 11

// ---------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------

let CURRENCY = 'EUR';
function setCurrency(code) { if (code) CURRENCY = code; }

function money0(amount, currency = CURRENCY) {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${Math.round(amount)} ${currency}`;
  }
}

function money2(amount, currency = CURRENCY) {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat('en-IE', { style: 'currency', currency, minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

/** Whole euros when the amount is whole, cents otherwise. */
function money(amount, currency = CURRENCY) {
  return amount !== null && amount !== undefined && Number(amount) % 1 !== 0 ? money2(amount, currency) : money0(amount, currency);
}

function signedMoney(amount, currency = CURRENCY) {
  if (amount === null || amount === undefined) return '—';
  const n = Number(amount);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${money0(Math.abs(n), currency)}`;
}

/** 5.26 -> "+5.3%". */
function pct(value, digits = 1) {
  if (value === null || value === undefined) return '—';
  const n = Number(value);
  return `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}%`;
}

function months(value) {
  return value === null || value === undefined ? 'Not burning' : `${Number(value).toFixed(1)} mo`;
}

function monthsLong(value) {
  if (value === null || value === undefined) return 'Not burning cash';
  const n = Number(Number(value).toFixed(1));
  return `${n} month${n === 1 ? '' : 's'}`;
}

function monthLabel(dateString, withYear = false) {
  const d = new Date(`${String(dateString).slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { month: 'short', year: withYear ? '2-digit' : undefined, timeZone: 'UTC' });
}

function dayLabel(dateString, withYear = false) {
  const d = new Date(`${String(dateString).slice(0, 10)}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: withYear ? 'numeric' : undefined, timeZone: 'UTC' });
}

function humanize(text) {
  return String(text || '').toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------
// Levels: one scale (low, medium, high, critical) for badges everywhere
// ---------------------------------------------------------------------

/** Runway in months -> {level, label}. null runway means not burning cash. */
function runwayStatus(runway) {
  if (runway === null || runway === undefined) return { level: 'low', label: 'Not burning' };
  if (runway < RUNWAY_THRESHOLDS.critical) return { level: 'critical', label: 'Critical' };
  if (runway < RUNWAY_THRESHOLDS.high) return { level: 'high', label: 'Short' };
  if (runway < RUNWAY_THRESHOLDS.medium) return { level: 'medium', label: 'Watch' };
  return { level: 'low', label: 'Healthy' };
}

const LEVEL_ORDER = { neutral: 0, low: 1, medium: 2, high: 3, critical: 4 };

/** 'HIGH' / 'high' -> 'high'; anything else -> 'neutral'. */
function levelOf(value) {
  const v = String(value || '').toLowerCase();
  return v in LEVEL_ORDER ? v : 'neutral';
}

function worstLevel(levels) {
  return levels.reduce((worst, l) => (LEVEL_ORDER[l] > LEVEL_ORDER[worst] ? l : worst), 'neutral');
}

function badge(level, text) {
  return el('span', { class: `badge ${level}`, text: text ?? (level === 'neutral' ? '—' : level) });
}

// ---------------------------------------------------------------------
// Building blocks
// ---------------------------------------------------------------------

/** "▲ 5.3%" pill. goodWhenUp decides green or red; null shows nothing. */
function changePill(value, goodWhenUp, digits = 1) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  const cls = n === 0 ? '' : (n > 0) === goodWhenUp ? 'good' : 'bad';
  return el('span', { class: `change ${cls}` },
    icon(n > 0 ? 'arrow-up-right' : n < 0 ? 'arrow-down-right' : 'minus', 'xs'),
    `${Math.abs(n).toFixed(digits)}%`);
}

/** The design's stat card: label + icon chip, big value, footer line. */
function statCard({ label, value, iconName, tone = '', foot = [], negative = false, title = null }) {
  return el('section', { class: 'card stat' },
    el('div', { class: 'stat-top' },
      el('p', { class: 'stat-label', text: label }),
      el('span', { class: `chip-icon ${tone}` }, icon(iconName))),
    el('p', { class: `stat-value${negative ? ' negative' : ''}`, title: title || (typeof value === 'string' ? value : null) }, value),
    el('div', { class: 'stat-foot' }, ...[].concat(foot).filter((x) => x !== null && x !== undefined && x !== false)));
}

function cardHeader(title, description = null, action = null) {
  return el('header', { class: 'card-header' },
    el('div', {}, el('h2', { text: title }), description ? el('p', { text: description }) : null),
    action);
}

function progressBar(value, barClass = 'bg-primary') {
  return el('div', { class: 'progress', role: 'presentation' },
    el('div', { class: barClass, style: `width:${Math.max(0, Math.min(100, value))}%` }));
}

function skeleton(height = 120) {
  return el('div', { class: 'skeleton', style: `height:${height}px` });
}

/** Replace `container` with an error box. apiRequest() already logged it. */
function showErrorIn(container, error, context = 'Could not load data') {
  if (!container) return;
  if (!(error instanceof ApiError)) console.error(`[StartupGuard] ${context}:`, error);
  container.replaceChildren(el('div', { class: 'error', role: 'alert' },
    el('strong', { text: `${context}. ` }), error && error.message ? error.message : String(error),
    error && error.code ? el('span', { class: 'detail', text: error.code }) : null));
}

/** Button with an icon + label that can show a spinner. */
function iconButton(cls, iconName, label, attrs = {}) {
  return el('button', { type: 'button', class: `btn ${cls}`, ...attrs },
    icon(iconName), el('span', { class: 'label', text: label }));
}

function setButtonLoading(button, loading, text = 'Analyzing…') {
  if (!button) return;
  const label = button.querySelector('.label');
  const svg = button.querySelector('svg.icon');
  if (loading) {
    if (label && button.dataset.idleLabel === undefined) button.dataset.idleLabel = label.textContent;
    if (svg && !button.dataset.idleIcon) button.dataset.idleIcon = svg.innerHTML;
    if (label) label.textContent = text;
    if (svg) { svg.innerHTML = ICONS['loader-circle']; svg.classList.add('spin'); }
    button.disabled = true;
  } else {
    if (label && button.dataset.idleLabel !== undefined) label.textContent = button.dataset.idleLabel;
    if (svg && button.dataset.idleIcon) { svg.innerHTML = button.dataset.idleIcon; svg.classList.remove('spin'); }
    delete button.dataset.idleLabel;
    delete button.dataset.idleIcon;
    button.disabled = false;
  }
}

// ---------------------------------------------------------------------
// Charts (Chart.js 4, loaded from the pinned CDN or js/vendor/)
// ---------------------------------------------------------------------

function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function setupChartDefaults() {
  if (!window.Chart) return false;
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.font.size = 12;
  Chart.defaults.color = cssVar('--chart-axis');
  Chart.defaults.borderColor = cssVar('--chart-grid');
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.display = false;
  Object.assign(Chart.defaults.plugins.tooltip, {
    backgroundColor: '#ffffff',
    titleColor: cssVar('--foreground'),
    bodyColor: cssVar('--muted-foreground'),
    borderColor: cssVar('--border'),
    borderWidth: 1,
    padding: 10,
    cornerRadius: 8,
    boxPadding: 4,
    usePointStyle: true,
    titleFont: { weight: '600' },
  });
  Chart.defaults.interaction = { mode: 'index', intersect: false };
  return true;
}

/** Axis options in the design's style: no tick lines or axis lines, horizontal grid only. */
function axes({ yFormat = (v) => v, yMin, yMax, xType = 'category', stacked = false, xTime = null } = {}) {
  const x = { grid: { display: false }, border: { display: false }, ticks: { maxRotation: 0, autoSkipPadding: 12 }, stacked };
  if (xType === 'linear') Object.assign(x, { type: 'linear', ticks: { ...x.ticks, callback: xTime || ((v) => v) } });
  return {
    x,
    y: {
      grid: { color: cssVar('--chart-grid') },
      border: { display: false },
      ticks: { callback: yFormat, padding: 6 },
      min: yMin,
      max: yMax,
      stacked,
    },
  };
}

/** Vertical gradient for area fills. */
function areaGradient(color, top = 0.22) {
  return (context) => {
    const { chart } = context;
    const area = chart.chartArea;
    if (!area) return 'transparent';
    const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
    g.addColorStop(0, hexAlpha(color, top));
    g.addColorStop(1, hexAlpha(color, 0));
    return g;
  };
}

function hexAlpha(hex, alpha) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function kMoney(v) {
  const n = Number(v);
  if (Math.abs(n) >= 1000) return `€${(n / 1000).toFixed(Math.abs(n) % 1000 === 0 ? 0 : 1)}k`;
  return `€${n}`;
}

/** Legend list: [{label, color, dashed?, dot?}] */
function legendList(items) {
  return el('ul', { class: 'legend' }, items.map((i) =>
    el('li', {}, el('span', {
      class: `swatch${i.dashed ? ' dashed' : ''}${i.dot ? ' dot' : ''}`,
      style: i.dashed ? `border-color:${i.color}` : `background:${i.color}${i.dot ? ';border-radius:50%' : ''}`,
    }), i.label)));
}

/** Chart.js is missing (offline and no vendor copy): say so in place of the canvas. */
function chartUnavailable(canvas) {
  canvas.replaceWith(el('p', { class: 'empty', text: 'Chart unavailable: Chart.js did not load.' }));
}

const CHARTS = {};
function drawChart(key, canvas, config) {
  if (!canvas) return null;
  if (!window.Chart) { chartUnavailable(canvas); return null; }
  if (CHARTS[key]) CHARTS[key].destroy();
  CHARTS[key] = new Chart(canvas, config);
  return CHARTS[key];
}

// ---------------------------------------------------------------------
// AI analysis (api/analyze.php)
// ---------------------------------------------------------------------

const AI_ERROR_HINTS = {
  AI_NOT_CONFIGURED: 'The AI is not set up on this server. For Claude, set ANTHROPIC_API_KEY; for Ollama, set SG_AI_PROVIDER=ollama and SG_AI_MODEL. Then restart the server.',
  AI_RATE_LIMITED: 'The AI service is busy. Wait a moment and try again.',
  AI_UNAVAILABLE: 'The AI service could not be reached. Check the server\'s internet connection and try again.',
  AI_TIMEOUT: 'The AI took too long to answer. Try again.',
  TIMEOUT: 'The AI took too long to answer. Try again.',
  AI_INVALID_RESPONSE: 'The AI answered in an unexpected format, so nothing was saved. Try again.',
  AI_REFUSED: 'The AI declined to answer this request.',
  INSUFFICIENT_DATA: 'There is not enough data to analyze yet. Add financial records first.',
  NETWORK_ERROR: 'Could not reach the server. Is the PHP server running?',
  PHP_NOT_RUNNING: 'Serve this folder with PHP (php -S localhost:8000), not a static server.',
};

const ANALYSIS_LABELS = {
  FULL_ANALYSIS: 'Full business review',
  FINANCIAL: 'Financial review',
  COMPETITOR: 'Competitor review',
  DECISION: 'Decision review',
};

function analysisError(error) {
  return el('div', { class: 'error', role: 'alert' },
    el('strong', { text: 'AI analysis failed. ' }),
    AI_ERROR_HINTS[error.code] || error.message,
    el('span', { class: 'detail', text: `${error.code || 'ERROR'}: ${error.message}` }));
}

/** The analysis object out of a stored ai_analysis row (dashboard API). */
function analysisFromRow(row) {
  if (!row) return null;
  return row.recommendations && !Array.isArray(row.recommendations)
    ? row.recommendations
    : { summary: row.summary, overall_risk: row.risk_level, recommendations: row.recommendations || [] };
}

function analysisMeta(type, model, createdAt) {
  return [ANALYSIS_LABELS[type] || humanize(type), createdAt ? `${createdAt} UTC` : null, model].filter(Boolean).join(' · ');
}

const SEVERITY_RANK = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function sortedFindings(a) {
  return (a.key_findings || []).slice().sort((x, y) => (SEVERITY_RANK[x.severity] ?? 9) - (SEVERITY_RANK[y.severity] ?? 9));
}

function sortedRecommendations(a) {
  return (a.recommendations || []).slice().sort((x, y) => (x.priority ?? 99) - (y.priority ?? 99));
}

/** First recommendation's action, for one-line summaries. */
function topRecommendation(a) {
  const r = sortedRecommendations(a)[0];
  return r ? (typeof r === 'string' ? r : r.action) : null;
}

/**
 * Full analysis view: verdict, risk tiles, summary, findings, recommendations,
 * opportunities. `compact` drops the tiles and opportunities.
 */
function renderAnalysis(a, { type = 'FULL_ANALYSIS', title = null, compact = false } = {}) {
  const isDecision = type === 'DECISION';
  const tile = (label, value) => el('div', { class: 'risk-tile' },
    el('span', { class: 'label', text: label }),
    badge(levelOf(value), value ? humanize(value) : '—'));

  const findings = sortedFindings(a);
  const recommendations = sortedRecommendations(a);
  const opportunities = a.opportunities || [];

  return el('div', { class: 'ai-result' },
    el('div', { class: 'ai-verdict' },
      el('p', { class: 'eyebrow', text: isDecision ? (title ? `AI verdict on "${title}"` : 'AI verdict on this decision') : 'AI verdict on the business' }),
      badge(levelOf(a.overall_risk), a.overall_risk ? `${humanize(a.overall_risk)} risk` : 'No rating')),
    compact ? null : el('div', { class: 'risk-tiles' },
      tile(isDecision ? 'Decision risk' : 'Overall risk', a.overall_risk),
      tile('Financial risk', a.financial_risk),
      tile('Competitive risk', a.competitive_risk)),
    a.summary ? el('p', { class: 'ai-summary', text: a.summary }) : null,
    el('div', { class: 'ai-cols' },
      el('div', {},
        el('h3', { text: 'Key findings' }),
        findings.length
          ? el('div', {}, findings.map((f) => el('div', { class: 'finding' },
            el('div', { class: 'top' },
              el('span', { class: 'title', text: f.title }),
              badge(levelOf(f.severity), humanize(f.severity))),
            el('p', { text: f.explanation }))))
          : el('p', { class: 'empty', text: 'None.' })),
      el('div', {},
        el('h3', { text: 'Recommendations' }),
        recommendations.length
          ? el('ul', {}, recommendations.map((r, i) => el('li', { class: 'rec' },
            el('span', { class: 'rec-num', text: String(typeof r === 'string' ? i + 1 : r.priority ?? i + 1) }),
            el('div', {},
              el('p', { class: 'title', text: typeof r === 'string' ? r : r.action }),
              typeof r === 'string' || !r.reason ? null : el('p', { text: r.reason })))))
          : el('p', { class: 'empty', text: 'None.' }),
        !compact && opportunities.length ? el('div', { style: 'margin-top:16px' },
          el('h3', { text: 'Opportunities' }),
          opportunities.map((o) => el('div', { class: 'opp' }, el('p', { class: 'title', text: o.title }), el('p', { text: o.explanation })))) : null)),
  );
}

let AI_RUNNING = false;

/**
 * Run one analysis and show progress in `container`.
 * Resolves with the API result, or null when it failed (the error is shown
 * in `container`, followed by whatever was there before).
 */
async function runAiInto(container, { businessId, type = 'FULL_ANALYSIS', decision = null, buttons = [], what = null, sent = [] }) {
  if (AI_RUNNING) return null;
  AI_RUNNING = true;
  const previous = Array.from(container.childNodes).filter((n) => !(n.classList && n.classList.contains('error')));
  const allButtons = [...buttons, ...document.querySelectorAll('[data-ai-run]')];
  allButtons.forEach((b) => setButtonLoading(b, true));

  const elapsed = el('span', { text: '0 s' });
  container.replaceChildren(el('div', { class: 'ai-loading', role: 'status' },
    el('div', { class: 'head' }, icon('loader-circle', 'lg spin'), what || `Claude is preparing the ${(ANALYSIS_LABELS[type] || 'analysis').toLowerCase()}`),
    sent.length ? el('p', { class: 'muted small', text: `Sent for review: ${sent.join(', ')}.` }) : null,
    el('p', { class: 'muted small' }, 'This can take up to a minute. Elapsed: ', elapsed),
    el('div', { class: 'risk-tiles', style: 'width:100%;margin-top:8px' }, [1, 2, 3].map(() => skeleton(58)))));
  const started = Date.now();
  const timer = setInterval(() => { elapsed.textContent = `${Math.round((Date.now() - started) / 1000)} s`; }, 1000);

  try {
    return await runAnalysis(businessId, type, decision ? decision.id : null);
  } catch (error) {
    if (!(error instanceof ApiError)) console.error('[StartupGuard] Analysis failed:', error);
    container.replaceChildren(analysisError(error), ...previous);
    return null;
  } finally {
    clearInterval(timer);
    AI_RUNNING = false;
    allButtons.forEach((b) => b.isConnected && setButtonLoading(b, false));
  }
}

// ---------------------------------------------------------------------
// Competitor price history chart (dashboard and competitors pages)
// ---------------------------------------------------------------------

const SERIES_VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-5', '--chart-6'];
const DASH_PATTERNS = [[], [6, 4], [2, 3], [10, 3, 2, 3]];

/** Competitor id -> color, by name order so a filter never repaints a competitor. */
function competitorColors(competitorsData) {
  const palette = SERIES_VARS.map(cssVar);
  const map = new Map();
  competitorsData.competitors.slice().sort((a, b) => a.name.localeCompare(b.name))
    .forEach((c, i) => map.set(c.id, palette[i % palette.length]));
  return map;
}

/**
 * Stepped price lines from competitors.php charts.price_history.
 * ids: {canvas, legend, filter, mode, sub}; state is kept on the returned object.
 * "% since first" divides each recorded price by that product's first recorded price.
 */
function priceHistoryChart(data, ids, key = 'history') {
  const view = { mode: 'index', filter: 'all' };
  const colors = competitorColors(data);
  const names = new Map(data.competitors.map((c) => [c.id, c.name]));
  const asOf = Date.parse(`${data.as_of}T00:00:00Z`);

  const dashIndex = new Map();
  const perCompetitor = new Map();
  for (const s of data.charts.price_history.series) {
    const n = perCompetitor.get(s.competitor_id) || 0;
    dashIndex.set(s.product_id, n);
    perCompetitor.set(s.competitor_id, n + 1);
  }

  const filterRoot = document.getElementById(ids.filter);
  const options = [{ id: 'all', name: 'All competitors' }, ...data.competitors.slice().sort((a, b) => a.name.localeCompare(b.name))];
  filterRoot.replaceChildren(...options.map((c) => {
    const button = el('button', { type: 'button', class: 'pill-button', 'aria-pressed': String(String(c.id) === view.filter), text: c.name });
    button.addEventListener('click', () => {
      view.filter = String(c.id);
      filterRoot.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      draw();
    });
    return button;
  }));
  document.querySelectorAll(`#${ids.mode} button`).forEach((button) => {
    button.addEventListener('click', () => {
      view.mode = button.dataset.mode;
      document.querySelectorAll(`#${ids.mode} button`).forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
      draw();
    });
  });

  function draw() {
    const indexMode = view.mode === 'index';
    let series = data.charts.price_history.series
      .filter((s) => view.filter === 'all' || String(s.competitor_id) === view.filter)
      .filter((s) => s.points.length > 0);
    const hiddenFlat = indexMode ? series.filter((s) => s.points.length < 2).length : 0;
    if (indexMode) series = series.filter((s) => s.points.length >= 2);

    document.getElementById(ids.sub).textContent = indexMode
      ? `Change since each product's first recorded price${hiddenFlat ? ` · ${hiddenFlat} product${hiddenFlat === 1 ? '' : 's'} with one price hidden` : ''}`
      : `Recorded prices in ${data.summary.currency}, held until the next change`;

    const datasets = series.map((s) => {
      const first = s.points[0].y;
      const points = s.points.map((p) => ({
        x: Date.parse(p.x.replace(' ', 'T') + 'Z'),
        y: indexMode ? ((p.y / first) - 1) * 100 : p.y,
        price: p.y,
      }));
      const last = points[points.length - 1];
      if (last.x < asOf) points.push({ ...last, x: asOf, extended: true });  // hold the last price to today
      const color = colors.get(s.competitor_id);
      return {
        label: s.label,
        productName: s.label.split(' · ').slice(1).join(' · ') || s.label,
        competitorName: names.get(s.competitor_id) || '',
        currency: s.currency,
        data: points,
        borderColor: color,
        backgroundColor: color,
        borderWidth: 2,
        borderDash: DASH_PATTERNS[dashIndex.get(s.product_id) % DASH_PATTERNS.length],
        stepped: 'before',
        pointRadius: (ctx) => (ctx.raw && ctx.raw.extended ? 0 : 3),
        pointHoverRadius: (ctx) => (ctx.raw && ctx.raw.extended ? 0 : 5),
        pointBorderColor: '#fff',
        pointBorderWidth: 1.5,
      };
    });

    document.getElementById(ids.legend).replaceChildren(legendList(datasets.map((d) => ({
      label: `${d.competitorName} · ${d.productName}`, color: d.borderColor, dashed: d.borderDash.length > 0,
    }))));

    const xs = datasets.flatMap((d) => d.data.map((p) => p.x));
    const minX = xs.length ? Math.min(...xs) : asOf;
    const monthTicks = [];
    const start = new Date(minX);
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d.getTime() <= asOf; d.setUTCMonth(d.getUTCMonth() + 1)) {
      if (d.getTime() >= minX) monthTicks.push(d.getTime());
    }
    const scales = axes({ yFormat: (v) => (indexMode ? pct(v, 0) : kMoney(v)) });
    Object.assign(scales.x, {
      type: 'linear', min: minX, max: asOf,
      afterBuildTicks: (scale) => { scale.ticks = monthTicks.map((value) => ({ value })); },
      ticks: { callback: (v) => monthLabel(new Date(v).toISOString()) },
    });
    scales.y.grid = { color: (ctx) => (indexMode && ctx.tick && ctx.tick.value === 0 ? '#cbd5e1' : cssVar('--chart-grid')) };
    scales.y.ticks.maxTicksLimit = 7;

    drawChart(key, document.getElementById(ids.canvas), {
      type: 'line',
      data: { datasets },
      options: {
        parsing: false,
        interaction: { mode: 'nearest', intersect: false },
        scales,
        plugins: {
          tooltip: {
            filter: (item) => !item.raw.extended,
            callbacks: {
              title: (items) => dayLabel(new Date(items[0].raw.x).toISOString(), true),
              label: (ctx) => {
                const d = ctx.dataset;
                const change = ((ctx.raw.price / d.data[0].price) - 1) * 100;
                return ` ${d.competitorName} · ${d.productName}: ${money2(ctx.raw.price, d.currency)}` +
                  (ctx.dataIndex > 0 ? ` (${pct(change)} since first)` : '');
              },
            },
          },
        },
      },
    });
  }

  draw();
  return view;
}
