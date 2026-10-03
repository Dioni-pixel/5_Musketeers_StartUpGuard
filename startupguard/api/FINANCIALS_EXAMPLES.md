# Financials API: example requests

Base URL below assumes the PHP built-in server started from the `startupguard/` folder:

```bash
php -S localhost:8000 -t .
BASE=http://localhost:8000/api/financials.php
```

The NovaFit seed has 6 records for `business_id=1`, April to September 2026. Expected results below assume a freshly built database (`php database/build.php --fresh`). Tested on SQLite 3.45.1.

## GET

| Request | Expected |
|---|---|
| `curl "$BASE?business_id=1"` | 200, all 6 records, 2026-04-01 to 2026-09-01 |
| `curl "$BASE?business_id=1&limit=3"` | 200, the latest 3: Jul, Aug, Sep (oldest first) |
| `curl "$BASE?business_id=1&start_date=2026-06-01&end_date=2026-08-31"` | 200, Jun, Jul, Aug |
| `curl "$BASE?business_id=1&start_date=2026-05-01&limit=2"` | 200, Aug, Sep |
| `curl "$BASE?business_id=1&start_date=2030-01-01"` | 200, `count: 0`, empty `records` |
| `curl "$BASE"` | 400 `business_id is required.` |
| `curl "$BASE?business_id=abc"` | 400 VALIDATION_ERROR |
| `curl "$BASE?business_id=0"` | 400 VALIDATION_ERROR |
| `curl "$BASE?business_id=999"` | 404 BUSINESS_NOT_FOUND |
| `curl "$BASE?business_id=1&start_date=2026-02-30"` | 400 invalid date |
| `curl "$BASE?business_id=1&start_date=2026-09-01&end_date=2026-01-01"` | 400 start after end |
| `curl "$BASE?business_id=1&limit=0"` / `limit=501` / `limit=2.5` | 400 |
| `curl -X DELETE "$BASE?business_id=1"` | 405, `Allow: GET, POST` |

Each record comes back with numbers as JSON numbers plus two computed fields, `profit` (revenue minus expenses) and `profit_margin` (percent of revenue, null when revenue is 0):

```json
{
  "success": true,
  "data": {
    "business_id": 1,
    "filters": { "start_date": null, "end_date": null, "limit": 3 },
    "count": 3,
    "records": [
      { "id": 6, "business_id": 1, "record_date": "2026-09-01",
        "revenue": 20000.0, "expenses": 24000.0, "salaries": 12600.0,
        "marketing_cost": 5200.0, "operational_cost": 4700.0, "other_cost": 1500.0,
        "customer_count": 520, "profit": -4000.0, "profit_margin": -20.0,
        "notes": "Back-to-school push. Two new hires. Loss doubled since April.",
        "created_at": "..." }
    ]
  },
  "message": null
}
```

## POST

Valid record (201 Created, returns the stored record):

```bash
curl -i -X POST "$BASE" -H "Content-Type: application/json" -d '{
  "business_id": 1,
  "record_date": "2026-10-01",
  "revenue": 20000,
  "expenses": 24000,
  "salaries": 12000,
  "marketing_cost": 4000,
  "operational_cost": 6000,
  "other_cost": 2000,
  "customer_count": 850,
  "notes": "October close."
}'
```

Run the same command again: **409 DUPLICATE_RECORD** (one record per business per date).

Decimals and numeric strings are accepted (201):

```bash
curl -X POST "$BASE" -H "Content-Type: application/json" -d '{
  "business_id": 1, "record_date": "2026-11-01",
  "revenue": "21000.50", "expenses": 24000.75,
  "salaries": 12000.25, "marketing_cost": 4000.50, "operational_cost": 6000, "other_cost": 2000,
  "customer_count": 860
}'
```

Rejected requests (change one field of the valid body):

| Change | Expected |
|---|---|
| `"expenses": 25000` (costs add up to 24000) | 400, expenses must equal the sum of the four costs |
| `"revenue": -100` | 400, amounts must be 0 or more |
| `"revenue": 1.005` | 400, at most 2 decimal places |
| `"revenue": "abc"`, `true`, `null` or `1e20` | 400 |
| `"business_id": 0`, `"abc"`, `1.5` or `"1 OR 1=1"` | 400 |
| `"business_id": 999` | 404 BUSINESS_NOT_FOUND |
| `"record_date": "2026-02-30"` or `"01/10/2026"` | 400 invalid date |
| `"customer_count": 8.5` or `-1` | 400 |
| `"notes": 123` | 400, notes must be a string or null |
| extra field such as `"profit": 5` | 400 Unknown field(s): profit |
| remove `revenue` | 400 Missing required field(s): revenue |
| body `{"business_id": 1,` (broken JSON) | 400 INVALID_JSON |
| body `[1, 2]` | 400 INVALID_JSON |
| empty body | 400 EMPTY_BODY |

## Reset the demo data

POST tests add rows. To get back to the 6 seed records with NovaFit as `business_id=1`, rebuild the database:

```bash
php database/build.php --fresh
```

Or delete only the test rows (the `sqlite3` tool is optional; any SQLite browser works):

```bash
sqlite3 database/startupguard.sqlite "DELETE FROM financial_records WHERE business_id = 1 AND record_date >= '2026-10-01';"
```

Re-running `seed.sql` on its own also works, but NovaFit then gets a new id (2, 3, ...) because it is deleted and re-inserted.
