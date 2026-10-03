// StartupGuard - shared API client
//
// Every PHP endpoint answers in one of two shapes:
//   success: {"success": true,  "data": {...}, "message": null}
//   error:   {"success": false, "data": null, "error": {"code": "...", "message": "..."}}
//
// apiRequest() returns `data` on success and throws an ApiError otherwise
// (network failure, timeout, HTTP error, non-JSON body or success:false).
// Each failure is logged to the developer console with the method, URL,
// HTTP status and error code.

// Relative, so the app works from the site root or from a subfolder.
const API_BASE = 'api';

const API_DEFAULT_TIMEOUT_MS = 30000;
// The AI call may take up to SG_AI_TIMEOUT (default 120 s) on the server.
const API_ANALYZE_TIMEOUT_MS = 150000;

/** Error thrown by apiRequest(). `code` is the API error code or a client-side one. */
class ApiError extends Error {
  constructor({ code, message, status = 0, method = '', url = '', cause = null }) {
    super(message);
    this.name = 'ApiError';
    this.code = code;       // e.g. VALIDATION_ERROR, AI_NOT_CONFIGURED, NETWORK_ERROR
    this.status = status;   // HTTP status, 0 when no response arrived
    this.method = method;
    this.url = url;
    this.cause = cause;
  }
}

/**
 * Send a request to a StartupGuard endpoint.
 *
 * @param {string} endpoint  File in api/, e.g. 'dashboard.php'.
 * @param {object} [options]
 * @param {string} [options.method='GET']  GET or POST.
 * @param {object} [options.query]         Query parameters; null/undefined/'' values are skipped.
 * @param {object} [options.body]          Sent as JSON.
 * @param {number} [options.timeout]       Milliseconds before the request is aborted.
 * @returns {Promise<any>} The response's `data`.
 */
async function apiRequest(endpoint, { method = 'GET', query = null, body = undefined, timeout = API_DEFAULT_TIMEOUT_MS } = {}) {
  method = method.toUpperCase();

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined && value !== '') params.append(key, String(value));
  }
  const qs = params.toString();
  const url = `${API_BASE}/${endpoint}${qs ? `?${qs}` : ''}`;

  const init = { method, headers: { Accept: 'application/json' } };
  if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  init.signal = controller.signal;

  // Build the ApiError and log it in one place.
  const fail = (details) => {
    const error = new ApiError({ method, url, ...details });
    console.error(
      `[StartupGuard API] ${method} ${url} failed` +
        (error.status ? ` (HTTP ${error.status})` : '') +
        `: ${error.code}: ${error.message}`,
      error.cause || ''
    );
    return error;
  };

  let response;
  let text;
  try {
    response = await fetch(url, init);
    text = await response.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw fail({ code: 'TIMEOUT', message: `No response after ${Math.round(timeout / 1000)} seconds.`, cause: err });
    }
    throw fail({
      code: 'NETWORK_ERROR',
      message: 'Could not reach the server. Is the PHP server running?',
      status: response ? response.status : 0,
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = JSON.parse(text);
  } catch (err) {
    if (text.trimStart().startsWith('<?php')) {
      throw fail({
        code: 'PHP_NOT_RUNNING',
        message: 'The server sent the PHP source instead of running it. Serve this folder with PHP (php -S localhost:8000), not a static server such as Live Server.',
        status: response.status,
        cause: err,
      });
    }
    // Usually a 404 page, a PHP error printed as HTML, or a static server that does not run PHP.
    throw fail({
      code: response.ok ? 'INVALID_RESPONSE' : `HTTP_${response.status}`,
      message: `Expected JSON but got: ${text.trim().slice(0, 120) || '(empty body)'}`,
      status: response.status,
      cause: err,
    });
  }

  if (!payload || typeof payload !== 'object' || typeof payload.success !== 'boolean') {
    throw fail({ code: 'INVALID_RESPONSE', message: 'The response is not in the StartupGuard API format.', status: response.status });
  }

  if (!response.ok || payload.success === false) {
    const apiError = payload.error || {};
    throw fail({
      code: apiError.code || `HTTP_${response.status}`,
      message: apiError.message || response.statusText || 'The request failed.',
      status: response.status,
    });
  }

  return payload.data;
}

