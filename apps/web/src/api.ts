export type Importance = "must" | "normal" | "optional";

export interface Product {
  id: number;
  name: string;
  manufacturer: string | null;
  quantity: number | null;
  unit: string | null;
  isWeighted: boolean;
  storeCount: number;
  chains: string[];
  minPrice: number;
  maxPrice: number;
  cheapestChain?: string | null;
  category?: string | null;
  unitPrice?: { price: number; per: "liter" | "kg" | "egg" } | null;
}

export interface BasketEntry {
  product: Product;
  quantity: number;
  importance: Importance;
  /** Another brand of the same kind is fine. */
  anyBrand?: boolean;
}

export interface Store {
  id: number;
  name: string;
  chain: string;
  address: string | null;
  distanceKm: number;
  lat: number;
  lon: number;
}

export interface Plan {
  stops: Array<{
    store: Store;
    lines: Array<{
      productId: number;
      quantity: number;
      unitPrice: number;
      lineTotal: number;
      /** Set when the line is a close substitute for this basket product. */
      substituteFor?: number;
    }>;
    subtotal: number;
  }>;
  missing: Array<{ productId: number; importance: Importance; penalty: number }>;
  itemsCost: number;
  fixedCost: number;
  penaltyCost: number;
  substitutionCost: number;
  score: number;
}

export interface CompareResult {
  storesConsidered: number;
  unavailable: number[];
  productNames: Record<string, string>;
  plans: Plan[];
}

export interface CompareRequest {
  items: Array<{ productId: number; quantity: number; importance: Importance; anyBrand: boolean }>;
  lat: number;
  lon: number;
  radiusKm: number;
  maxStores: 1 | 2;
  extraStopCost: number;
}

export interface SearchResult {
  products: Product[];
  /** When the query names a category ("ביצים"): a product to add as "any brand". */
  suggestion: { category: string; product: Product } | null;
}

export async function searchProducts(q: string, signal?: AbortSignal): Promise<SearchResult> {
  const res = await fetch(`/api/products?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  const body = await res.json();
  return { products: body.products, suggestion: body.suggestion ?? null };
}

export async function productsByIds(ids: number[]): Promise<Product[]> {
  const res = await fetch(`/api/products/by-id?ids=${ids.join(",")}`);
  if (!res.ok) throw new Error(`products failed: ${res.status}`);
  return (await res.json()).products;
}

export async function compare(body: CompareRequest): Promise<CompareResult> {
  const res = await fetch("/api/compare", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`compare failed: ${res.status}`);
  return res.json();
}

export interface ChainStatus {
  chain: string;
  updatedAt: string | null;
  branches: number;
  products: number;
}

export async function status(): Promise<ChainStatus[]> {
  const res = await fetch("/api/status");
  if (!res.ok) return [];
  return (await res.json()).chains;
}
