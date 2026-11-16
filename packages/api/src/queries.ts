import { distanceKm, type PriceTable, type Store } from "@spil/engine";
import type pg from "pg";

export interface ProductHit {
  id: number;
  name: string;
  manufacturer: string | null;
  quantity: number | null;
  unit: string | null;
  isWeighted: boolean;
  storeCount: number;
  /** Chains that sell it. A product sold by one chain only cannot be compared. */
  chains: string[];
  minPrice: number;
  maxPrice: number;
}

/**
 * Search products by name (every word must appear) or by barcode.
 * Names that start with the first word rank first ("ביצים" should find eggs
 * before Kinder egg chocolate), then products sold by more chains (only those
 * can be compared), then by more stores: those are the ones people usually mean.
 */
export async function searchProducts(db: pg.Pool, query: string, limit = 20): Promise<ProductHit[]> {
  const q = query.trim();
  if (q === "") return [];

  const isBarcode = /^\d{6,14}$/.test(q);
  const words = q.split(/\s+/).map((w) => `%${escapeLike(w)}%`);
  const { rows } = await db.query(
    `SELECT p.id, p.name, p.manufacturer, p.quantity::float AS quantity, p.unit, p.is_weighted,
            count(DISTINCT pc.store_id)::int AS store_count,
            array_agg(DISTINCT c.name ORDER BY c.name) AS chains,
            min(pc.price)::float AS min_price, max(pc.price)::float AS max_price
     FROM products p
     JOIN price_changes pc ON pc.product_id = p.id AND pc.valid_to IS NULL
     JOIN stores s ON s.id = pc.store_id
     JOIN chains c ON c.id = s.chain_id
     WHERE ${isBarcode ? "p.barcode = $1" : "p.name ILIKE ALL ($1::text[])"}
     GROUP BY p.id
     ORDER BY p.name ILIKE $3 DESC, count(DISTINCT c.id) DESC, store_count DESC, length(p.name), p.name
     LIMIT $2`,
    [isBarcode ? q : words, limit, `${escapeLike(q.split(/\s+/)[0]!)}%`],
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    manufacturer: r.manufacturer,
    quantity: r.quantity,
    unit: r.unit,
    isWeighted: r.is_weighted,
    storeCount: r.store_count,
    chains: r.chains,
    minPrice: r.min_price,
    maxPrice: r.max_price,
  }));
}

export interface StoreWithAddress extends Store {
  address: string | null;
  lat: number;
  lon: number;
}

/**
 * Branches within `radiusKm` of a point, nearest first. A bounding box on
 * (lat, lon) narrows the rows in SQL; the exact distance is computed here.
 */
export async function storesNear(
  db: pg.Pool,
  point: { lat: number; lon: number },
  radiusKm: number,
): Promise<StoreWithAddress[]> {
  const dLat = radiusKm / 111; // km per degree of latitude
  const dLon = radiusKm / (111 * Math.cos((point.lat * Math.PI) / 180));
  const { rows } = await db.query(
    `SELECT s.id, s.name, s.address, s.lat, s.lon, c.name AS chain
     FROM stores s JOIN chains c ON c.id = s.chain_id
     WHERE s.lat BETWEEN $1 AND $2 AND s.lon BETWEEN $3 AND $4`,
    [point.lat - dLat, point.lat + dLat, point.lon - dLon, point.lon + dLon],
  );
  return rows
    .map((r) => ({
      id: r.id,
      name: r.name,
      chain: r.chain,
      address: r.address,
      lat: r.lat,
      lon: r.lon,
      distanceKm: Math.round(distanceKm(point, r) * 100) / 100,
    }))
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

/** Current prices of the given products in the given stores. */
export async function currentPrices(
  db: pg.Pool,
  storeIds: number[],
  productIds: number[],
): Promise<PriceTable> {
  const { rows } = await db.query<{ store_id: number; product_id: number; price: number }>(
    `SELECT store_id, product_id, price::float AS price
     FROM price_changes
     WHERE valid_to IS NULL AND store_id = ANY($1::int[]) AND product_id = ANY($2::int[])`,
    [storeIds, productIds],
  );
  const table = new Map<number, Map<number, number>>();
  for (const r of rows) {
    if (!table.has(r.store_id)) table.set(r.store_id, new Map());
    table.get(r.store_id)!.set(r.product_id, r.price);
  }
  return table;
}

export async function productNames(db: pg.Pool, ids: number[]): Promise<Map<number, string>> {
  const { rows } = await db.query<{ id: number; name: string }>(
    "SELECT id, name FROM products WHERE id = ANY($1::int[])",
    [ids],
  );
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** When each chain's prices were last updated, for the "updated X hours ago" line. */
export async function freshness(db: pg.Pool): Promise<Array<{ chain: string; updatedAt: string | null }>> {
  const { rows } = await db.query(
    `SELECT c.name AS chain, max(r.file_time) AS updated_at
     FROM chains c
     LEFT JOIN stores s ON s.chain_id = c.id
     LEFT JOIN ingest_runs r ON r.store_id = s.id AND r.status = 'ok'
     GROUP BY c.name ORDER BY c.name`,
  );
  return rows.map((r) => ({ chain: r.chain, updatedAt: r.updated_at?.toISOString() ?? null }));
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
