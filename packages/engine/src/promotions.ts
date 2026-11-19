/**
 * Promotions for one product in one store, and how they price a basket line.
 *
 * Three kinds cover the common deals in the chains' PromoFull files:
 *   unitPrice  "גבינה ב-9.90"         every unit costs `price`
 *   bundle     "2 ב-24"               every `quantity` units cost `price` together
 *   buyGet     "2+1", "1+1",          for every `buy` units at the regular price,
 *              "השני בחצי מחיר"        `get` more units are `discount` off (1 = free)
 *
 * Only whole units of the same product count; deals across different
 * products ("הזול מביניהם") and weighted items are left for later.
 */
export type Promotion = (
  | { kind: "unitPrice"; price: number }
  | { kind: "bundle"; quantity: number; price: number }
  | { kind: "buyGet"; buy: number; get: number; discount: number }
) & {
  description: string;
  /**
   * The deal needs this much spent on other products in the same store
   * ("מעל 100"). optimize() applies it only when the rest of that store's
   * lines reach it; choosePromo() itself does not check it.
   */
  minPurchase?: number;
  /** At most this many units at the deal price per customer; the rest at the regular price. */
  maxUnits?: number;
  /**
   * Only for members of the chain's club ("מועדון קרפור אשראי"). optimize()
   * applies it only for chains listed in memberChains.
   */
  club?: string;
};

/**
 * What `qty` units cost with this promotion, given the regular unit price.
 * Never more than the regular total: a "deal" that costs more is ignored.
 */
export function promoCost(regular: number, qty: number, p: Promotion): number {
  // Units beyond the per-customer limit are at the regular price.
  const dealUnits = Math.min(qty, p.maxUnits ?? qty);
  return round(Math.min(dealCost(regular, dealUnits, p) + (qty - dealUnits) * regular, regular * qty));
}

/** What `qty` units cost under the deal, with no limit. */
function dealCost(regular: number, qty: number, p: Promotion): number {
  switch (p.kind) {
    case "unitPrice":
      return p.price * qty;
    case "bundle":
      // Full bundles at the bundle price, the rest at the regular price.
      return Math.floor(qty / p.quantity) * p.price + (qty % p.quantity) * regular;
    case "buyGet": {
      // Each full set of buy+get units: `buy` at full price, `get` discounted.
      // In a partial set, units beyond `buy` are already discounted.
      const set = p.buy + p.get;
      const sets = Math.floor(qty / set);
      const rest = qty % set;
      const discounted = regular * (1 - p.discount);
      return (
        sets * (p.buy * regular + p.get * discounted) +
        Math.min(rest, p.buy) * regular +
        Math.max(0, rest - p.buy) * discounted
      );
    }
  }
}

/** How a basket line is bought once promotions are taken into account. */
export interface PromoChoice {
  /** Units to buy: the requested quantity, or more when more costs no more. */
  quantity: number;
  lineTotal: number;
  /** The promotion used, if it lowered the price. */
  promotion?: Promotion;
  /** Units added because they were free or made the line cheaper. */
  extraUnits: number;
  /** Units the customer could add to complete a deal, and what they cost. */
  suggestion?: { quantity: number; extraCost: number; promotion: Promotion };
}

/**
 * The owner's rule (planning doc, 18.11): first take the cheapest way to buy
 * the requested quantity q. Then, up to one more full deal, look at q' > q:
 *   - if some q' costs no more than q, buy it (largest such q'):
 *     2+1 when 2 were asked -> 3 for the price of 2; "2 for the price of 1"
 *     when 1 was asked -> 2; "2 cost less than 1" -> 2.
 *   - otherwise, if some q' is cheaper per unit, only suggest it:
 *     "3rd at 50%" when 2 were asked -> "one more at half price?".
 * So the customer never pays more than for what they asked for.
 */
export function choosePromo(regular: number, requested: number, promotions: readonly Promotion[]): PromoChoice {
  const plain: PromoChoice = { quantity: requested, lineTotal: round(regular * requested), extraUnits: 0 };
  // Promotions are per whole unit; weighted or fractional quantities stay plain.
  if (promotions.length === 0 || !Number.isInteger(requested) || requested < 1) return plain;

  let best = plain;
  let suggestion: PromoChoice["suggestion"];
  for (const p of promotions) {
    const atRequested = promoCost(regular, requested, p);
    let choice: PromoChoice = { quantity: requested, lineTotal: atRequested, extraUnits: 0 };
    for (let q = requested + 1; q <= requested + span(p); q++) {
      const cost = promoCost(regular, q, p);
      if (cost <= choice.lineTotal) {
        choice = { quantity: q, lineTotal: cost, extraUnits: q - requested };
      } else if (cost / q < atRequested / requested - 0.005 && !suggestion) {
        suggestion = { quantity: q - requested, extraCost: round(cost - atRequested), promotion: p };
      }
    }
    if (choice.lineTotal < plain.lineTotal || choice.extraUnits > 0) choice.promotion = p;
    if (choice.lineTotal < best.lineTotal || (choice.lineTotal === best.lineTotal && choice.quantity > best.quantity)) {
      best = choice;
    }
  }
  // A suggestion is only worth showing when we did not already add units.
  return best.extraUnits === 0 && suggestion ? { ...best, suggestion } : best;
}

/** How far past the requested quantity a deal can matter: one full deal. */
function span(p: Promotion): number {
  return p.kind === "bundle" ? p.quantity : p.kind === "buyGet" ? p.buy + p.get : 0;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
