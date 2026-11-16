import type { CostModel } from "./types.js";

/**
 * Shopping in person: the first store is free, every extra stop costs a fixed
 * amount that stands for the user's time. A second store is only worth it if
 * it saves more than that.
 */
export function walkingCost({ extraStopCost }: { extraStopCost: number }): CostModel {
  return {
    fixedCost: (stops) => Math.max(0, stops.length - 1) * extraStopCost,
  };
}

export interface DeliveryRule {
  fee: number; // ₪ per order
  minimumOrder: number; // ₪ of items
}

/**
 * Ordering online: every store in the plan is a separate order, with its own
 * delivery fee and minimum order. A plan where one order is below its
 * minimum is not allowed.
 */
export function deliveryCost(rules: ReadonlyMap<number, DeliveryRule>): CostModel {
  return {
    fixedCost: (stops) => {
      let total = 0;
      for (const { store, subtotal } of stops) {
        const rule = rules.get(store.id);
        if (!rule || subtotal < rule.minimumOrder) return null;
        total += rule.fee;
      }
      return total;
    },
  };
}
