# StartupGuard database: relationships and checks

Database: one SQLite file, `database/startupguard.sqlite` (SQLite 3.25+). Source: `schema.sql`, demo data: `seed.sql`. Build both with `php database/build.php` (add `--fresh` to rebuild). The original MySQL 8 version is kept in `mysql/`.

## Relationship tree

```
businesses
├── financial_records         business_id            CASCADE
├── products                  business_id            CASCADE
├── business_decisions        business_id            CASCADE
│     └── ai_analysis         business_decision_id   SET NULL (optional link)
├── ai_analysis               business_id            CASCADE
└── competitors               business_id            CASCADE
      ├── market_events       competitor_id          CASCADE
      └── competitor_products competitor_id          CASCADE
            └── price_history competitor_product_id  CASCADE
```

## Foreign keys

| Child table | Column | Parent | ON DELETE | Meaning |
|---|---|---|---|---|
| financial_records | business_id | businesses.id | CASCADE | A business's monthly figures go with it. |
| products | business_id | businesses.id | CASCADE | Its own products go with it. |
| business_decisions | business_id | businesses.id | CASCADE | Its decisions go with it. |
| ai_analysis | business_id | businesses.id | CASCADE | All analyses of a business go with it. |
| ai_analysis | business_decision_id (NULL) | business_decisions.id | SET NULL | Deleting a decision keeps its analyses as general business analyses. |
| competitors | business_id | businesses.id | CASCADE | Competitors are tracked per business. |
| competitor_products | competitor_id | competitors.id | CASCADE | Products go with their competitor. |
| market_events | competitor_id | competitors.id | CASCADE | Events go with their competitor. |
| price_history | competitor_product_id | competitor_products.id | CASCADE | History goes only when the product itself is deleted. |

All foreign keys also use `ON UPDATE CASCADE` (ids are `INTEGER PRIMARY KEY AUTOINCREMENT` and never change in practice).

**SQLite only enforces foreign keys when `PRAGMA foreign_keys = ON` is set on the connection.** `api/db.php`, `build.php`, `schema.sql` and `seed.sql` all set it. Any other tool that writes to the file (a DB browser, the `sqlite3` shell) must run `PRAGMA foreign_keys = ON;` first, or cascades and FK checks are silently skipped.

Deleting one business removes everything below it in one statement: its financials, products, decisions, analyses, competitors, their products, events and price history.

## Price history is never overwritten

- `competitor_products` holds the live `current_price`.
- Trigger `trg_competitor_products_ai_price` writes the first `price_history` row when a product is inserted.
- Trigger `trg_competitor_products_au_price` appends a new row whenever `current_price` or `currency` changes. Other edits (name, active, last_checked) add nothing.
- Triggers `trg_price_history_bu_block` and `trg_price_history_bd_block` reject any `UPDATE` or direct `DELETE` on `price_history`.
- Deleting the parent product still clears its history. Unlike MySQL, SQLite cascades do fire triggers, so the block triggers only act while the parent product still exists; during a cascade the parent is already gone.

So the PHP API only ever updates `competitor_products.current_price`. It must not insert into `price_history` itself, or each change would be logged twice.

## Row times and the app clock

- Times are UTC text, `YYYY-MM-DD HH:MM:SS` (`CURRENT_TIMESTAMP`), the same format MySQL returned.
- MySQL's `ON UPDATE CURRENT_TIMESTAMP` is done by triggers: `updated_at` on businesses, products, business_decisions and competitor_products, and `last_updated` on competitors, refresh on every update unless the statement sets that column itself. (MySQL only refreshed when a value actually changed; these triggers refresh on any UPDATE of the row.)
- `app_clock` is a one-row table that is normally empty. While it holds a row, the price-history and updated_at triggers use its time instead of the real clock. `seed.sql` uses it to date the demo price history (MySQL used `SET TIMESTAMP`, which SQLite does not have) and empties it at the end. The app should leave it empty.

## Extra safeguard

