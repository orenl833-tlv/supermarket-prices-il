import type { ProductInfo, Size } from "./types.js";

/**
 * The size of one item of a product, in the category's base unit.
 *
 * The Quantity field in the files is often wrong for packs (a 12-egg carton
 * listed as 1 unit), so for eggs the count is read from the name. For other
 * products the pipeline's normalized quantity is used when it fits the unit,
 * and the name is the fallback.
 */
export function sizeOf(product: ProductInfo, unit: Size["unit"]): Size | null {
  if (product.isWeighted) {
    return unit === "g" ? { amount: 1000, unit } : null; // price is per kg
  }
  if (unit === "egg") {
    const count = eggCount(product.name);
    return count ? { amount: count, unit } : null;
  }
  if (product.unit === unit && product.quantity && product.quantity > 1) {
    return { amount: product.quantity, unit };
  }
  return sizeFromName(product.name, unit);
}

/** "ביצים L ארוזות 12 י" -> 12; "ביצי חופש 30יח L" -> 30. */
export function eggCount(name: string): number | null {
  const m =
    /(\d+)\s*(?:יח|יחידות|י(?=\s|$)|\*)/.exec(name) ??
    // A common pack size standing alone or stuck to a size letter: "ביצים בינוני M12".
    /(?:^|[^\d.])(6|10|12|15|18|20|24|30)(?![\d.%])/.exec(name);
  const n = m ? Number(m[1]) : NaN;
  return n >= 2 && n <= 60 ? n : null;
}

const NAME_UNITS: Array<{ re: RegExp; unit: "g" | "ml"; factor: number }> = [
  { re: /(\d+(?:\.\d+)?)\s*(?:ק"ג|קג|קילו)/, unit: "g", factor: 1000 },
  { re: /(\d+(?:\.\d+)?)\s*(?:גרם|גר'?|ג'?)(?=[^א-ת]|$)/, unit: "g", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:מ"ל|מל)(?=[^א-ת]|$)/, unit: "ml", factor: 1 },
  { re: /(\d+(?:\.\d+)?)\s*(?:ליטר|ל'?)(?=[^א-ת]|$)/, unit: "ml", factor: 1000 },
];

/** "סוכר לבן 1 ק"ג" -> 1000 g; "חלב 3% מהדרין 2ל" -> 2000 ml. */
export function sizeFromName(name: string, unit: "g" | "ml" | "egg"): Size | null {
  for (const rule of NAME_UNITS) {
    if (rule.unit !== unit) continue;
    const m = rule.re.exec(name);
    if (m) return { amount: Number(m[1]) * rule.factor, unit };
  }
  return null;
}
