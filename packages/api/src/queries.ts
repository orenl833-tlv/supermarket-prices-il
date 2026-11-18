import { bestSubstitute, categoryByKey, classify, type PricedProduct, type ProductInfo } from "@spil/catalog";
import {
  distanceKm,
  type BasketItem,
  type PriceTable,
  type Promotion,
  type PromotionTable,
  type Store,
  type Substitute,
} from "@spil/engine";
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
  /** The chain with the lowest price; null when every chain asks the same. */
  cheapestChain: string | null;
  /** Substitute category, when the product is in one: "any brand" is possible. */
  category: string | null;
  /** The lowest price per litre, kg or egg, for comparing pack sizes. */
  unitPrice: { price: number; per: "liter" | "kg" | "egg" } | null;
}

/**
 * Search products by name (every word must appear) or by barcode.
 * Names that start with the first word rank first ("ביצים" should find eggs
 * before Kinder egg chocolate), then products sold by more chains (only those
 * can be compared), then by more stores: those are the ones people usually mean.
 */
/** Columns and joins shared by every query that returns ProductHit rows. */
const HIT_COLUMNS = `
  SELECT p.id, p.name, p.manufacturer, p.quantity::float AS quantity, p.unit, p.is_weighted,
         count(DISTINCT pc.store_id)::int AS store_count,
         array_agg(DISTINCT c.name ORDER BY c.name) AS chains,
         min(pc.price)::float AS min_price, max(pc.price)::float AS max_price,
         (array_agg(c.name ORDER BY pc.price, c.name))[1] AS cheapest_chain,
         cat.name AS category
  FROM products p
  LEFT JOIN categories cat ON cat.id = p.category_id
  JOIN price_changes pc ON pc.product_id = p.id AND pc.valid_to IS NULL
  JOIN stores s ON s.id = pc.store_id
  JOIN chains c ON c.id = s.chain_id`;

export async function searchProducts(db: pg.Pool, query: string, limit = 20): Promise<ProductHit[]> {
  const q = query.trim();
  if (q === "") return [];

  const isBarcode = /^\d{6,14}$/.test(q);
  // Chains and users write קוטג' / קוטג׳ / קוטג and ש"ח / ש״ח interchangeably,
  // so quote marks are removed from both sides before matching.
  const plain = stripQuotes(q);
  const words = plain.split(/\s+/).filter(Boolean).map((w) => `%${escapeLike(w)}%`);
  if (!isBarcode && words.length === 0) return [];
  const name = `translate(p.name, '${QUOTES.replace("'", "''")}', '')`;
  const { rows } = await db.query(
    `${HIT_COLUMNS}
     WHERE ${isBarcode ? "p.barcode = $1" : `${name} ILIKE ALL ($1::text[])`}
     GROUP BY p.id, cat.name
     ORDER BY ${name} ILIKE $3 DESC, count(DISTINCT c.id) DESC, store_count DESC, length(p.name), p.name
     LIMIT $2`,
    [isBarcode ? q : words, limit, `${escapeLike(plain.split(/\s+/)[0] ?? "")}%`],
  );
  return rows.map(toHit);
}

/** Products by id, in the order asked (unknown or no longer sold ids are left out). */
export async function productsByIds(db: pg.Pool, ids: number[]): Promise<ProductHit[]> {
  if (ids.length === 0) return [];
  const { rows } = await db.query(`${HIT_COLUMNS} WHERE p.id = ANY($1::int[]) GROUP BY p.id, cat.name`, [ids]);
  const byId = new Map(rows.map((r) => [r.id as number, toHit(r)]));
  return ids.flatMap((id) => byId.get(id) ?? []);
}

function toHit(r: Record<string, any>): ProductHit {
  return {
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
    // Naming a "cheapest" chain only means something when prices differ.
    cheapestChain: r.min_price < r.max_price ? r.cheapest_chain : null,
    category: r.category,
    unitPrice: unitPriceOf(
      { id: r.id, name: r.name, quantity: r.quantity, unit: r.unit, isWeighted: r.is_weighted },
      r.min_price,
    ),
  };
}

