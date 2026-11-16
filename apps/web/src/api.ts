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
}

export interface BasketEntry {
  product: Product;
  quantity: number;
  importance: Importance;
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
  items: Array<{ productId: number; quantity: number; importance: Importance }>;
  lat: number;
  lon: number;
  radiusKm: number;
  maxStores: 1 | 2;
  extraStopCost: number;
}

export async function searchProducts(q: string, signal?: AbortSignal): Promise<Product[]> {
  const res = await fetch(`/api/products?q=${encodeURIComponent(q)}`, { signal });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
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

export async function status(): Promise<Array<{ chain: string; updatedAt: string | null }>> {
  const res = await fetch("/api/status");
  if (!res.ok) return [];
  return (await res.json()).chains;
}
