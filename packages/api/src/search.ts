/**
 * Spelling-tolerant matching and ranking for product search.
 *
 * Matching: each query word becomes a key the same way the database builds
 * products.search_key (migration 005): first letter kept, later א/ו/י dropped,
 * final letters made regular, quote marks and case ignored. Query words also
 * lose a plural or feminine ending first, so "לימונים" finds "לימון" and
 * "עגבניה" finds "עגבניות". A product matches when its key contains every
 * query key.
 *
 * Ranking: what people usually mean by "במבה" is plain Bamba, not "במבה
 * נוגט". So among the matches, prefer (in this order):
 *   1. every query word matching a whole word of the name, not just part of one
 *      ("לימון" in "לימון" rather than in "לימונדה");
 *   2. the name starting with the first query word;
 *   3. fewer extra words in the name, not counting sizes and numbers
 *      ("לאבנה 5% 250 גרם" before "לאבנה לימון כבוש", "לימון" before "לימון ליים");
 *   4. products sold by two chains or more (the ones that can be compared);
 *   5. more chains, more stores, then the shorter name.
 */
const FINALS: Record<string, string> = { ך: "כ", ם: "מ", ן: "נ", ף: "פ", ץ: "צ" };

/** The same transformation as the database function hebrew_search_key, for one word. */
export function searchKey(word: string): string {
  const w = word
    .toLowerCase()
    .replace(/['"׳״]/g, "")
    .replace(/[ךםןףץ]/g, (c) => FINALS[c]!);
  return w.length <= 1 ? w : w[0] + w.slice(1).replace(/[אוי]/g, "");
}

/** Drop a plural or feminine ending: "לימונים" -> "לימונ", "עגבניה" -> "עגבני". */
export function stem(word: string): string {
  if (word.length < 4 || !/^[א-ת]+$/.test(word)) return word;
  if (/(ים|ות)$/.test(word)) return word.slice(0, -2);
  if (/יה$/.test(word)) return word.slice(0, -1);
  return word;
}

/** The keys a product's search_key must contain, one per query word. */
export function queryKeys(query: string): string[] {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => searchKey(stem(w)))
    .filter((k) => k.length > 0);
}

/** Words that describe size, amount or packaging rather than what the product is. */
const MEASURE = /^(\d|גרם$|גר$|ג$|ק"?ג$|קג$|ליטר$|ל$|מ"?ל$|מל$|יח'?$|יחידות$|מארז$|x$|\*$|(xs|s|m|l|xl)$|שומן$|בקרטון$|בקבוק$|טרי$|טריים$|טריה$)/i;

interface Rankable {
  name: string;
  chains: string[];
  storeCount: number;
}

/** Sort hits by how likely each is the product the query means (see above). */
export function rankHits<T extends Rankable>(query: string, hits: T[]): T[] {
  const keys = queryKeys(query);
  const scored = hits.map((hit) => {
    const words = hit.name.split(/[\s,()]+/).filter(Boolean);
    const wordKeys = words.map((w) => searchKey(stem(w)));
    const whole = keys.every((k) => wordKeys.includes(k));
    const starts = keys.length > 0 && wordKeys[0] === keys[0];
    const extra = words.filter((w, i) => !keys.includes(wordKeys[i]!) && !MEASURE.test(w)).length;
    return { hit, whole, starts, extra };
  });
  scored.sort(
    (a, b) =>
      Number(b.whole) - Number(a.whole) ||
      Number(b.starts) - Number(a.starts) ||
      a.extra - b.extra ||
      Number(b.hit.chains.length >= 2) - Number(a.hit.chains.length >= 2) ||
      b.hit.chains.length - a.hit.chains.length ||
      b.hit.storeCount - a.hit.storeCount ||
      a.hit.name.length - b.hit.name.length,
  );
  return scored.map((s) => s.hit);
}
