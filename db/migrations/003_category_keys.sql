-- Categories are defined in code (packages/catalog/src/taxonomy.ts) and
-- synced to this table by the pipeline. `key` is the stable id from code;
-- `name` is the Hebrew label and may change.

ALTER TABLE categories ADD COLUMN key TEXT UNIQUE;

-- Substitutes are looked up by category.
CREATE INDEX products_category ON products (category_id) WHERE category_id IS NOT NULL;
