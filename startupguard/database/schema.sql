-- =====================================================================
-- StartupGuard - database schema
-- SQLite 3.25+ (the app turns foreign keys on for every connection)
--
-- Build the database file (recommended, needs only PHP):
--   php database/build.php
-- or with the sqlite3 command-line tool:
--   sqlite3 database/startupguard.sqlite < database/schema.sql
--
-- Safe to re-run: tables and indexes use IF NOT EXISTS, triggers are
-- recreated.
--
-- Relationship tree (every arrow is a 1:N foreign key):
--
--   businesses
--   ├── financial_records         ON DELETE CASCADE
--   ├── products                  ON DELETE CASCADE
--   ├── business_decisions        ON DELETE CASCADE
--   │     └── ai_analysis         ON DELETE SET NULL (business_decision_id)
--   ├── ai_analysis               ON DELETE CASCADE  (business_id)
--   └── competitors               ON DELETE CASCADE
--         ├── market_events       ON DELETE CASCADE
--         └── competitor_products ON DELETE CASCADE
--               └── price_history ON DELETE CASCADE
--
-- SQLite notes (more in SCHEMA.md):
--   * Foreign keys are only enforced when PRAGMA foreign_keys = ON is set
--     on the connection. api/db.php and build.php do this.
--   * Money columns are NUMERIC; times are UTC text 'YYYY-MM-DD HH:MM:SS'.
--   * ENUMs are TEXT with a CHECK, BOOLEANs are 0/1, JSON is TEXT checked
--     with json_valid().
--   * MySQL's ON UPDATE CURRENT_TIMESTAMP is done by triggers.
-- The original MySQL version is kept in database/mysql/.
-- =====================================================================

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------
-- app_clock: normally empty. While it holds its one row, the triggers
-- below use that time instead of the real clock. seed.sql uses it to give
-- the demo price history past dates (SQLite has no session clock).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS app_clock (
  id   INTEGER NOT NULL PRIMARY KEY CHECK (id = 1),
  now  TEXT    NOT NULL CHECK (now IS datetime(now))
);

-- ---------------------------------------------------------------------
-- businesses: the company being analysed (root of every relationship)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id              INTEGER        NOT NULL PRIMARY KEY AUTOINCREMENT,
  name            VARCHAR(150)   NOT NULL,
  industry        VARCHAR(100)   NULL,
  description     TEXT           NULL,
  city            VARCHAR(100)   NULL,
  country         VARCHAR(100)   NULL,
  website         VARCHAR(255)   NULL,
  employee_count  INTEGER        NOT NULL DEFAULT 0,
  cash_balance    NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  currency        CHAR(3)        NOT NULL DEFAULT 'USD',
  founded_year    INTEGER        NULL,
  created_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_businesses_employee_count CHECK (employee_count >= 0),
  CONSTRAINT chk_businesses_founded_year
    CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2100)
);
CREATE INDEX IF NOT EXISTS idx_businesses_name     ON businesses (name);
CREATE INDEX IF NOT EXISTS idx_businesses_industry ON businesses (industry);
CREATE INDEX IF NOT EXISTS idx_businesses_location ON businesses (country, city);

-- ---------------------------------------------------------------------
-- financial_records: one row per business per period (e.g. month)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_records (
  id                INTEGER        NOT NULL PRIMARY KEY AUTOINCREMENT,
  business_id       INTEGER        NOT NULL,
  record_date       DATE           NOT NULL,
  revenue           NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  expenses          NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  salaries          NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  marketing_cost    NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  operational_cost  NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  other_cost        NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  customer_count    INTEGER        NOT NULL DEFAULT 0,
  notes             TEXT           NULL,
  created_at        TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- One record per business per date. Also serves business_id lookups
  -- and date-range queries for the dashboard.
  CONSTRAINT uq_financial_records_business_date UNIQUE (business_id, record_date),
  CONSTRAINT chk_financial_records_date CHECK (record_date IS date(record_date)),
  CONSTRAINT chk_financial_records_customer_count CHECK (customer_count >= 0),
  CONSTRAINT fk_financial_records_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);

-- ---------------------------------------------------------------------
-- products: the business's own products / services
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           INTEGER        NOT NULL PRIMARY KEY AUTOINCREMENT,
  business_id  INTEGER        NOT NULL,
  name         VARCHAR(150)   NOT NULL,
  description  TEXT           NULL,
  category     VARCHAR(100)   NULL,
  price        NUMERIC(12,2)  NOT NULL DEFAULT 0.00,
  cost         NUMERIC(12,2)  NOT NULL DEFAULT 0.00,
  active       BOOLEAN        NOT NULL DEFAULT 1,
  created_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_products_price  CHECK (price >= 0),
  CONSTRAINT chk_products_cost   CHECK (cost >= 0),
  CONSTRAINT chk_products_active CHECK (active IN (0, 1)),
  CONSTRAINT fk_products_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_products_business_active ON products (business_id, active);
