-- Initial schema for phase 1: chains, stores, products and price history.
--
-- Key decision: prices are stored as periods (valid_from / valid_to), not as
-- a full snapshot per run. A daily run writes rows only for prices that
-- changed, which keeps the table small and gives price history for free.

CREATE TABLE chains (
  id    SERIAL PRIMARY KEY,
  code  TEXT UNIQUE NOT NULL,          -- ChainID in the files, e.g. 7290027600007
  name  TEXT NOT NULL
);

CREATE TABLE stores (
  id          SERIAL PRIMARY KEY,
  chain_id    INT NOT NULL REFERENCES chains(id),
  store_code  TEXT NOT NULL,           -- StoreID in the files, without leading zeros
  name        TEXT NOT NULL,
  address     TEXT,
  city_code   TEXT,                    -- CBS locality code, e.g. 5000 = Tel Aviv-Yafo
  lat         DOUBLE PRECISION,        -- filled later by geocoding
  lon         DOUBLE PRECISION,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (chain_id, store_code)
);

CREATE TABLE categories (              -- filled from phase 2; created now so products can point to it
  id               SERIAL PRIMARY KEY,
  name             TEXT UNIQUE NOT NULL,
  unit             TEXT,               -- 'g' | 'ml' | 'unit'
  shelf_life_days  INT
);

CREATE TABLE products (
  id            SERIAL PRIMARY KEY,
  barcode       TEXT UNIQUE,           -- NULL for chain-internal codes (ItemType 0)
  name          TEXT NOT NULL,
  manufacturer  TEXT,
  quantity      NUMERIC,               -- normalized: grams, millilitres, units or metres
  unit          TEXT,                  -- 'g' | 'ml' | 'unit' | 'm', NULL if unknown
  is_weighted   BOOLEAN NOT NULL DEFAULT false,
  category_id   INT REFERENCES categories(id)
);

-- How each chain identifies a product. Barcoded products from different
-- chains share one products row; internal codes get a row of their own.
CREATE TABLE chain_products (
  chain_id    INT NOT NULL REFERENCES chains(id),
  item_code   TEXT NOT NULL,
  product_id  INT NOT NULL REFERENCES products(id),
  raw_name    TEXT NOT NULL,
  PRIMARY KEY (chain_id, item_code)
);

CREATE TABLE price_changes (
  store_id    INT NOT NULL REFERENCES stores(id),
  product_id  INT NOT NULL REFERENCES products(id),
  price       NUMERIC(10,2) NOT NULL CHECK (price > 0),
  valid_from  TIMESTAMPTZ NOT NULL,
  valid_to    TIMESTAMPTZ,               -- NULL = current price
  PRIMARY KEY (store_id, product_id, valid_from),
  CHECK (valid_to IS NULL OR valid_to > valid_from)
);

-- At most one open (current) price per product per store.
CREATE UNIQUE INDEX price_changes_one_current
  ON price_changes (store_id, product_id)
  WHERE valid_to IS NULL;

-- The hot query: current prices of the basket's products in nearby stores.
CREATE INDEX price_changes_current_by_product
  ON price_changes (product_id, store_id)
  WHERE valid_to IS NULL;

-- One row per processed file: makes runs idempotent and shows data freshness.
CREATE TABLE ingest_runs (
  id            SERIAL PRIMARY KEY,
  store_id      INT REFERENCES stores(id),
  file_name     TEXT UNIQUE NOT NULL,
  file_time     TIMESTAMPTZ NOT NULL,    -- publication time, parsed from the file name
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at   TIMESTAMPTZ,
  status        TEXT NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'rejected')),
  items_read    INT,
  items_skipped INT,
  prices_changed INT,
  error         TEXT
);

CREATE INDEX ingest_runs_store_time ON ingest_runs (store_id, file_time DESC);
