-- Coordinates for branches, so the app can search within a radius.
-- geocode_query records what was looked up: when a chain changes a branch's
-- address, the query changes and the branch is geocoded again.

ALTER TABLE stores
  ADD COLUMN geocode_query TEXT,
  ADD COLUMN geocode_precision TEXT CHECK (geocode_precision IN ('address', 'street', 'manual')),
  ADD COLUMN geocoded_at TIMESTAMPTZ;

-- Radius search starts from a bounding box on these columns.
CREATE INDEX stores_location ON stores (lat, lon);
