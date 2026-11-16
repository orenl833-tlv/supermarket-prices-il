import { classify } from "./classify.js";
import type { ProductInfo } from "./types.js";

export interface PricedProduct extends ProductInfo {
  price: number; // per item, or per kg for weighted products
}

export interface SubstituteChoice {
  productId: number;
  /** Packs to buy, or kilograms for weighted products. */
  quantity: number;
  unitPrice: number;
  lineTotal: number; // what the user pays at the till
  /** Small cost for "not exactly what you asked for", used only for ranking. */
  penalty: number;
  /** Attribute keys that differ from the original, e.g. ["size"]. */
  differences: string[];
}

/** Every substitute costs at least this much, so the exact product wins a tie. */
export const BASE_PENALTY = 0.5;
/** Added when a size is unknown and the comparison is less certain. */
const UNKNOWN_SIZE_PENALTY = 1;

/**
 * The best close substitute for `original` among `candidates` (one store's
 * products), or null if none is close enough.
 *
 * A candidate qualifies when it is in the same category and agrees on every
 * "hard" attribute (lactose-free milk never replaces regular milk). Its cost
 * is what the user would really pay: whole packs, enough to cover the amount
 * asked for (12 eggs from 18-packs means one pack of 18), or the weight for
 * produce sold per kg. The penalty adds a little for each attribute that
 * differs. The cheapest cost + penalty wins.
 *
 * With `anyBrand` the user has said another brand is fine, so the base
 * penalty is dropped; differences in attributes are still charged.
 */
export function bestSubstitute(
  original: ProductInfo,
  quantity: number,
  candidates: PricedProduct[],
  { anyBrand = false }: { anyBrand?: boolean } = {},
): SubstituteChoice | null {
  const o = classify(original);
  if (!o) return null;
  // How much the user asked for, in the category's base unit (g, ml or eggs).
  // If the name does not say, use the category's typical size when it has one.
  const originalSize = o.size?.amount ?? o.category.typicalSize ?? null;
  const sizeGuessed = !o.size && originalSize !== null;
  const wanted = originalSize !== null ? originalSize * quantity : null;

  let best: SubstituteChoice | null = null;
  for (const candidate of candidates) {
    if (candidate.id === original.id) continue;
    const c = classify(candidate);
    if (!c || c.category.key !== o.category.key) continue;

    // "Any brand" means another brand is fine: no base penalty, but real
    // differences (size, type, fat) still count.
    let penalty = (anyBrand ? 0 : BASE_PENALTY) + (sizeGuessed ? UNKNOWN_SIZE_PENALTY : 0);
    const differences: string[] = [];
    let excluded = false;
    for (const attr of o.category.attributes) {
      const a = o.attributes[attr.key];
      const b = c.attributes[attr.key];
      if (a === null || a === undefined || b === null || b === undefined || a === b) continue;
      if (attr.hard) excluded = true;
      penalty += attr.mismatchPenalty;
      differences.push(attr.key);
    }
    if (excluded) continue;

    let buy: number;
    if (candidate.isWeighted) {
      // Priced per kg: buy the same weight.
      if (wanted === null && !original.isWeighted) continue;
      buy = round(wanted !== null ? wanted / 1000 : quantity, 3);
    } else if (c.size && wanted !== null) {
      buy = Math.ceil(wanted / c.size.amount - 1e-9);
    } else {
      // A size is missing from the name ("ביצים L אומגה 3 לבן"): assume one
      // pack for one pack, and charge a little for the uncertainty.
      buy = quantity;
      penalty += UNKNOWN_SIZE_PENALTY;
    }

    const lineTotal = round(buy * candidate.price, 2);
    const choice = {
      productId: candidate.id,
      quantity: buy,
      unitPrice: candidate.price,
      lineTotal,
      penalty: round(penalty, 2),
      differences,
    };
    if (!best || lineTotal + choice.penalty < best.lineTotal + best.penalty) best = choice;
  }
  return best;
}

function round(n: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
