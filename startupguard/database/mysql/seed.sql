-- =====================================================================
-- StartupGuard - demo data: NovaFit (Fitness Technology, Prishtina)
-- Load AFTER schema.sql, with the mysql client:
--   mysql -u root -p < database/schema.sql
--   mysql -u root -p < database/seed.sql
--
-- Safe to re-run: the existing NovaFit business is deleted first, and the
-- foreign-key cascades remove everything that belongs to it.
--
-- Story the data tells (April - September 2026):
--   * Revenue grows 15,000 -> 20,000 (+33%), expenses 17,000 -> 24,000
--     (+41%). The monthly loss widens from 2,000 to 4,000.
--   * Marketing spend rises 73% while customers grow only 24%, so the
--     cost of each new customer is climbing.
--   * Cash is 120,000. At the September burn that is about 30 months of
--     runway; either proposed decision shortens it sharply.
--   * The biggest competitor (FitZone) is cutting prices and expanding,
--     a regional app (Activ8) undercuts the NovaFit app, while two others
--     raise prices.
--
-- price_history is never inserted directly. Its rows come from the
-- triggers on competitor_products. To give them realistic past dates,
-- this script moves the session clock with SET TIMESTAMP before each
-- insert / price change, and resets it at the end.
-- =====================================================================

USE startupguard_db;

SET NAMES utf8mb4;
SET time_zone = '+00:00';

START TRANSACTION;

-- Remove the previous demo copy (cascades to every child table).
DELETE FROM businesses WHERE name = 'NovaFit';

-- ---------------------------------------------------------------------
-- Business
-- ---------------------------------------------------------------------
SET TIMESTAMP = UNIX_TIMESTAMP('2026-04-01 08:00:00');

INSERT INTO businesses
  (name, industry, description, city, country, website,
   employee_count, cash_balance, currency, founded_year)
VALUES
  ('NovaFit', 'Fitness Technology',
   'Smart fitness studio in Prishtina combined with a training app. Members get studio classes, AI-planned workouts in the app and progress tracking; companies buy wellness plans for their teams.',
   'Prishtina', 'Kosovo', 'https://novafit.example',
   14, 120000.00, 'EUR', 2023);

SET @novafit = LAST_INSERT_ID();

-- ---------------------------------------------------------------------
-- Financial records: one row per month (record_date = first of month)
-- expenses = salaries + marketing_cost + operational_cost + other_cost
-- ---------------------------------------------------------------------
INSERT INTO financial_records
  (business_id, record_date, revenue, expenses, salaries, marketing_cost,
   operational_cost, other_cost, customer_count, notes)
VALUES
  (@novafit, '2026-04-01', 15000.00, 17000.00,  9500.00, 3000.00, 3500.00, 1000.00, 420,
   'Spring campaign launched on Instagram and TikTok.'),
  (@novafit, '2026-05-01', 16000.00, 18000.00,  9800.00, 3300.00, 3600.00, 1300.00, 445,
   'New part-time coach. App subscriptions up 6%.'),
  (@novafit, '2026-06-01', 17500.00, 19000.00, 10200.00, 3500.00, 3800.00, 1500.00, 470,
   'Best revenue month so far; corporate plan signed with a local bank.'),
  (@novafit, '2026-07-01', 18000.00, 20000.00, 10800.00, 3800.00, 4000.00, 1400.00, 480,
   'Summer slowdown in studio visits. Salary increases took effect.'),
  (@novafit, '2026-08-01', 19000.00, 22000.00, 11800.00, 4500.00, 4300.00, 1400.00, 500,
   'Extra paid ads to answer FitZone price cut. Energy costs up.'),
  (@novafit, '2026-09-01', 20000.00, 24000.00, 12600.00, 5200.00, 4700.00, 1500.00, 520,
   'Back-to-school push. Two new hires. Loss doubled since April.');

-- ---------------------------------------------------------------------
-- NovaFit products
-- ---------------------------------------------------------------------
INSERT INTO products
  (business_id, name, description, category, price, cost, active)
