-- Keep promotions after they end, for the price history chart.
-- Until now a branch's rows were replaced whole by each newer PromoFull file.
-- Now a promotion the newer file still lists is updated in place, and one it
-- no longer lists gets ended_at = that file's time. NULL means "still
-- published": every query for current prices must filter on it.
ALTER TABLE store_promotions ADD COLUMN ended_at TIMESTAMPTZ;

-- Current promotions per branch, for the loader's "what is no longer listed".
CREATE INDEX store_promotions_current ON store_promotions (store_id) WHERE ended_at IS NULL;