CREATE INDEX IF NOT EXISTS idx_products_category        ON products (category);

-- ---------------------------------------------------------------------
-- business_decisions: planned / taken decisions and their outcomes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_decisions (
  id                            INTEGER        NOT NULL PRIMARY KEY AUTOINCREMENT,
  business_id                   INTEGER        NOT NULL,
  title                         VARCHAR(200)   NOT NULL,
  description                   TEXT           NULL,
  decision_type                 VARCHAR(50)    NOT NULL,  -- e.g. hiring, pricing, marketing, expansion, product
  status                        TEXT           NOT NULL DEFAULT 'proposed',
  estimated_cost                NUMERIC(15,2)  NOT NULL DEFAULT 0.00,
  expected_revenue_change       NUMERIC(15,2)  NULL,      -- monthly, can be negative
  expected_monthly_cost_change  NUMERIC(15,2)  NULL,      -- can be negative
  expected_customer_change      INTEGER        NULL,      -- can be negative
  risk_level                    TEXT           NULL,
  ai_recommendation             TEXT           NULL,
  actual_outcome                TEXT           NULL,
  decision_date                 DATE           NULL,
  created_at                    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_business_decisions_status
    CHECK (status IN ('proposed', 'approved', 'rejected', 'implemented', 'cancelled')),
  CONSTRAINT chk_business_decisions_risk_level
    CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_business_decisions_estimated_cost CHECK (estimated_cost >= 0),
  CONSTRAINT chk_business_decisions_date
    CHECK (decision_date IS NULL OR decision_date IS date(decision_date)),
  CONSTRAINT fk_business_decisions_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_business_decisions_business_status ON business_decisions (business_id, status);
CREATE INDEX IF NOT EXISTS idx_business_decisions_business_date   ON business_decisions (business_id, decision_date);
CREATE INDEX IF NOT EXISTS idx_business_decisions_type            ON business_decisions (decision_type);

-- ---------------------------------------------------------------------
-- ai_analysis: stored AI results, optionally tied to one decision
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_analysis (
  id                    INTEGER       NOT NULL PRIMARY KEY AUTOINCREMENT,
  business_id           INTEGER       NOT NULL,
  business_decision_id  INTEGER       NULL,
  analysis_type         VARCHAR(50)   NOT NULL,  -- e.g. financial_health, decision, competitor, growth
  risk_level            TEXT          NULL,
  financial_risk        INTEGER       NULL,      -- score 0-100
  market_risk           INTEGER       NULL,      -- score 0-100
  summary               TEXT          NULL,
  recommendations       TEXT          NULL,      -- JSON
  raw_response          TEXT          NULL,      -- full model output, kept even when it is not valid JSON
  model_used            VARCHAR(100)  NULL,
  created_at            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_ai_analysis_risk_level
    CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_ai_analysis_financial_risk CHECK (financial_risk IS NULL OR financial_risk BETWEEN 0 AND 100),
  CONSTRAINT chk_ai_analysis_market_risk    CHECK (market_risk IS NULL OR market_risk BETWEEN 0 AND 100),
  CONSTRAINT chk_ai_analysis_recommendations
    CHECK (recommendations IS NULL OR json_valid(recommendations)),
  CONSTRAINT fk_ai_analysis_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_analysis_decision
    FOREIGN KEY (business_decision_id) REFERENCES business_decisions (id)
    ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_business_created ON ai_analysis (business_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_business_type    ON ai_analysis (business_id, analysis_type);
CREATE INDEX IF NOT EXISTS idx_ai_analysis_decision         ON ai_analysis (business_decision_id);

-- ---------------------------------------------------------------------
-- competitors: companies competing with a given business
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitors (
  id                      INTEGER       NOT NULL PRIMARY KEY AUTOINCREMENT,
  business_id             INTEGER       NOT NULL,
  name                    VARCHAR(150)  NOT NULL,
  website                 VARCHAR(255)  NULL,
  industry                VARCHAR(100)  NULL,
  city                    VARCHAR(100)  NULL,
  country                 VARCHAR(100)  NULL,
  description             TEXT          NULL,
  estimated_size          TEXT          NULL,
  estimated_market_share  NUMERIC(5,2)  NULL,  -- percent, 0.00-100.00
  threat_level            TEXT          NOT NULL DEFAULT 'medium',
  source_url              VARCHAR(500)  NULL,
  last_updated            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT uq_competitors_business_name UNIQUE (business_id, name),
  CONSTRAINT chk_competitors_estimated_size
    CHECK (estimated_size IS NULL OR estimated_size IN ('micro', 'small', 'medium', 'large', 'enterprise')),
  CONSTRAINT chk_competitors_threat_level
    CHECK (threat_level IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT chk_competitors_market_share
    CHECK (estimated_market_share IS NULL OR estimated_market_share BETWEEN 0 AND 100),
  CONSTRAINT fk_competitors_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_competitors_business_threat ON competitors (business_id, threat_level);
CREATE INDEX IF NOT EXISTS idx_competitors_industry        ON competitors (industry);

-- ---------------------------------------------------------------------
-- competitor_products: what each competitor sells, with its live price
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_products (
  id             INTEGER        NOT NULL PRIMARY KEY AUTOINCREMENT,
  competitor_id  INTEGER        NOT NULL,
  name           VARCHAR(150)   NOT NULL,
  description    TEXT           NULL,
  category       VARCHAR(100)   NULL,
  current_price  NUMERIC(12,2)  NOT NULL,
  currency       CHAR(3)        NOT NULL DEFAULT 'USD',
  product_url    VARCHAR(500)   NULL,
  active         BOOLEAN        NOT NULL DEFAULT 1,
  last_checked   DATETIME       NULL,
  created_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_competitor_products_price  CHECK (current_price >= 0),
  CONSTRAINT chk_competitor_products_active CHECK (active IN (0, 1)),
  CONSTRAINT chk_competitor_products_last_checked
    CHECK (last_checked IS NULL OR last_checked IS datetime(last_checked)),
  CONSTRAINT fk_competitor_products_competitor
    FOREIGN KEY (competitor_id) REFERENCES competitors (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_competitor_products_competitor_active ON competitor_products (competitor_id, active);
CREATE INDEX IF NOT EXISTS idx_competitor_products_category          ON competitor_products (category);

-- ---------------------------------------------------------------------
-- market_events: deals, launches, funding, news about a competitor
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_events (
  id                INTEGER       NOT NULL PRIMARY KEY AUTOINCREMENT,
  competitor_id     INTEGER       NOT NULL,
  event_type        VARCHAR(50)   NOT NULL,  -- e.g. product_launch, price_change, deal, funding, partnership, news
  title             VARCHAR(255)  NOT NULL,
  description       TEXT          NULL,
  event_date        DATE          NOT NULL,
  source_name       VARCHAR(150)  NULL,
  source_url        VARCHAR(500)  NULL,
  importance_score  INTEGER       NOT NULL DEFAULT 5,  -- 1 (minor) to 10 (critical)
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT chk_market_events_date       CHECK (event_date IS date(event_date)),
  CONSTRAINT chk_market_events_importance CHECK (importance_score BETWEEN 1 AND 10),
  CONSTRAINT fk_market_events_competitor
    FOREIGN KEY (competitor_id) REFERENCES competitors (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_market_events_competitor_date ON market_events (competitor_id, event_date);
CREATE INDEX IF NOT EXISTS idx_market_events_type            ON market_events (event_type);
CREATE INDEX IF NOT EXISTS idx_market_events_date_importance ON market_events (event_date, importance_score);

-- ---------------------------------------------------------------------
-- price_history: append-only log of competitor_products prices.
-- Rows are written by the triggers below. The app never inserts,
-- updates or deletes them directly.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
  id                     INTEGER        NOT NULL PRIMARY KEY AUTOINCREMENT,
  competitor_product_id  INTEGER        NOT NULL,
  price                  NUMERIC(12,2)  NOT NULL,
  currency               CHAR(3)        NOT NULL DEFAULT 'USD',
  recorded_at            TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_url             VARCHAR(500)   NULL,
  CONSTRAINT chk_price_history_price CHECK (price >= 0),
  CONSTRAINT fk_price_history_competitor_product
    FOREIGN KEY (competitor_product_id) REFERENCES competitor_products (id)
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_price_history_product_recorded ON price_history (competitor_product_id, recorded_at);

-- =====================================================================
-- Triggers
-- =====================================================================
DROP TRIGGER IF EXISTS trg_competitor_products_ai_price;
DROP TRIGGER IF EXISTS trg_competitor_products_au_price;
DROP TRIGGER IF EXISTS trg_price_history_bu_block;
DROP TRIGGER IF EXISTS trg_price_history_bd_block;
DROP TRIGGER IF EXISTS trg_ai_analysis_bi_decision;
DROP TRIGGER IF EXISTS trg_ai_analysis_bu_decision;
DROP TRIGGER IF EXISTS trg_businesses_au_updated_at;
DROP TRIGGER IF EXISTS trg_products_au_updated_at;
DROP TRIGGER IF EXISTS trg_business_decisions_au_updated_at;
DROP TRIGGER IF EXISTS trg_competitors_au_last_updated;
DROP TRIGGER IF EXISTS trg_competitor_products_au_updated_at;

-- A new competitor product starts its price history with its first price.
CREATE TRIGGER trg_competitor_products_ai_price
AFTER INSERT ON competitor_products
FOR EACH ROW
BEGIN
  INSERT INTO price_history (competitor_product_id, price, currency, recorded_at, source_url)
  VALUES (NEW.id, NEW.current_price, NEW.currency,
          COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP), NEW.product_url);
END;

-- Whenever current_price (or its currency) changes, append a new row.
CREATE TRIGGER trg_competitor_products_au_price
AFTER UPDATE OF current_price, currency ON competitor_products
FOR EACH ROW
WHEN NEW.current_price IS NOT OLD.current_price OR NEW.currency IS NOT OLD.currency
BEGIN
  INSERT INTO price_history (competitor_product_id, price, currency, recorded_at, source_url)
  VALUES (NEW.id, NEW.current_price, NEW.currency,
          COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP), NEW.product_url);
END;

-- Price history is append-only: existing rows can never be changed.
-- Only ON UPDATE CASCADE from a product whose id changed gets through
-- (its old row is gone by then); ids never change in practice.
CREATE TRIGGER trg_price_history_bu_block
BEFORE UPDATE ON price_history
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM competitor_products WHERE id = OLD.competitor_product_id)
BEGIN
  SELECT RAISE(ABORT, 'price_history is append-only: rows cannot be updated');
END;

-- Direct deletes are blocked too. Unlike MySQL, SQLite cascades DO fire
-- triggers, so the block only applies while the parent product exists.
-- Deleting the product (or its competitor or business) removes the
-- parent first, and the cascade then clears its history.
CREATE TRIGGER trg_price_history_bd_block
BEFORE DELETE ON price_history
FOR EACH ROW
WHEN EXISTS (SELECT 1 FROM competitor_products WHERE id = OLD.competitor_product_id)
BEGIN
  SELECT RAISE(ABORT, 'price_history is append-only: rows cannot be deleted');
END;

-- An analysis may only point at a decision of the same business.
CREATE TRIGGER trg_ai_analysis_bi_decision
BEFORE INSERT ON ai_analysis
FOR EACH ROW
WHEN NEW.business_decision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM business_decisions
  WHERE id = NEW.business_decision_id AND business_id = NEW.business_id
)
BEGIN
  SELECT RAISE(ABORT, 'ai_analysis.business_decision_id must belong to the same business');
END;

CREATE TRIGGER trg_ai_analysis_bu_decision
BEFORE UPDATE ON ai_analysis
FOR EACH ROW
WHEN NEW.business_decision_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM business_decisions
  WHERE id = NEW.business_decision_id AND business_id = NEW.business_id
)
BEGIN
  SELECT RAISE(ABORT, 'ai_analysis.business_decision_id must belong to the same business');
END;

-- MySQL's ON UPDATE CURRENT_TIMESTAMP: refresh the row time on every
-- update, unless the statement set that column itself.
CREATE TRIGGER trg_businesses_au_updated_at
AFTER UPDATE ON businesses
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE businesses SET updated_at = COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_products_au_updated_at
AFTER UPDATE ON products
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE products SET updated_at = COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_business_decisions_au_updated_at
AFTER UPDATE ON business_decisions
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE business_decisions SET updated_at = COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_competitors_au_last_updated
AFTER UPDATE ON competitors
FOR EACH ROW
WHEN NEW.last_updated IS OLD.last_updated
BEGIN
  UPDATE competitors SET last_updated = COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP)
  WHERE id = NEW.id;
END;

CREATE TRIGGER trg_competitor_products_au_updated_at
AFTER UPDATE ON competitor_products
FOR EACH ROW
WHEN NEW.updated_at IS OLD.updated_at
BEGIN
  UPDATE competitor_products SET updated_at = COALESCE((SELECT now FROM app_clock), CURRENT_TIMESTAMP)
  WHERE id = NEW.id;
END;