/** GET shortcut. */
function apiGet(endpoint, query = null, options = {}) {
  return apiRequest(endpoint, { ...options, method: 'GET', query });
}

/** POST shortcut; `body` is sent as JSON. */
function apiPost(endpoint, body, options = {}) {
  return apiRequest(endpoint, { ...options, method: 'POST', body });
}

// ---------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------

const StartupGuardAPI = {
  getDashboard: (businessId) => apiGet('dashboard.php', { business_id: businessId }),
  getCompetitors: (businessId) => apiGet('competitors.php', { business_id: businessId }),
  getDecisions: (businessId, { status = null } = {}) => apiGet('decisions.php', { business_id: businessId, status }),
  createDecision: (decision) => apiPost('decisions.php', decision),
  analyze: (...args) => runAnalysis(...args),
};

/**
 * POST api/analyze.php.
 *
 * @param {number} businessId
 * @param {string} [analysisType='FULL_ANALYSIS']  FULL_ANALYSIS, FINANCIAL, COMPETITOR or DECISION.
 * @param {number|null} [businessDecisionId]        Required for DECISION, not allowed otherwise.
 * @returns {Promise<object>} {analysis_id, analysis_type, model_used, created_at, stored, analysis, ...}
 */
function runAnalysis(businessId, analysisType = 'FULL_ANALYSIS', businessDecisionId = null) {
  const body = { business_id: businessId, analysis_type: analysisType };
  if (businessDecisionId !== null && businessDecisionId !== undefined) body.business_decision_id = businessDecisionId;
  return apiPost('analyze.php', body, { timeout: API_ANALYZE_TIMEOUT_MS });
}

// ---------------------------------------------------------------------
// Small display helpers shared by the page scripts
// ---------------------------------------------------------------------

/** business_id from the page URL (?business_id=2), falling back to 1 (NovaFit demo). */
function getBusinessId() {
  const raw = new URLSearchParams(window.location.search).get('business_id');
  return raw && /^\d+$/.test(raw) && Number(raw) > 0 ? Number(raw) : 1;
}

/** Create an element. Text is set with textContent, so API data is never parsed as HTML. */
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

/** Build a table from rows and column definitions [{label, value: row => text or Node}]. */
function renderTable(columns, rows, emptyText = 'No data.') {
  if (!rows || rows.length === 0) return el('p', { class: 'muted', text: emptyText });
  return el('div', { class: 'table-wrap' }, el('table', {},
    el('thead', {}, el('tr', {}, columns.map((c) => el('th', { text: c.label })))),
    el('tbody', {}, rows.map((row) => el('tr', {}, columns.map((c) => {
      const value = c.value(row);
      return el('td', {}, value instanceof Node ? value : formatValue(value));
    }))))
  ));
}

/** A row of label/value cards: [[label, value], ...]. */
function renderStats(pairs) {
  return el('div', { class: 'stats' }, pairs.map(([label, value]) =>
    el('div', { class: 'stat' }, el('span', { class: 'stat-label', text: label }), el('strong', { text: formatValue(value) }))
  ));
}

function formatValue(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function formatMoney(amount, currency = 'EUR') {
  if (amount === null || amount === undefined) return '—';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${Number(amount).toFixed(2)} ${currency}`;
  }
}

/** 5.26 -> "+5.26%"; null -> "—". */
function formatPercent(value) {
  if (value === null || value === undefined) return '—';
  return `${value > 0 ? '+' : ''}${Number(value).toFixed(2)}%`;
}

/** Runway in months; null means the business is not burning cash. */
function formatMonths(value) {
  return value === null || value === undefined ? 'Not burning cash' : `${Number(value).toFixed(1)} months`;
}

/** Show an error inside `container`, replacing its content. The console log happens in apiRequest(). */
function showError(container, error, context = 'Could not load data') {
  const code = error && error.code ? ` (${error.code})` : '';
  container.replaceChildren(el('p', { class: 'error', role: 'alert' }, `${context}: ${error.message}${code}`));
}

/** Replace a container's content with a loading line. */
function showLoading(container, text = 'Loading…') {
  container.replaceChildren(el('p', { class: 'muted', text }));
}