VALUES
  (@novafit, 'NovaFit Studio Membership',
   'Unlimited studio access and group classes, includes App Premium.',
   'Membership', 39.00, 21.00, TRUE),
  (@novafit, 'NovaFit App Premium',
   'AI-planned workouts, nutrition tips and progress tracking (app only).',
   'Subscription', 9.99, 2.50, TRUE),
  (@novafit, 'Personal Training Pack',
   'Eight one-to-one sessions with a certified coach.',
   'Personal Training', 160.00, 96.00, TRUE),
  (@novafit, 'Corporate Wellness Plan',
   'Monthly plan for teams of up to 25 employees: app access, two studio classes per week, quarterly health check.',
   'B2B', 299.00, 170.00, TRUE);

-- ---------------------------------------------------------------------
-- Competitors
-- ---------------------------------------------------------------------
INSERT INTO competitors
  (business_id, name, website, industry, city, country, description,
   estimated_size, estimated_market_share, threat_level, source_url)
VALUES
  (@novafit, 'FitZone Prishtina', 'https://fitzone.example', 'Gyms & Fitness Clubs',
   'Prishtina', 'Kosovo',
   'Largest gym chain in Kosovo, 5 clubs. Competes on price and convenience.',
   'medium', 28.00, 'high', 'https://fitzone.example/news'),
  (@novafit, 'Activ8', 'https://activ8.example', 'Fitness Apps',
   'Tirana', 'Albania',
   'Albanian-language fitness app growing fast across Albania and Kosovo. Cheaper than NovaFit App Premium.',
   'small', 12.00, 'high', 'https://activ8.example/blog'),
  (@novafit, 'PulseGym', 'https://pulsegym.example', 'Boutique Fitness',
   'Prishtina', 'Kosovo',
   'Boutique HIIT and spinning studio in the city centre. Premium pricing, strong community.',
   'micro', 6.00, 'medium', 'https://pulsegym.example'),
  (@novafit, 'Balkan Wellness Group', 'https://balkanwellness.example', 'Corporate Wellness',
   'Skopje', 'North Macedonia',
   'Corporate wellness provider entering Kosovo. Targets the same companies as NovaFit Corporate Wellness Plan.',
   'medium', 9.00, 'medium', 'https://balkanwellness.example/press');

SET @fitzone = (SELECT id FROM competitors WHERE business_id = @novafit AND name = 'FitZone Prishtina');
SET @activ8  = (SELECT id FROM competitors WHERE business_id = @novafit AND name = 'Activ8');
SET @pulse   = (SELECT id FROM competitors WHERE business_id = @novafit AND name = 'PulseGym');
SET @balkan  = (SELECT id FROM competitors WHERE business_id = @novafit AND name = 'Balkan Wellness Group');

-- ---------------------------------------------------------------------
-- Competitor products. The insert trigger writes the first price_history
-- row, dated 2026-04-01 by the session clock above.
-- ---------------------------------------------------------------------
INSERT INTO competitor_products
  (competitor_id, name, description, category, current_price, currency, product_url, last_checked)
VALUES
  (@fitzone, 'Monthly Membership',       'Access to all FitZone clubs.',          'Membership',         35.00, 'EUR', 'https://fitzone.example/monthly',          NOW()),
  (@fitzone, 'Annual Membership',        'Twelve months, paid upfront.',          'Membership',        360.00, 'EUR', 'https://fitzone.example/annual',           NOW()),
  (@fitzone, 'Personal Training 10x',    'Ten sessions with a FitZone trainer.',  'Personal Training', 150.00, 'EUR', 'https://fitzone.example/pt',               NOW()),
  (@activ8,  'Activ8 Premium',           'Workout plans and tracking, monthly.',  'Subscription',        7.99, 'EUR', 'https://activ8.example/premium',           NOW()),
  (@activ8,  'Activ8 Family',            'Premium for up to 4 people, monthly.',  'Subscription',       12.99, 'EUR', 'https://activ8.example/family',            NOW()),
  (@pulse,   'Unlimited Classes',        'Unlimited HIIT and spinning, monthly.', 'Membership',         55.00, 'EUR', 'https://pulsegym.example/unlimited',       NOW()),
  (@pulse,   '10-Class Pack',            'Ten classes, valid three months.',      'Class Pack',         80.00, 'EUR', 'https://pulsegym.example/10-pack',         NOW()),
  (@balkan,  'Corporate Wellness Basic', 'Monthly plan for teams up to 25.',      'B2B',               250.00, 'EUR', 'https://balkanwellness.example/basic',     NOW()),
  (@balkan,  'Team Challenge Program',   'Eight-week team fitness challenge.',    'B2B',               150.00, 'EUR', 'https://balkanwellness.example/challenge', NOW());