/**
 * When the search text names a substitute category ("ביצים", "חלב"), the
 * product to stand for "any of these". The UI adds it with "any brand" on, so
 * the engine then picks the cheapest close product in each store.
 *
 * The query must point to one category: "שמנת" matches three (sour, cooking,
 * whipping), so it gets no suggestion. The product is the most widely sold one
 * that matches what a shopper means by the bare name (the category's
 * defaults: "חלב" is 3% and not lactose-free).
 */
export async function categorySuggestion(
  db: pg.Pool,
  query: string,
): Promise<{ category: string; product: ProductHit } | null> {
  const q = query.trim().replace(/\s+/g, " ");
  if (q.length < 2) return null;
  const { rows: cats } = await db.query<{ id: number; key: string; name: string }>(
    "SELECT id, key, name FROM categories WHERE name = $1 OR name LIKE $2",
    [q, `${escapeLike(q)} %`],
  );
  const category = cats.find((c) => c.name === q) ?? (cats.length === 1 ? cats[0] : undefined);
  if (!category) return null;

  const { rows: candidates } = await db.query(
    `SELECT p.id, p.name, p.quantity::float AS quantity, p.unit, p.is_weighted AS "isWeighted"
     FROM products p JOIN price_changes pc ON pc.product_id = p.id AND pc.valid_to IS NULL
     WHERE p.category_id = $1
     GROUP BY p.id
     ORDER BY count(DISTINCT pc.store_id) DESC, min(pc.price)
     LIMIT 50`,
    [category.id],
  );
  const def = categoryByKey(category.key);
  const defaults = def?.defaults ?? {};
  const matchesDefaults = (p: ProductInfo) => {
    const attrs = classify(p)?.attributes ?? {};
    return Object.entries(defaults).every(([k, v]) => attrs[k] === v);
  };
  // A standard pack beats a half portion when the category has a typical size.
  const typicalSize = (p: ProductInfo) => !def?.typicalSize || classify(p)?.size?.amount === def.typicalSize;
  const products = candidates as ProductInfo[];
  const chosen =
    products.find((p) => matchesDefaults(p) && typicalSize(p)) ?? products.find(matchesDefaults) ?? products[0];
  if (!chosen) return null;

  const [hit] = await productsByIds(db, [chosen.id]);
  return hit ? { category: category.name, product: hit } : null;
}

/**
 * Price per litre, kg or egg. Uses the catalog's size when the product is in
 * a category (it reads egg counts from the name), else the normalized
 * quantity from the files. Null when the size is unknown.
 */
