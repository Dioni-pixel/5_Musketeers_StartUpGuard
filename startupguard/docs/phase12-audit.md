# Phase 12: system testing and debugging

Tested 2026-10-03 on throwaway copies of the SQLite database (PHP 8.3, pdo_sqlite), with
`php -S`, curl, a local mock of the Claude API, and headless Chromium for the pages.
The shared `database/startupguard.sqlite` was not modified; no schema or seed change was needed.

## Results of the 25 checks

| # | Check | Result |
|---|-------|--------|
| 1 | schema.sql imports | Pass (fresh build, and re-run on an existing file) |
| 2 | seed.sql imports | Pass (twice; 6 records, 4 products, 2 decisions, 4 competitors, 9 products, 18 price rows, 11 events) |
| 3 | Foreign keys work | Pass (`foreign_key_check` empty; every bad parent id rejected) |
| 4-7 | financial_records, products, business_decisions, competitors -> businesses | Pass (FK rejects unknown business; no orphans; delete cascades) |
| 8-10 | market_events, competitor_products -> competitors; price_history -> competitor_products | Pass |
| 11 | Price history preserved | Pass (price change appends 1 row; non-price update adds none; UPDATE/DELETE on price_history blocked) |
| 12 | PDO prepared statements | Pass (every query with input is prepared and bound; only fixed column lists and WHERE fragments are concatenated) |
| 13 | Financial API valid JSON | Pass (GET, POST 201/400/404/409) |
| 14 | Dashboard calculations | Pass (NovaFit: burn 4000, runway 30.0, margin -20%, revenue growth 5.26%) |
| 15 | Competitor pricing history | Pass (API history matches price_history row for row, 18 rows) |
| 16 | Decision simulation | Pass (Hire 4: runway 13.3, -16.7; Second location: cash 60000, runway 8.0, -22.0) |
| 17 | Divide by zero | Pass (0 revenue -> margin null; 0 -> 500 expenses -> growth null; 0 cash -> runway 0; 0 price -> no crash) |
| 18 | Invalid IDs | Pass after fix 1 (missing, 0, "abc", arrays -> 400; unknown -> 404) |
| 19 | Missing data | Pass after fixes 3-6 (business with no records, competitors or products) |
| 20 | analyze.php context | Pass (business, metrics, history, products, competitors, price trends, events, pending decisions / decision projection) |
| 21 | AI JSON validated | Pass (malformed, fenced, missing field, bad enum, empty list, refusal, HTTP 500 all handled; nothing saved on failure) |
| 22 | Stored in ai_analysis | Pass (risk levels, scores, summary, JSON, raw reply, model; DECISION also updates the decision) |
| 23 | API key never reaches frontend | Pass (key only in the outgoing x-api-key header; not in any response, page, script or log) |
| 24 | JavaScript handles API errors | Pass after fixes 3-6 |
| 25 | Content-Type | Pass (every endpoint, including errors and 405s, sends application/json; charset=utf-8) |

## Bugs found and fixed

1. **analyze.php: unknown business answered "AI not configured".** With no API key, an invalid
   business_id or decision id returned 503 AI_NOT_CONFIGURED instead of 404, and an empty business
   got 503 instead of 422. The key check now runs after the input and data checks.
2. **analyze.php: error logging needed mbstring.** `mb_substr` in three error paths would turn a
   clean 502 AI_INVALID_RESPONSE into a 500 on a PHP without mbstring. Replaced with `substr`.
3. **dashboard.js: the word "null" appeared in the Competition card** when no competitor price
   change exists (`replaceChildren(null)` prints "null"). Null children are now filtered out.
4. **dashboard.js: market event importance shown on the wrong scale.** importance_score is 1 to 10,
   but the card said "8 of 5" and filled all 5 dots for 8 of 11 demo events. Now "of 10", one dot per 2 points.
5. **dashboard.js: a business with no financial records showed "Runway: Unlimited / Not burning cash"**
   and the indicator "Revenue covers expenses this month". It now shows "No data".
6. **decisions.js: "Current state (null)"** for a business with no financial records, and the
   "No financial records yet" message could never show. Fixed.

## Files modified

- api/analyze.php (fixes 1, 2)
- js/dashboard.js (fixes 3, 4, 5)
- js/decisions.js (fix 6)

## Unresolved issues

- **`php -S` serves the database file.** `database/.htaccess` only works on Apache, so
  `http://localhost:8000/database/startupguard.sqlite` downloads the whole database (and the .sql
  files are readable). Fine for local use; before any shared deployment, serve with a small router
  script or move the database outside the web folder.
- **Real Claude API call not tested** (no key here). Request shape matches the current API and was
  tested against a mock. The call is not streamed and waits up to SG_AI_TIMEOUT (120 s); if a real
  full analysis takes longer, raise SG_AI_TIMEOUT.
- **Dashboard "latest AI analysis" can be a decision review.** It shows the newest ai_analysis row of
  any type, so after "Ask AI" on a decision, the dashboard card shows that review (labelled "Decision analysis").
- **api/config.php, db.php, helpers.php opened directly** return an empty 200 text/html page. They
  print nothing and leak nothing, but are not JSON.