`ai_analysis` has both `business_id` and an optional `business_decision_id`. A foreign key alone would allow an analysis of business A to point at a decision of business B. Triggers `trg_ai_analysis_bi_decision` / `_bu_decision` reject that. (A composite FK cannot do it here, because `ON DELETE SET NULL` would also try to null the required `business_id`.)

## Verification

### No circular relationships

Every foreign key points one level up the tree above. Ordering the tables by depth (businesses 0; financial_records, products, business_decisions, competitors 1; ai_analysis, competitor_products, market_events 2; price_history 3), every FK goes from a deeper table to a shallower one, so no chain of references can return to where it started. No table references itself.

`ai_analysis` has two paths to `businesses` (directly, and through `business_decisions`). That is a diamond, not a cycle. When a business is deleted, both paths cascade without conflict. This was tested.

### Tested on SQLite 3.45.1 (PHP 8.3 pdo_sqlite)

`schema.sql` and `seed.sql` were each loaded twice to confirm they re-run cleanly, then exercised:

| Test | Result |
|---|---|
| Seed row counts | 1 business, 6 financial records, 4 products, 4 competitors, 9 competitor products, 18 price history rows, 12 market events, 2 decisions |
| Price history dates | Same as the MySQL seed (2026-04-01 first prices, then each change on its story date) |
| Insert product at 10.00, change to 12.50, edit `active`, change to 11.00 | 3 history rows (10.00, 12.50, 11.00) |
| `UPDATE` / `DELETE` on price_history | Rejected |
| Analysis linked to another business's decision | Rejected |
| financial_risk 101, market share 150%, importance 11 | Rejected by CHECK |
| Unknown decision status, invalid JSON in recommendations, record_date `2026-02-30` | Rejected by CHECK |
| Product for a non-existent business | Rejected by FK |
| Second record for the same business and date | Rejected by UNIQUE |
| Delete a decision | Its analysis kept, `business_decision_id` set to NULL |
| Delete a competitor product | Its price history removed |
| Delete a business | Its competitors, events, analyses and decisions removed; the other business untouched |
| `PRAGMA foreign_key_check` / `integrity_check` | No problems / ok |

## Design choices worth knowing

- SQLite does not enforce column types or lengths: `VARCHAR(150)` accepts longer text and a NUMERIC column accepts text. The CHECK constraints above and the API validation are the real guards, so every endpoint must validate input before writing.
- Money: `NUMERIC(15,2)` for business-level amounts, `NUMERIC(12,2)` for unit prices. SQLite stores these as integers or floating-point numbers, not exact decimals, so `20000.50` comes back as the number `20000.5`. The API validates amounts (max 2 decimals) and returns them as JSON numbers, as before. Do sums that must be exact in PHP with cents, as `financials.php` does for the expenses check. Currency is a 3-letter ISO code (default `USD`).
- Dates: `DATE` columns hold `YYYY-MM-DD` text and a CHECK rejects anything that is not a real date. `last_checked` holds `YYYY-MM-DD HH:MM:SS`. Text in these formats sorts and compares correctly.
- Fixed vocabularies are TEXT with a CHECK (MySQL used `ENUM`): risk_level and threat_level (`low`, `medium`, `high`, `critical`), decision status, and estimated_size. Open-ended types (decision_type, analysis_type, event_type) are free text so new kinds need no migration.
- Booleans (`active`) are `0` / `1`.
- `financial_risk` and `market_risk` are 0 to 100 scores. `importance_score` is 1 to 10.
- `recommendations` is TEXT holding JSON, checked with `json_valid()`; `raw_response` is TEXT so a model reply is kept even if it is not valid JSON.
- Unique keys: one `financial_records` row per business per `record_date`, and one competitor name per business.
- Indexes follow the expected queries: per-business lists filtered by status, date, type or threat; price history by product and time; market events by competitor and date, and by date and importance for a cross-competitor feed.
- `AUTOINCREMENT` keeps MySQL's behaviour of never reusing a deleted id, so re-running `seed.sql` alone gives NovaFit a new id. `php database/build.php --fresh` brings it back to 1.
- SQLite allows one writer at a time. `api/db.php` waits up to 5 seconds for a busy database, which is plenty for a demo or a small team.
