/** How much the user cares about getting an item. */
export type Importance = "must" | "normal" | "optional";

export interface BasketItem {
  productId: number;
  quantity: number; // units, or kilograms for weighted products
  importance: Importance;
  /**
   * "Any brand": the user is fine with a close substitute even where the
   * exact product is sold, so the cheaper of the two is taken in each store.
   */
  anyBrand?: boolean;
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

/**
 * A close substitute for a basket item in one store, already priced: whole
 * packs that cover the amount asked for (see @spil/catalog bestSubstitute).
 */
export interface Substitute {
  productId: number;
  quantity: number; // packs, or kg for weighted produce
  unitPrice: number;
  lineTotal: number;
  /** Small ranking cost for "not exactly what you asked for". */
  penalty: number;
}

/** storeId -> basket productId -> its best substitute in that store. */
export type SubstituteTable = ReadonlyMap<number, ReadonlyMap<number, Substitute>>;

export interface PlanLine {
  productId: number;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Set when this line is a substitute: the basket product it replaces. */
  substituteFor?: number;
  /** The promotion that priced this line, as the chain describes it ("2+1"). */
  promotion?: string;
  /** Units added on top of the request because they were free or made it cheaper. */
  extraUnits?: number;
  /** A deal the customer could complete by adding units; not included in the total. */
  suggestion?: { quantity: number; extraCost: number; promotion: string };
  /**
   * A deal on this product that needs a minimum purchase in the store, not
   * reached yet: spend `missing` more on other products to unlock it.
   */
  unlock?: { minPurchase: number; missing: number; promotion: string };
}

export interface PlanStop {
  store: Store;
  lines: PlanLine[];
  subtotal: number;
  /**
   * How much less this stop would cost with the chain's club deals, when the
   * customer is not a member of that chain's club (not in the total).
   */
  clubSaving?: number;
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
  substitutionCost: number; // small penalties for substitutes
  score: number; // itemsCost + fixedCost + penaltyCost + substitutionCost: plans are ranked by this
}
