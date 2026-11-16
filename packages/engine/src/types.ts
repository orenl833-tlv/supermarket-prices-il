/** How much the user cares about getting an item. */
export type Importance = "must" | "normal" | "optional";

export interface BasketItem {
  productId: number;
  quantity: number; // units, or kilograms for weighted products
  importance: Importance;
}

export interface Store {
  id: number;
  name: string;
  chain: string;
  distanceKm: number;
}

/** storeId -> productId -> current price (₪). */
export type PriceTable = ReadonlyMap<number, ReadonlyMap<number, number>>;

/**
 * The fixed cost of shopping at a set of stores, on top of the items.
 * This is the only part that differs between "walk to stores" and "order
 * delivery", so both are one engine with two cost models.
 * Returns null when the plan is not allowed (e.g. below a minimum order).
 */
export interface CostModel {
  fixedCost(stops: ReadonlyArray<{ store: Store; subtotal: number }>): number | null;
}

export interface PlanLine {
  productId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface PlanStop {
  store: Store;
  lines: PlanLine[];
  subtotal: number;
}

export interface MissingItem {
  productId: number;
  importance: Importance;
  penalty: number; // what the plan is charged for not having it
}

export interface Plan {
  stops: PlanStop[];
  missing: MissingItem[];
  itemsCost: number; // what you pay at the till(s)
  fixedCost: number; // extra stops or delivery fees
  penaltyCost: number; // missing items, plus a trip to buy them elsewhere
  score: number; // itemsCost + fixedCost + penaltyCost: plans are ranked by this
}
