# StartupGuard

AI-powered business intelligence platform. StartupGuard analyzes a company's finances, decisions, risks and growth opportunities, tracks competitors' prices, products, deals and market activity, and gives practical recommendations.

**Status:** StartupGuard AI design (light theme, navy sidebar) converted to plain HTML, CSS and JS across seven pages: Dashboard (the 4-step live demo: business health, competitor signals, decision under review, AI risk review, then supporting data), Financials, Competitors, Market Analysis, Decision Simulator, AI Insights and a read-only Business Profile. Every number comes from the PHP API; the AI cards call `api/analyze.php`. The previous dark pages are kept in `backup/phase13-dark-ui/`. Inter is served from `fonts/` and icons are Lucide (inline SVG in `js/icons.js`), so the demo works offline. Earlier (Phase 11): `dashboard.html` was a dark business intelligence view (Chart.js 4.5.1 from a pinned CDN link, with `js/vendor/chart.umd.min.js` as an offline fallback) showing business health, the revenue vs expenses trend, competition, historical competitor pricing, recent price changes and events, pending decisions with projected runway, rule-based risk indicators, and the AI analysis. The **Run AI Analysis** button calls `api/analyze.php` (FULL_ANALYSIS) with a loading state and shows the result; without `ANTHROPIC_API_KEY` on the server it shows a clear setup message. All pages share the dark theme in `css/style.css`. Earlier phases: `js/api.js` provides `apiRequest()` (fetch, JSON, HTTP and API errors logged to the console) and `runAnalysis()`; the dashboard, competitors and decisions pages load and show their API data (`?business_id=` in the page URL, default 1). The database is a single SQLite file built from `database/schema.sql` (see `database/SCHEMA.md`) and `database/seed.sql` (NovaFit demo). `api/config.php`, `api/db.php` and `api/helpers.php` provide the PDO connection, JSON responses, validation and financial calculations. `api/financials.php` works (examples in `api/FINANCIALS_EXAMPLES.md`), `api/dashboard.php?business_id=1` returns everything the main dashboard needs with all metrics calculated in PHP, `api/competitors.php?business_id=1` returns competitors, products, price history, market events, activity counts and descriptive pricing trajectories with chart-ready series, and `api/decisions.php?business_id=1` lists decisions with the current state and each decision's projected cash, revenue, expenses, profit, burn and runway (POST creates a proposed decision), all calculated in PHP. `api/analyze.php` (POST `{"business_id": 1, "analysis_type": "FULL_ANALYSIS"}`; types FULL_ANALYSIS, FINANCIAL, COMPETITOR, DECISION with `business_decision_id`) sends those calculated numbers to Claude, validates the JSON it returns (a malformed reply gives 502 `AI_INVALID_RESPONSE` and saves nothing) and stores each valid analysis in `ai_analysis`.

## Tech stack

- **Frontend:** HTML, CSS, vanilla JavaScript
- **Backend:** PHP 8+, PDO, JSON REST-like APIs
- **Database:** SQLite 3 (via PHP's `pdo_sqlite`; the earlier MySQL version is in `database/mysql/`)

## Structure

```
startupguard/
├── index.html            Redirects to the dashboard
├── dashboard.html        4-step demo: health, competitor signals, decision, AI review
├── financials.html       KPIs, revenue/profit/cost/customer charts, history, AI financial review
├── competitors.html      Competitor cards, price trends, product overview
├── market.html           Market activity, pricing trends by category, event timeline, AI market review
├── decisions.html        Decision simulator (stores a proposed decision, shows its projection, AI review)
├── insights.html         Latest AI analysis as insight cards + "Ask StartupGuard"
├── settings.html         Read-only business profile
├── css/
│   └── style.css         Global styles (design tokens on :root)
├── fonts/                Inter (SIL OFL)
├── img/icon.svg          Logo / favicon
├── js/
│   ├── api.js            Shared fetch client for /api
│   ├── icons.js          Lucide icons (ISC)
│   ├── layout.js         Sidebar, mobile drawer, header
│   ├── ui.js             Formatting, cards, badges, charts, AI result view
│   ├── dashboard.js, financials.js, competitors.js, market.js,
│   │   decisions.js, insights.js, settings.js   one script per page
│   └── vendor/           Chart.js 4.5.1 (offline fallback, MIT)
├── backup/phase13-dark-ui/  The previous dark pages, CSS and JS
├── api/
│   ├── config.php        App and database settings (SG_DB_PATH)
│   ├── db.php            PDO connection (SQLite, foreign keys on)
│   ├── helpers.php       JSON response and request helpers
│   ├── financials.php
│   ├── dashboard.php
│   ├── competitors.php
│   ├── decisions.php
│   └── analyze.php       AI analysis endpoint
├── database/
│   ├── schema.sql        Tables, foreign keys, indexes, triggers
│   ├── seed.sql          NovaFit demo data
│   ├── build.php         Builds startupguard.sqlite from the two files above
│   ├── startupguard.sqlite  The database (generated)
│   ├── SCHEMA.md         Relationship and constraint notes
│   └── mysql/            Archived MySQL 8 version
└── README.md
```

## Local setup

Needs PHP 8+ with the `pdo_sqlite` extension (`php -m | grep pdo_sqlite`; on XAMPP/Windows enable `extension=pdo_sqlite` in php.ini). No database server is needed.

1. Build the database with the demo data: `php database/build.php` (creates `database/startupguard.sqlite`). Use `php database/build.php --fresh` to wipe it and start over.
2. Optional: to keep the file somewhere else, set `SG_DB_PATH=/path/to/startupguard.sqlite` before building and serving.
3. For AI analysis, set your Anthropic API key in the environment of the PHP process (never in a file under the web root), e.g. `export ANTHROPIC_API_KEY=sk-ant-...` (Windows: `set ANTHROPIC_API_KEY=sk-ant-...`). Optional: `SG_AI_MODEL` (default `claude-opus-5-5`), `SG_AI_EFFORT`, `SG_AI_TIMEOUT`; see `api/config.php`. PHP needs the `curl` extension.
   **Ollama instead of Claude:** set `SG_AI_PROVIDER=ollama` and `SG_AI_MODEL` (e.g. `llama3.1`). A local Ollama (default `http://localhost:11434`) needs no key. For Ollama's cloud also set `SG_AI_BASE_URL=https://ollama.com` and `OLLAMA_API_KEY`. analyze.php then calls Ollama's `/api/chat` with the same JSON schema and the same validation.

   **Easiest setup:** open `api/ai-settings.php`, paste your key next to the provider you use, and restart `php -S`. Values in that file win over environment variables. It ships set to Gemini.

   **Gemini (free key from aistudio.google.com/apikey):** set `SG_AI_PROVIDER=gemini` and `GEMINI_API_KEY`. The model defaults to `gemini-2.5-flash` (change with `SG_AI_MODEL`). analyze.php calls `generateContent` with the same JSON schema and the same validation. On the free tier a 429 means the per-minute limit was hit.
4. Serve the folder with PHP: `php -S localhost:8000`
5. Open http://localhost:8000

The web server and PHP need write access to the `database/` folder (SQLite writes a small journal file next to the database). Keep the database out of public reach in production: `database/.htaccess` blocks it on Apache, but `php -S` serves every file, so it is for local use only.
