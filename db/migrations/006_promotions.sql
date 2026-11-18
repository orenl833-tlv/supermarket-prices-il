-- Promotions per branch and product, from the chains' PromoFull files.
-- Each branch's rows are replaced whole when its newer PromoFull file is
-- loaded: promotions are short-lived, so we keep the current set, not history.
-- Only the kinds the engine prices are stored (see pipeline/src/promotions.ts).
CREATE TABLE store_promotions (
  store_id      INT NOT NULL REFERENCES stores(id),
  product_id    INT NOT NULL REFERENCES products(id),
  promotion_id  TEXT NOT NULL,           -- the chain's PromotionID
  description   TEXT NOT NULL,           -- as the chain wrote it: "2+1 אורז"
  kind          TEXT NOT NULL CHECK (kind IN ('unitPrice', 'bundle', 'buyGet')),
  quantity      INT,                     -- bundle: units in it; buyGet: units bought
  get_quantity  INT,                     -- buyGet: units discounted
  price         NUMERIC(10,2),           -- unitPrice: per unit; bundle: for the bundle
  discount      NUMERIC(4,3),            -- buyGet: 1 = free, 0.5 = half price
  min_purchase  NUMERIC(10,2),           -- spend this much on other products in the store first
  max_units     INT,                     -- unitPrice: at most this many units at the price
  starts_at     TIMESTAMPTZ NOT NULL,
  ends_at       TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (store_id, product_id, promotion_id)
);

CREATE INDEX store_promotions_by_product ON store_promotions (product_id, store_id);

-- PromoFull files already loaded, kept apart from ingest_runs so price-file
-- freshness and "already processed" checks are not affected.
CREATE TABLE promo_runs (
  store_id     INT NOT NULL REFERENCES stores(id),
  file_name    TEXT PRIMARY KEY,
  file_time    TIMESTAMPTZ NOT NULL,
  loaded_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  promotions   INT NOT NULL,           -- rows stored for the branch
  skipped      INT NOT NULL            -- promotions in the file that were left out
);