SET @fz_month  = (SELECT id FROM competitor_products WHERE competitor_id = @fitzone AND name = 'Monthly Membership');
SET @fz_annual = (SELECT id FROM competitor_products WHERE competitor_id = @fitzone AND name = 'Annual Membership');
SET @a8_prem   = (SELECT id FROM competitor_products WHERE competitor_id = @activ8  AND name = 'Activ8 Premium');
SET @pg_unl    = (SELECT id FROM competitor_products WHERE competitor_id = @pulse   AND name = 'Unlimited Classes');
SET @pg_pack   = (SELECT id FROM competitor_products WHERE competitor_id = @pulse   AND name = '10-Class Pack');
SET @bw_chal   = (SELECT id FROM competitor_products WHERE competitor_id = @balkan  AND name = 'Team Challenge Program');

-- ---------------------------------------------------------------------
-- Price changes over time. Each UPDATE appends one price_history row
-- dated by the session clock.
--   Decreases: FitZone Monthly 35 -> 32 -> 29, Activ8 Premium 7.99 -> 5.99
--   Increases: PulseGym Unlimited 55 -> 60 -> 65, PulseGym 10-pack 80 -> 90,
--              Balkan Team Challenge 150 -> 175
--   Down then partly up: FitZone Annual 360 -> 300 (summer promo) -> 320
--   Stable:    FitZone Personal Training, Activ8 Family, Balkan Basic
--              (one history row since April, re-checked on 2026-10-01)
-- ---------------------------------------------------------------------
SET TIMESTAMP = UNIX_TIMESTAMP('2026-05-12 09:00:00');
UPDATE competitor_products SET current_price = 60.00,  last_checked = NOW() WHERE id = @pg_unl;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-06-03 09:00:00');
UPDATE competitor_products SET current_price = 32.00,  last_checked = NOW() WHERE id = @fz_month;
UPDATE competitor_products SET current_price = 300.00, last_checked = NOW() WHERE id = @fz_annual;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-06-20 09:00:00');
UPDATE competitor_products SET current_price = 175.00, last_checked = NOW() WHERE id = @bw_chal;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-07-08 09:00:00');
UPDATE competitor_products SET current_price = 5.99,   last_checked = NOW() WHERE id = @a8_prem;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-07-15 09:00:00');
UPDATE competitor_products SET current_price = 90.00,  last_checked = NOW() WHERE id = @pg_pack;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-08-01 09:00:00');
UPDATE competitor_products SET current_price = 29.00,  last_checked = NOW() WHERE id = @fz_month;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-09-01 09:00:00');
UPDATE competitor_products SET current_price = 320.00, last_checked = NOW() WHERE id = @fz_annual;

SET TIMESTAMP = UNIX_TIMESTAMP('2026-09-10 09:00:00');
UPDATE competitor_products SET current_price = 65.00,  last_checked = NOW() WHERE id = @pg_unl;

-- Latest check of every product. No price changes, so the trigger adds
-- no rows; the stable products keep their single April history row.
SET TIMESTAMP = UNIX_TIMESTAMP('2026-10-01 08:00:00');
UPDATE competitor_products SET last_checked = NOW()
WHERE competitor_id IN (@fitzone, @activ8, @pulse, @balkan);

-- ---------------------------------------------------------------------
-- Market events (at least 2 per competitor)
-- ---------------------------------------------------------------------
INSERT INTO market_events
  (competitor_id, event_type, title, description, event_date, source_name, source_url, importance_score)