export function unitPriceOf(product: ProductInfo, price: number): ProductHit["unitPrice"] {
  const round = (n: number) => Math.round(n * 100) / 100;
  if (product.isWeighted) return { price: round(price), per: "kg" };
  const size = classify(product)?.size;
  const amount = size?.amount ?? product.quantity;
  const unit = size?.unit ?? product.unit;
  if (!amount || amount <= 0) return null;
  if (unit === "ml") return { price: round((price / amount) * 1000), per: "liter" };
  if (unit === "g") return { price: round((price / amount) * 1000), per: "kg" };
  if (unit === "egg") return { price: round(price / amount), per: "egg" };
  return null;
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
      // Some chains publish placeholders instead of an address.
      address: /^(unknown|לא ידוע|0)?$/i.test(r.address?.trim() ?? "") ? null : r.address,
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

/**
 * Promotions running now for the basket's products in the candidate stores,
 * in the engine's shape. Rows are stored by the pipeline from PromoFull files.
 */
export async function activePromotions(
  db: pg.Pool,
  storeIds: number[],
  productIds: number[],
  now = new Date(),
): Promise<PromotionTable> {
  const { rows } = await db.query<{
    store_id: number;
    product_id: number;
    description: string;
    kind: Promotion["kind"];
    quantity: number | null;
    get_quantity: number | null;
    price: number | null;
    discount: number | null;
    min_purchase: number | null;
    max_units: number | null;
  }>(
    `SELECT store_id, product_id, description, kind, quantity, get_quantity,
            price::float AS price, discount::float AS discount,
            min_purchase::float AS min_purchase, max_units
     FROM store_promotions
     WHERE store_id = ANY($1::int[]) AND product_id = ANY($2::int[])
       AND starts_at <= $3 AND ends_at > $3`,
    [storeIds, productIds, now],
  );
  const table = new Map<number, Map<number, Promotion[]>>();
  for (const r of rows) {
    const promotion = toPromotion(r);
    if (!promotion) continue;
    if (!table.has(r.store_id)) table.set(r.store_id, new Map());
    const byProduct = table.get(r.store_id)!;
    byProduct.set(r.product_id, [...(byProduct.get(r.product_id) ?? []), promotion]);
  }
  return table;
}

function toPromotion(r: {
  description: string;
  kind: Promotion["kind"];
  quantity: number | null;
  get_quantity: number | null;
  price: number | null;
  discount: number | null;
  min_purchase: number | null;
  max_units: number | null;
}): Promotion | null {
  const common = {
    description: r.description,
    ...(r.min_purchase ? { minPurchase: r.min_purchase } : {}),
    ...(r.max_units ? { maxUnits: r.max_units } : {}),
  };
  if (r.kind === "unitPrice" && r.price) return { kind: "unitPrice", price: r.price, ...common };
  if (r.kind === "bundle" && r.quantity && r.price) return { kind: "bundle", quantity: r.quantity, price: r.price, ...common };
  if (r.kind === "buyGet" && r.quantity && r.get_quantity && r.discount) {
    return { kind: "buyGet", buy: r.quantity, get: r.get_quantity, discount: r.discount, ...common };
  }
  return null;
}

export interface UnlockedDeal {
  productId: number;
  name: string;
  description: string;
  minPurchase: number;
  regularPrice: number;
  dealPrice: number;
}

/**
 * Deals with a minimum purchase on products not in the basket, per store:
 * "your basket here is over 100, so you can also get Bisli at 7.95 instead
 * of 15.90". Only unit-price deals, which have a clear price to show, and
 * only real savings. Best savings first, at most `perStore` per store.
 */
export async function unlockableDeals(
  db: pg.Pool,
  storeIds: number[],
  basketProductIds: number[],
  perStore = 3,
  now = new Date(),
): Promise<Map<number, UnlockedDeal[]>> {
  const { rows } = await db.query<{
    store_id: number;
    product_id: number;
    name: string;
    description: string;
    min_purchase: number;
    regular: number;
    deal: number;
  }>(
    `SELECT sp.store_id, sp.product_id, p.name, sp.description, sp.min_purchase::float AS min_purchase,
            pc.price::float AS regular, sp.price::float AS deal
     FROM store_promotions sp
     JOIN products p ON p.id = sp.product_id
     JOIN price_changes pc ON pc.store_id = sp.store_id AND pc.product_id = sp.product_id AND pc.valid_to IS NULL
     WHERE sp.store_id = ANY($1::int[]) AND sp.product_id <> ALL($2::int[])
       AND sp.kind = 'unitPrice' AND sp.min_purchase > 0 AND sp.price < pc.price
       AND sp.starts_at <= $3 AND sp.ends_at > $3
     ORDER BY sp.store_id, 1 - sp.price / pc.price DESC`,
    [storeIds, basketProductIds, now],
  );
  const byStore = new Map<number, UnlockedDeal[]>();
  for (const r of rows) {
    const list = byStore.get(r.store_id) ?? [];
    if (list.length >= perStore || list.some((d) => d.productId === r.product_id)) continue;
    list.push({
      productId: r.product_id,
      name: r.name,
      description: r.description,
      minPurchase: r.min_purchase,
      regularPrice: r.regular,
      dealPrice: r.deal,
    });
    byStore.set(r.store_id, list);
  }
  return byStore;
}

/**
 * For every store that lacks a basket product, its best close substitute;
 * for "any brand" items, in every store.
 *
 * One query loads the current prices of all products in the basket's
 * categories in the candidate stores; @spil/catalog then picks and prices the
 * substitute (whole packs, attribute penalties) per store. Products outside
 * the taxonomy get no substitutes.
 */
export async function findSubstitutes(
  db: pg.Pool,
  basket: BasketItem[],
  storeIds: number[],
  prices: PriceTable,
): Promise<Map<number, Map<number, Substitute>>> {
  const table = new Map<number, Map<number, Substitute>>();
  const { rows: originals } = await db.query(
    `SELECT id, name, quantity::float AS quantity, unit, is_weighted AS "isWeighted", category_id
     FROM products WHERE id = ANY($1::int[]) AND category_id IS NOT NULL`,
    [basket.map((i) => i.productId)],
  );
  if (originals.length === 0) return table;

  const { rows: candidates } = await db.query(
    `SELECT pc.store_id, p.id, p.name, p.quantity::float AS quantity, p.unit,
            p.is_weighted AS "isWeighted", p.category_id, pc.price::float AS price
     FROM price_changes pc JOIN products p ON p.id = pc.product_id
     WHERE pc.valid_to IS NULL AND pc.store_id = ANY($1::int[]) AND p.category_id = ANY($2::int[])`,
    [storeIds, [...new Set(originals.map((o) => o.category_id))]],
  );
  // store -> category -> priced products
  const byStore = new Map<number, Map<number, PricedProduct[]>>();
  for (const c of candidates) {
    if (!byStore.has(c.store_id)) byStore.set(c.store_id, new Map());
    const cats = byStore.get(c.store_id)!;
    if (!cats.has(c.category_id)) cats.set(c.category_id, []);
    cats.get(c.category_id)!.push(c);
  }

  const itemOf = new Map(basket.map((i) => [i.productId, i]));
  for (const storeId of storeIds) {
    for (const original of originals as Array<ProductInfo & { category_id: number }>) {
      const item = itemOf.get(original.id)!;
      // Only where the exact product is missing, unless the user chose "any brand".
      if (prices.get(storeId)?.has(original.id) && !item.anyBrand) continue;
      const pool = byStore.get(storeId)?.get(original.category_id) ?? [];
      const choice = bestSubstitute(original, item.quantity, pool, { anyBrand: item.anyBrand });
      if (!choice) continue;
      if (!table.has(storeId)) table.set(storeId, new Map());
      table.get(storeId)!.set(original.id, choice);
    }
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

export interface ChainStatus {
  chain: string;
  /** Publication time of the newest file loaded for the chain. */
  updatedAt: string | null;
  branches: number;
  /** Products with a current price in at least one branch. */
  products: number;
}

/**
 * Per chain: when its prices were last updated and how much data we hold.
 * Feeds the "updated X hours ago" line and the data panel in the footer.
 * Each count is a separate subquery so one join cannot multiply another.
 */
export async function freshness(db: pg.Pool): Promise<ChainStatus[]> {
  const { rows } = await db.query(
    `SELECT c.name AS chain,
       (SELECT max(r.file_time) FROM ingest_runs r JOIN stores s ON s.id = r.store_id
        WHERE s.chain_id = c.id AND r.status = 'ok') AS updated_at,
       (SELECT count(*) FROM stores s WHERE s.chain_id = c.id)::int AS branches,
       (SELECT count(DISTINCT pc.product_id) FROM price_changes pc JOIN stores s ON s.id = pc.store_id
        WHERE s.chain_id = c.id AND pc.valid_to IS NULL)::int AS products
     FROM chains c
     ORDER BY c.name`,
  );
  return rows.map((r) => ({
    chain: r.chain,
    updatedAt: r.updated_at?.toISOString() ?? null,
    branches: r.branches,
    products: r.products,
  }));
}

/** ASCII and Hebrew quote marks: ' " ׳ ״ */
const QUOTES = `'"\u05F3\u05F4`;

function stripQuotes(s: string): string {
  return s.replace(/['"\u05F3\u05F4]/g, "").trim();
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}
