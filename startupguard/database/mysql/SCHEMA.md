# StartupGuard database: relationships and checks

Database: `startupguard_db` (MySQL 8.0.16+, InnoDB, utf8mb4_unicode_ci). Source: `schema.sql`.

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

All foreign keys also use `ON UPDATE CASCADE` (ids are AUTO_INCREMENT and never change in practice). Every child type matches its parent exactly (`INT UNSIGNED`), and every FK column is the leading column of an index, which InnoDB requires.

Deleting one business removes everything below it in one statement: its financials, products, decisions, analyses, competitors, their products, events and price history.

## Price history is never overwritten

- `competitor_products` holds the live `current_price`.
- Trigger `trg_competitor_products_ai_price` writes the first `price_history` row when a product is inserted.
- Trigger `trg_competitor_products_au_price` appends a new row whenever `current_price` or `currency` changes. Other edits (name, active, last_checked) add nothing.
- Triggers `trg_price_history_bu_block` and `trg_price_history_bd_block` reject any `UPDATE` or direct `DELETE` on `price_history`.
- Deleting the parent product still clears its history, because InnoDB cascades do not fire triggers.

So the PHP API only ever updates `competitor_products.current_price`. It must not insert into `price_history` itself, or each change would be logged twice.

## Extra safeguard

`ai_analysis` has both `business_id` and an optional `business_decision_id`. A foreign key alone would allow an analysis of business A to point at a decision of business B. Triggers `trg_ai_analysis_bi_decision` / `_bu_decision` reject that. (A composite FK cannot do it here, because `ON DELETE SET NULL` would also try to null the required `business_id`.)

## Verification

### No circular relationships

Every foreign key points one level up the tree above. Ordering the tables by depth (businesses 0; financial_records, products, business_decisions, competitors 1; ai_analysis, competitor_products, market_events 2; price_history 3), every FK goes from a deeper table to a shallower one, so no chain of references can return to where it started. No table references itself.

`ai_analysis` has two paths to `businesses` (directly, and through `business_decisions`). That is a diamond, not a cycle. When a business is deleted, MySQL cascades both paths without conflict: the analysis row is deleted directly. This was tested.

### No invalid constraints

Checked by loading `schema.sql` into MySQL 8.0.46 (twice, to confirm it re-runs cleanly) and exercising it:

| Test | Result |
|---|---|
| All 9 tables created as InnoDB, utf8mb4_unicode_ci | Pass |
| 9 foreign keys present with the delete rules above | Pass |
| Insert product at 10.00, change to 12.50, edit `active`, change to 11.00 | 3 history rows (10.00, 12.50, 11.00) |
| `UPDATE` / `DELETE` on price_history | Rejected |
| Analysis linked to another business's decision | Rejected |
| financial_risk 101, market share 150%, importance 11 | Rejected by CHECK |
| Product for a non-existent business | Rejected by FK |
| Delete a decision | Its analysis kept, `business_decision_id` set to NULL |
| Delete a competitor product | Its price history removed |
| Delete a business | Its competitors, events, analyses and decisions removed; the other business untouched |

## Design choices worth knowing

- Money: `DECIMAL(15,2)` for business-level amounts, `DECIMAL(12,2)` for unit prices. Currency is a 3-letter ISO code (`CHAR(3)`, default `USD`).
- Dates: `DATE` for calendar dates (record_date, decision_date, event_date), `TIMESTAMP` for row times, `DATETIME` for `last_checked`.
- Fixed vocabularies use `ENUM`: risk_level and threat_level (`low`, `medium`, `high`, `critical`), decision status, and estimated_size. Open-ended types (decision_type, analysis_type, event_type) are `VARCHAR(50)` so new kinds need no migration.
- `financial_risk` and `market_risk` are 0 to 100 scores. `importance_score` is 1 to 10.
- `recommendations` is `JSON`; `raw_response` is `LONGTEXT` so a model reply is kept even if it is not valid JSON.
- Unique keys: one `financial_records` row per business per `record_date`, and one competitor name per business.
- Indexes follow the expected queries: per-business lists filtered by status, date, type or threat; price history by product and time; market events by competitor and date, and by date and importance for a cross-competitor feed.
- Requires the `mysql` command-line client to load (the triggers use `DELIMITER`), not a single PDO `exec()`.