VALUES
  (@fitzone, 'PRICE_CHANGE', 'FitZone cuts monthly membership to EUR 32',
   'Monthly membership down from EUR 35 to 32, annual from 360 to 300 for a summer promotion.',
   '2026-06-03', 'FitZone website', 'https://fitzone.example/monthly', 7),
  (@fitzone, 'EXPANSION', 'FitZone opens 6th club in Prishtina (Dardania)',
   'New 1,200 m2 club about 1.5 km from the NovaFit studio, with a group-class floor.',
   '2026-07-20', 'Local press', 'https://news.example/fitzone-dardania', 9),
  (@fitzone, 'PRICE_CHANGE', 'FitZone monthly membership now EUR 29',
   'Second cut in two months, advertised as "the lowest gym price in Kosovo".',
   '2026-08-01', 'FitZone social media', 'https://social.example/fitzone/0801', 8),

  (@activ8, 'FUNDING', 'Activ8 raises EUR 1.5M seed round',
   'Round led by a regional VC fund; money goes into Kosovo marketing and AI coaching features.',
   '2026-05-18', 'Regional tech news', 'https://news.example/activ8-seed', 8),
  (@activ8, 'PRICE_CHANGE', 'Activ8 Premium drops to EUR 5.99',
   'Premium plan cut from EUR 7.99 to 5.99, now 40% cheaper than NovaFit App Premium.',
   '2026-07-08', 'App store listing', 'https://activ8.example/premium', 8),
  (@activ8, 'PARTNERSHIP', 'Activ8 partners with a Kosovo mobile operator',
   'Three months of Premium free for the operator''s postpaid customers in Kosovo.',
   '2026-09-05', 'Local press', 'https://news.example/activ8-telecom', 7),

  (@pulse, 'PRICE_CHANGE', 'PulseGym raises Unlimited Classes to EUR 60',
   'First increase in two years; the studio says classes are full at peak hours.',
   '2026-05-12', 'PulseGym website', 'https://pulsegym.example/unlimited', 4),
  (@pulse, 'PRODUCT_LAUNCH', 'PulseGym launches reformer Pilates classes',
   'New premium class type with six reformer machines, sold as an add-on.',
   '2026-08-18', 'PulseGym social media', 'https://social.example/pulsegym/0818', 5),
  (@pulse, 'PRICE_CHANGE', 'PulseGym Unlimited now EUR 65',
   'Second increase this year, bundled with the new Pilates offer.',
   '2026-09-10', 'PulseGym website', 'https://pulsegym.example/unlimited', 4),

  (@balkan, 'EXPANSION', 'Balkan Wellness Group opens Prishtina office',
   'Hired a local sales team of three to sell corporate wellness to Kosovo companies.',
   '2026-06-10', 'Business press', 'https://news.example/bwg-prishtina', 7),
  (@balkan, 'PARTNERSHIP', 'Balkan Wellness signs deal with a large Kosovo bank',
   'Corporate wellness for 400 bank employees, a segment NovaFit was also pitching.',
   '2026-08-25', 'Company press release', 'https://balkanwellness.example/press/bank-deal', 8);

-- ---------------------------------------------------------------------
-- Business decisions under consideration
-- (risk_level and ai_recommendation are left NULL for the AI to fill in)
-- ---------------------------------------------------------------------
INSERT INTO business_decisions
  (business_id, title, description, decision_type, status, estimated_cost,
   expected_revenue_change, expected_monthly_cost_change, expected_customer_change,
   decision_date)
VALUES
  (@novafit, 'Hire 4 employees',
   'Hire 2 coaches, 1 sales rep for corporate plans and 1 app developer to grow faster.',
   'hiring', 'proposed', 0.00,
   3000.00, 8000.00, 80,
   '2026-09-25'),
  (@novafit, 'Open second location',
   'Open a second studio in Fushe Kosove to reach customers outside the city centre. The initial investment covers fit-out and equipment.',
   'expansion', 'proposed', 60000.00,
   4500.00, 8000.00, 120,
   '2026-09-28');

COMMIT;

SET TIMESTAMP = DEFAULT;
