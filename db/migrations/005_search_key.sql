-- A spelling-tolerant key for product search. Hebrew is written with or
-- without the vowel letters א, ו, י ("לאבנה" / "לבנה", "קוטג'" / "קוטג"), and
-- final letters change with suffixes ("לימון" / "לימונים"). The key keeps each
-- word's first letter, drops א/ו/י after it, maps final letters to regular
-- ones, drops quote marks, and lower-cases Latin letters. The search query is
-- turned into keys the same way (packages/api/src/search.ts), so both sides
-- compare in the same form.
CREATE FUNCTION hebrew_search_key(s text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE
RETURN regexp_replace(
  translate(lower(s), 'ךםןףץ''"׳״', 'כמנפצ'),
  '([^[:space:]])[אוי]+', '\1', 'g'
);

ALTER TABLE products
  ADD COLUMN search_key text GENERATED ALWAYS AS (hebrew_search_key(name)) STORED;
