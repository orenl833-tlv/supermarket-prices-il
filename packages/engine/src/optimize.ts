import type {
  BasketItem,
  CostModel,
  MissingItem,
  Plan,
  PlanLine,
  PlanStop,
  PriceTable,
  Store,
  SubstituteTable,
} from "./types.js";

export interface OptimizeInput {
  basket: BasketItem[];
  stores: Store[];
  prices: PriceTable;
  costModel: CostModel;
  /** Shop at up to this many stores (1 or 2 in practice). */
  maxStores: number;
  /**
   * What a "normal" item costs the plan when it is missing: roughly what it
   * would cost to buy it somewhere else. See `missingPenalties`.
   */
  penalties: ReadonlyMap<number, number>;
  /**
   * Charged once when any "normal" item is missing: buying it elsewhere means
   * another trip (or another order). Without it, a store that has nothing
   * scores about the same as one that has everything, since the per-item
   * penalty is close to the item's price.
   */
  missingTripCost: number;
  /** How many plans to return, best first. */
  limit?: number;
  /**
   * Return only the best plan for each chain (or pair of chains). Branches of
   * one chain usually share prices, so without this the top results can all
   * be the same chain at different addresses.
   */
  onePerChain?: boolean;
  /**
   * Close substitutes per store, used for an item only in a store that does
   * not have the exact product. A substitute counts as having the item, so it
   * also satisfies "must".
   */
  substitutes?: SubstituteTable;
}

/**
 * Find the cheapest way to buy a basket from a set of nearby stores.
 *
 * Try every combination of 1..maxStores stores. In each combination, buy
 * every item where it is cheapest, then add the cost model's fixed cost
 * (extra stops or delivery fees) and a penalty for missing items: each
 * item's price elsewhere, plus one more trip if anything is missing.
 * Rank by that score.
 *
 * With n stores and m items this is O(C(n, maxStores) * maxStores * m):
 * for 40 stores, 2 stops and 30 items, about 50,000 steps. Exhaustive
 * search is exact and simple, so there is no need for anything cleverer.
 */
export function optimize(input: OptimizeInput): Plan[] {
  const { stores, maxStores, limit = 5, onePerChain = false } = input;
  const plans: Plan[] = [];

  for (const combo of combinations(stores, maxStores)) {
    const plan = evaluate(combo, input);
    if (plan) plans.push(plan);
  }

  plans.sort(
    (a, b) =>
      a.score - b.score ||
      a.stops.length - b.stops.length ||
      totalDistance(a) - totalDistance(b),
  );
  if (!onePerChain) return plans.slice(0, limit);

  // Plans are sorted, so the first plan seen for a chain set is its best (and nearest).
  const seen = new Set<string>();
  const distinct: Plan[] = [];
  for (const plan of plans) {
    const chains = plan.stops.map((s) => s.store.chain).sort().join("+");
    if (seen.has(chains)) continue;
    seen.add(chains);
    distinct.push(plan);
    if (distinct.length === limit) break;
  }
  return distinct;
}

/** Price one combination of stores, or null if it is not a valid plan. */
function evaluate(combo: Store[], input: OptimizeInput): Plan | null {
  const { basket, prices, costModel, penalties, missingTripCost, substitutes } = input;
  const linesByStore = new Map<number, PlanLine[]>(combo.map((s) => [s.id, []]));
  const missing: MissingItem[] = [];
  let substitutionCost = 0;

  for (const item of basket) {
    // Every way to get this item in this combination: the exact product where a
    // store has it, otherwise that store's substitute. Cheapest (cost + penalty)
    // wins; on a tie the exact product, then the nearer store.
    let best: { store: Store; line: PlanLine; penalty: number } | null = null;
    for (const store of combo) {
      const price = prices.get(store.id)?.get(item.productId);
      let option: { line: PlanLine; penalty: number } | null = null;
      if (price !== undefined) {
        option = {
          line: { productId: item.productId, quantity: item.quantity, unitPrice: price, lineTotal: money(price * item.quantity) },
          penalty: 0,
        };
      } else {
        const sub = substitutes?.get(store.id)?.get(item.productId);
        if (sub) {
          option = {
            line: {
              productId: sub.productId,
              quantity: sub.quantity,
              unitPrice: sub.unitPrice,
              lineTotal: sub.lineTotal,
              substituteFor: item.productId,
            },
            penalty: sub.penalty,
          };
        }
      }
      if (!option) continue;
      const cost = option.line.lineTotal + option.penalty;
      const bestCost = best ? best.line.lineTotal + best.penalty : Infinity;
      if (
        cost < bestCost ||
        (best && cost === bestCost && (option.penalty < best.penalty || store.distanceKm < best.store.distanceKm))
      ) {
        best = { store, ...option };
      }
    }

    if (best) {
      linesByStore.get(best.store.id)!.push(best.line);
      substitutionCost += best.penalty;
    } else if (item.importance === "must") {
      return null; // a must-have item is not available in this combination
    } else {
      const penalty = item.importance === "optional" ? 0 : (penalties.get(item.productId) ?? 0) * item.quantity;
      missing.push({ productId: item.productId, importance: item.importance, penalty: money(penalty) });
    }
  }

  const stops: PlanStop[] = combo.map((store) => {
    const lines = linesByStore.get(store.id)!;
    return { store, lines, subtotal: money(sum(lines.map((l) => l.lineTotal))) };
  });

  // A stop where nothing is bought is pointless: the smaller plan already covers it.
  if (stops.some((s) => s.lines.length === 0)) return null;

  const fixedCost = costModel.fixedCost(stops);
  if (fixedCost === null) return null;

  const itemsCost = money(sum(stops.map((s) => s.subtotal)));
  const needsAnotherTrip = missing.some((m) => m.importance === "normal");
  const penaltyCost = money(sum(missing.map((m) => m.penalty)) + (needsAnotherTrip ? missingTripCost : 0));
  substitutionCost = money(substitutionCost);
  return {
    stops,
    missing,
    itemsCost,
    fixedCost,
    penaltyCost,
    substitutionCost,
    score: money(itemsCost + fixedCost + penaltyCost + substitutionCost),
  };
}

/**
 * The default penalty for a missing item: its highest price among the
 * candidate stores, i.e. "you can still get it nearby, at worst at this price".
 * Items no candidate store has get no penalty: every plan misses them equally.
 */
export function missingPenalties(basket: BasketItem[], stores: Store[], prices: PriceTable): Map<number, number> {
  const penalties = new Map<number, number>();
  for (const item of basket) {
    let max = 0;
    for (const store of stores) {
      max = Math.max(max, prices.get(store.id)?.get(item.productId) ?? 0);
    }
    penalties.set(item.productId, max);
  }
  return penalties;
}

/** All combinations of 1..k items, smallest first. */
export function* combinations<T>(items: T[], k: number): Generator<T[]> {
  function* pick(start: number, chosen: T[]): Generator<T[]> {
    if (chosen.length > 0) yield chosen;
    if (chosen.length === k) return;
    for (let i = start; i < items.length; i++) {
      yield* pick(i + 1, [...chosen, items[i]!]);
    }
  }
  yield* pick(0, []);
}

function totalDistance(plan: Plan): number {
  return sum(plan.stops.map((s) => s.store.distanceKm));
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

/** Round to agorot, so totals do not drift with floating point. */
function money(n: number): number {
  return Math.round(n * 100) / 100;
}
