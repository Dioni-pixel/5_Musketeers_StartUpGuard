# Phase 13: live demo script (3 to 5 minutes)

## Before presenting

1. `php database/build.php --fresh` (fresh NovaFit data, no old AI analyses).
2. Start the server with your key: `ANTHROPIC_API_KEY=sk-ant-... php -S localhost:8000` from the startupguard folder.
3. Do one full rehearsal with the real key and note how long the AI step takes.
   If it is too slow on stage, restart with `SG_AI_EFFORT=low` as well.
4. Rebuild again (step 1) so the page opens with "No AI analysis yet".

## Script

Open `http://localhost:8000/dashboard.html`. The page reads top to bottom as four numbered steps.

| Step | What judges see | What to say |
|------|-----------------|-------------|
| 1 Business health | Revenue €20,000, expenses €24,000, burn €4,000/mo, cash €120,000, runway 30 mo (Healthy). Yellow "Hidden risk" line: loss doubled since April, expenses +41% vs revenue +33%. | "On paper NovaFit looks fine: 30 months of runway. But costs are growing faster than revenue." |
| 2 Competitor signals | A: FitZone cut its monthly price €32 → €29. B: PulseGym opened a second studio in Fushe Kosove. C: Balkan Wellness Group signed a deal with a large Kosovo bank. | "StartupGuard tracks competitors' prices and moves automatically." |
| 3 Decision under review | Open second location: investment €60,000, expenses +€8,000/mo, revenue +€4,500/mo. Current runway 30 months → projected 8 months (−22). The three-line calculation underneath. | "The founder wants to expand. The backend recalculates: runway drops from 30 to 8 months." |
| 4 AI risk review | Click "Ask AI: is this decision safe?". The loading panel lists what is sent. The result shows a verdict, three risk ratings, findings and recommendations. | "Claude combines the financial impact with the competitor environment, e.g. PulseGym already opened in the same area." |

Everything below "Supporting data" (charts, price changes, events, rule-based indicators) is there for questions.

## What changed in Phase 13

- seed.sql: one new market event, PulseGym opens a second studio in Fushe Kosove (2026-09-22,
  importance 9). 12 events now. Nothing else in the data changed.
- dashboard.html / js/dashboard.js / css/style.css: numbered steps 1 to 4 at the top, KPI order
  matches the story, "Hidden risk" line, Competitor signals cards, Decision under review spotlight
  with the calculation, decision-specific AI button, loading panel and AI verdict banner.
- api/analyze.php: the DECISION (and FULL) instructions ask Claude to connect the projection with
  competitor activity. The data sent and the output format are unchanged.
- js/decisions.js: the table shows the monthly expense and revenue change.

## How the new sections choose what to show (no new calculations)

- Competitor signals: a price cut is a product whose latest recorded price change was a cut (from
  price_history), matched to the same-day PRICE_CHANGE event; new locations are EXPANSION events and
  partnerships are PARTNERSHIP events. Highest importance wins, then the most recent, and each card
  names a different competitor when possible.
- Decision under review: the pending decision with the largest runway drop.
- Every figure comes from api/dashboard.php, competitors.php or decisions.php.

Tested in headless Chromium at 1440 px and 390 px on a scratch copy of the database, with the AI
step answered by a local mock. Screenshots: docs/phase13-dashboard.png, docs/phase13-ai-review.png.
