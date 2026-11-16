-- Some chains write "---" (or "כללי", "לא ידוע") instead of leaving the
-- manufacturer empty. The parser now stores NULL for these; this cleans rows
-- loaded before that fix (barcoded products are never overwritten on reload).
UPDATE products
SET manufacturer = NULL
WHERE manufacturer ~ '^(לא ידוע|כללי|[-.[:space:]]+)$';
