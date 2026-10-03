-- =====================================================================
-- StartupGuard - database schema
-- MySQL 8.0.16+ (CHECK constraints are enforced from 8.0.16)
-- Engine: InnoDB | Charset: utf8mb4 / utf8mb4_unicode_ci
--
-- Load with the mysql client (the triggers use DELIMITER):
--   mysql -u root -p < database/schema.sql
--
-- Safe to re-run: tables use IF NOT EXISTS, triggers are recreated.
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
-- =====================================================================

CREATE DATABASE IF NOT EXISTS startupguard_db
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE startupguard_db;

-- ---------------------------------------------------------------------
-- businesses: the company being analysed (root of every relationship)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS businesses (
  id              INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  name            VARCHAR(150)      NOT NULL,
  industry        VARCHAR(100)      NULL,
  description     TEXT              NULL,
  city            VARCHAR(100)      NULL,
  country         VARCHAR(100)      NULL,
  website         VARCHAR(255)      NULL,
  employee_count  INT UNSIGNED      NOT NULL DEFAULT 0,
  cash_balance    DECIMAL(15,2)     NOT NULL DEFAULT 0.00,
  currency        CHAR(3)           NOT NULL DEFAULT 'USD',
  founded_year    SMALLINT UNSIGNED NULL,
  created_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_businesses_name (name),
  KEY idx_businesses_industry (industry),
  KEY idx_businesses_location (country, city),
  CONSTRAINT chk_businesses_founded_year
    CHECK (founded_year IS NULL OR founded_year BETWEEN 1800 AND 2100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- financial_records: one row per business per period (e.g. month)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS financial_records (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  business_id       INT UNSIGNED  NOT NULL,
  record_date       DATE          NOT NULL,
  revenue           DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  expenses          DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  salaries          DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  marketing_cost    DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  operational_cost  DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  other_cost        DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  customer_count    INT UNSIGNED  NOT NULL DEFAULT 0,
  notes             TEXT          NULL,
  created_at        TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  -- One record per business per date. Also serves business_id lookups
  -- and date-range queries for the dashboard.
  UNIQUE KEY uq_financial_records_business_date (business_id, record_date),
  CONSTRAINT fk_financial_records_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- products: the business's own products / services
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  business_id  INT UNSIGNED  NOT NULL,
  name         VARCHAR(150)  NOT NULL,
  description  TEXT          NULL,
  category     VARCHAR(100)  NULL,
  price        DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  cost         DECIMAL(12,2) NOT NULL DEFAULT 0.00,
  active       BOOLEAN       NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_products_business_active (business_id, active),
  KEY idx_products_category (category),
  CONSTRAINT chk_products_price CHECK (price >= 0),
  CONSTRAINT chk_products_cost  CHECK (cost >= 0),
  CONSTRAINT fk_products_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- business_decisions: planned / taken decisions and their outcomes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS business_decisions (
  id                            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  business_id                   INT UNSIGNED  NOT NULL,
  title                         VARCHAR(200)  NOT NULL,
  description                   TEXT          NULL,
  decision_type                 VARCHAR(50)   NOT NULL,  -- e.g. hiring, pricing, marketing, expansion, product
  status                        ENUM('proposed','approved','rejected','implemented','cancelled')
                                              NOT NULL DEFAULT 'proposed',
  estimated_cost                DECIMAL(15,2) NOT NULL DEFAULT 0.00,
  expected_revenue_change       DECIMAL(15,2) NULL,      -- monthly, can be negative
  expected_monthly_cost_change  DECIMAL(15,2) NULL,      -- can be negative
  expected_customer_change      INT           NULL,      -- can be negative
  risk_level                    ENUM('low','medium','high','critical') NULL,
  ai_recommendation             TEXT          NULL,
  actual_outcome                TEXT          NULL,
  decision_date                 DATE          NULL,
  created_at                    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_business_decisions_business_status (business_id, status),
  KEY idx_business_decisions_business_date (business_id, decision_date),
  KEY idx_business_decisions_type (decision_type),
  CONSTRAINT chk_business_decisions_estimated_cost CHECK (estimated_cost >= 0),
  CONSTRAINT fk_business_decisions_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- ai_analysis: stored AI results, optionally tied to one decision
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ai_analysis (
  id                    INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  business_id           INT UNSIGNED     NOT NULL,
  business_decision_id  INT UNSIGNED     NULL,
  analysis_type         VARCHAR(50)      NOT NULL,  -- e.g. financial_health, decision, competitor, growth
  risk_level            ENUM('low','medium','high','critical') NULL,
  financial_risk        TINYINT UNSIGNED NULL,      -- score 0-100
  market_risk           TINYINT UNSIGNED NULL,      -- score 0-100
  summary               TEXT             NULL,
  recommendations       JSON             NULL,
  raw_response          LONGTEXT         NULL,      -- full model output, kept even when it is not valid JSON
  model_used            VARCHAR(100)     NULL,
  created_at            TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ai_analysis_business_created (business_id, created_at),
  KEY idx_ai_analysis_business_type (business_id, analysis_type),
  KEY idx_ai_analysis_decision (business_decision_id),
  CONSTRAINT chk_ai_analysis_financial_risk CHECK (financial_risk IS NULL OR financial_risk <= 100),
  CONSTRAINT chk_ai_analysis_market_risk    CHECK (market_risk IS NULL OR market_risk <= 100),
  CONSTRAINT fk_ai_analysis_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ai_analysis_decision
    FOREIGN KEY (business_decision_id) REFERENCES business_decisions (id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- competitors: companies competing with a given business
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitors (
  id                      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  business_id             INT UNSIGNED  NOT NULL,
  name                    VARCHAR(150)  NOT NULL,
  website                 VARCHAR(255)  NULL,
  industry                VARCHAR(100)  NULL,
  city                    VARCHAR(100)  NULL,
  country                 VARCHAR(100)  NULL,
  description             TEXT          NULL,
  estimated_size          ENUM('micro','small','medium','large','enterprise') NULL,
  estimated_market_share  DECIMAL(5,2)  NULL,  -- percent, 0.00-100.00
  threat_level            ENUM('low','medium','high','critical') NOT NULL DEFAULT 'medium',
  source_url              VARCHAR(500)  NULL,
  last_updated            TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at              TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_competitors_business_name (business_id, name),
  KEY idx_competitors_business_threat (business_id, threat_level),
  KEY idx_competitors_industry (industry),
  CONSTRAINT chk_competitors_market_share
    CHECK (estimated_market_share IS NULL OR estimated_market_share BETWEEN 0 AND 100),
  CONSTRAINT fk_competitors_business
    FOREIGN KEY (business_id) REFERENCES businesses (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- competitor_products: what each competitor sells, with its live price
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS competitor_products (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  competitor_id  INT UNSIGNED  NOT NULL,
  name           VARCHAR(150)  NOT NULL,
  description    TEXT          NULL,
  category       VARCHAR(100)  NULL,
  current_price  DECIMAL(12,2) NOT NULL,
  currency       CHAR(3)       NOT NULL DEFAULT 'USD',
  product_url    VARCHAR(500)  NULL,
  active         BOOLEAN       NOT NULL DEFAULT TRUE,
  last_checked   DATETIME      NULL,
  created_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_competitor_products_competitor_active (competitor_id, active),
  KEY idx_competitor_products_category (category),
  CONSTRAINT chk_competitor_products_price CHECK (current_price >= 0),
  CONSTRAINT fk_competitor_products_competitor
    FOREIGN KEY (competitor_id) REFERENCES competitors (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- market_events: deals, launches, funding, news about a competitor
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS market_events (
  id                INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  competitor_id     INT UNSIGNED     NOT NULL,
  event_type        VARCHAR(50)      NOT NULL,  -- e.g. product_launch, price_change, deal, funding, partnership, news
  title             VARCHAR(255)     NOT NULL,
  description       TEXT             NULL,
  event_date        DATE             NOT NULL,
  source_name       VARCHAR(150)     NULL,
  source_url        VARCHAR(500)     NULL,
  importance_score  TINYINT UNSIGNED NOT NULL DEFAULT 5,  -- 1 (minor) to 10 (critical)
  created_at        TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_market_events_competitor_date (competitor_id, event_date),
  KEY idx_market_events_type (event_type),
  KEY idx_market_events_date_importance (event_date, importance_score),
  CONSTRAINT chk_market_events_importance CHECK (importance_score BETWEEN 1 AND 10),
  CONSTRAINT fk_market_events_competitor
    FOREIGN KEY (competitor_id) REFERENCES competitors (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- price_history: append-only log of competitor_products prices.
-- Rows are written by the triggers below. The app never inserts,
-- updates or deletes them directly.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS price_history (
  id                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  competitor_product_id  INT UNSIGNED    NOT NULL,
  price                  DECIMAL(12,2)   NOT NULL,
  currency               CHAR(3)         NOT NULL DEFAULT 'USD',
  recorded_at            TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  source_url             VARCHAR(500)    NULL,
  PRIMARY KEY (id),
  KEY idx_price_history_product_recorded (competitor_product_id, recorded_at),
  CONSTRAINT chk_price_history_price CHECK (price >= 0),
  CONSTRAINT fk_price_history_competitor_product
    FOREIGN KEY (competitor_product_id) REFERENCES competitor_products (id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- =====================================================================
-- Triggers
-- =====================================================================
DROP TRIGGER IF EXISTS trg_competitor_products_ai_price;
DROP TRIGGER IF EXISTS trg_competitor_products_au_price;
DROP TRIGGER IF EXISTS trg_price_history_bu_block;
DROP TRIGGER IF EXISTS trg_price_history_bd_block;
DROP TRIGGER IF EXISTS trg_ai_analysis_bi_decision;
DROP TRIGGER IF EXISTS trg_ai_analysis_bu_decision;

DELIMITER $$

-- A new competitor product starts its price history with its first price.
CREATE TRIGGER trg_competitor_products_ai_price
AFTER INSERT ON competitor_products
FOR EACH ROW
BEGIN
  INSERT INTO price_history (competitor_product_id, price, currency, source_url)
  VALUES (NEW.id, NEW.current_price, NEW.currency, NEW.product_url);
END$$

-- Whenever current_price (or its currency) changes, append a new row.
CREATE TRIGGER trg_competitor_products_au_price
AFTER UPDATE ON competitor_products
FOR EACH ROW
BEGIN
  IF NEW.current_price <> OLD.current_price OR NEW.currency <> OLD.currency THEN
    INSERT INTO price_history (competitor_product_id, price, currency, source_url)
    VALUES (NEW.id, NEW.current_price, NEW.currency, NEW.product_url);
  END IF;
END$$

-- Price history is append-only: existing rows can never be changed.
CREATE TRIGGER trg_price_history_bu_block
BEFORE UPDATE ON price_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'price_history is append-only: rows cannot be updated';
END$$

-- Direct deletes are blocked too. Deleting the parent competitor_product
-- still removes its history, because InnoDB cascades do not fire triggers.
CREATE TRIGGER trg_price_history_bd_block
BEFORE DELETE ON price_history
FOR EACH ROW
BEGIN
  SIGNAL SQLSTATE '45000'
    SET MESSAGE_TEXT = 'price_history is append-only: rows cannot be deleted';
END$$

-- An analysis may only point at a decision of the same business.
CREATE TRIGGER trg_ai_analysis_bi_decision
BEFORE INSERT ON ai_analysis
FOR EACH ROW
BEGIN
  IF NEW.business_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_decisions
    WHERE id = NEW.business_decision_id AND business_id = NEW.business_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ai_analysis.business_decision_id must belong to the same business';
  END IF;
END$$

CREATE TRIGGER trg_ai_analysis_bu_decision
BEFORE UPDATE ON ai_analysis
FOR EACH ROW
BEGIN
  IF NEW.business_decision_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM business_decisions
    WHERE id = NEW.business_decision_id AND business_id = NEW.business_id
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'ai_analysis.business_decision_id must belong to the same business';
  END IF;
END$$

DELIMITER ;
