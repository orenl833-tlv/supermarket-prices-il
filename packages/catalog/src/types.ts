/** What we know about a product from the price files. */
export interface ProductInfo {
  id: number;
  name: string;
  quantity: number | null; // normalized by the pipeline: g, ml, unit or m
  unit: string | null;
  isWeighted: boolean; // priced per kg
}

/**
 * How much one "item" of a product contains, in the category's base unit:
 * grams, millilitres or eggs. Weighted products are priced per kg, so their
 * size is 1000 g.
 */
export interface Size {
  amount: number;
  unit: "g" | "ml" | "egg";
}

export interface AttributeDef {
  key: string;
  /** Reads the attribute from the product name; null when the name does not say. */
  read: (name: string) => string | null;
  /** ₪ added when a substitute differs on this attribute. */
  mismatchPenalty: number;
  /** A difference that makes the product no substitute at all (lactose-free vs regular). */
  hard?: boolean;
}

export interface CategoryDef {
  key: string; // stable id, e.g. "eggs"
  name: string; // Hebrew label
  unit: Size["unit"];
  /** Weighted (per-kg) fresh produce only, or packaged only, or either. */
  weighted?: boolean;
  match: RegExp;
  exclude?: RegExp;
  attributes: AttributeDef[];
  /** Assumed size when a name does not say, e.g. a carton of eggs holds 12. */
  typicalSize?: number;
  /** Attributes that must be readable for a product to belong (real milk always states its fat %). */
  requires?: string[];
  shelfLifeDays?: number;
}

export interface Classified {
  category: CategoryDef;
  attributes: Record<string, string | null>;
  size: Size | null;
}
