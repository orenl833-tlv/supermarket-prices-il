/**
 * Seeds a small, known dataset for the end-to-end tests: two chains with one
 * branch each, next to the app's default location (Dizengoff Center).
 *
 * DATABASE_URL must point at a throwaway database: its schema is dropped.
 */
import pg from "pg";
import { classifyProducts } from "../../../packages/pipeline/src/classify.js";
import { applyPrices, upsertChain, upsertProducts, upsertStores } from "../../../packages/pipeline/src/db/load.js";
import { migrate } from "../../../packages/pipeline/src/db/migrate.js";
import type { PriceItem } from "../../../packages/pipeline/src/types.js";

const item = (itemCode: string, name: string, extra: Partial<PriceItem> = {}): PriceItem => ({
  itemCode,
  isBarcode: true,
  name,
  manufacturer: null,
  quantity: null,
  unit: null,
  isWeighted: false,
  price: 0,
  ...extra,
});

const MILK = item("7290000000011", "חלב 3% שומן 1 ליטר", { quantity: 1000, unit: "ml" });
const BREAD = item("7290000000028", "לחם אחיד פרוס 750 גרם", { quantity: 750, unit: "g" });
const EGGS_A = item("7290000000042", "ביצים L ארוזות 12 י");
const EGGS_B = item("7290000000059", "ביצים 12 יח גדול L");

export async function seed(pool: pg.Pool): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
  await migrate(pool, () => {});

  const day = new Date("2026-11-16T04:00:00Z");
  const branch = async (chainCode: string, chainName: string, storeName: string, lat: number, lon: number) => {
    const chainId = await upsertChain(pool, chainCode, chainName);
    const stores = await upsertStores(pool, chainId, [
      { storeCode: "1", name: storeName, address: "דיזנגוף 50", cityCode: "5000" },
    ]);
    const storeId = stores.get("1")!;
    await pool.query("UPDATE stores SET lat = $2, lon = $3 WHERE id = $1", [storeId, lat, lon]);
    return { chainId, storeId };
  };

  // Chain "זולה": cheap milk and bread, its own eggs. Chain "יקרה": pricier, other eggs.
  const a = await branch("1000000000001", "זולה", "זולה דיזנגוף", 32.0762, 34.7761);
  const aIds = await upsertProducts(pool, a.chainId, [MILK, BREAD, EGGS_A]);
  await applyPrices(pool, a.storeId, day, [
    { productId: aIds.get(MILK.itemCode)!, price: 6.5 },
    { productId: aIds.get(BREAD.itemCode)!, price: 7 },
    { productId: aIds.get(EGGS_A.itemCode)!, price: 12 },
  ]);

  const b = await branch("1000000000002", "יקרה", "יקרה דיזנגוף", 32.0771, 34.7748);
  const bIds = await upsertProducts(pool, b.chainId, [MILK, BREAD, EGGS_B]);
  await applyPrices(pool, b.storeId, day, [
    { productId: bIds.get(MILK.itemCode)!, price: 7.9 },
    { productId: bIds.get(BREAD.itemCode)!, price: 9 },
    { productId: bIds.get(EGGS_B.itemCode)!, price: 13 },
  ]);

  // Promotion: 2+1 on bread at "זולה" (for the promotion test).
  await pool.query(
    `INSERT INTO store_promotions (store_id, product_id, promotion_id, description, kind, quantity, get_quantity, discount, starts_at, ends_at)
     VALUES ($1, $2, 'E2E1', '2+1 לחם אחיד', 'buyGet', 2, 1, 1, now() - interval '1 day', now() + interval '30 days')`,
    [a.storeId, aIds.get(BREAD.itemCode)!],
  );
  // A club deal: milk at 5 instead of 6.50 for members of "זולה"'s club.
  await pool.query(
    `INSERT INTO store_promotions (store_id, product_id, promotion_id, description, kind, price, club_name, starts_at, ends_at)
     VALUES ($1, $2, 'E2E3', 'חלב ב-5 לחברי מועדון', 'unitPrice', 5, 'מועדון זולה', now() - interval '1 day', now() + interval '30 days')`,
    [a.storeId, aIds.get(MILK.itemCode)!],
  );
  // A minimum-purchase deal: eggs at 6 instead of 12 when spending over 10 on other products.
  await pool.query(
    `INSERT INTO store_promotions (store_id, product_id, promotion_id, description, kind, price, min_purchase, starts_at, ends_at)
     VALUES ($1, $2, 'E2E2', 'ביצים ב-6 מעל 10', 'unitPrice', 6, 10, now() - interval '1 day', now() + interval '30 days')`,
    [a.storeId, aIds.get(EGGS_A.itemCode)!],
  );

  // The online store of "יקרה", for delivery: no address, its own prices.
  const online = await upsertStores(pool, b.chainId, [{ storeCode: "99", name: "יקרה אונליין", address: "www", cityCode: null }]);
  const onlineId = online.get("99")!;
  await pool.query("UPDATE stores SET online = true WHERE id = $1", [onlineId]);
  await applyPrices(pool, onlineId, day, [
    { productId: bIds.get(MILK.itemCode)!, price: 7 },
    { productId: bIds.get(BREAD.itemCode)!, price: 8 },
  ]);

  await classifyProducts(pool);

  // Freshness: chain "זולה" updated an hour ago, chain "יקרה" three days ago.
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000);
  await pool.query(
    `INSERT INTO ingest_runs (store_id, file_name, file_time, status)
     VALUES ($1, 'PriceFull-e2e-a', $2, 'ok'), ($3, 'PriceFull-e2e-b', $4, 'ok')`,
    [a.storeId, hoursAgo(1), b.storeId, hoursAgo(72)],
  );
}

if (process.argv[1]?.endsWith("seed.ts")) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  seed(pool)
    .then(() => console.log("e2e data seeded"))
    .finally(() => pool.end());
}
