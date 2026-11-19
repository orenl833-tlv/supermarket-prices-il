import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { applyPrices, replacePromotions, upsertChain, upsertProducts, upsertStores } from "../src/db/load.js";
import type { PromoRow } from "../src/promotions.js";
import { migrate } from "../src/db/migrate.js";
import type { PriceItem } from "../src/types.js";

/**
 * Integration tests against a real Postgres. Set TEST_DATABASE_URL to a
 * throwaway database to run them; they are skipped otherwise.
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("database loading", () => {
  let pool: pg.Pool;
  let storeId: number;
  let chainId: number;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrate(pool, () => {});
  });

  afterAll(() => pool.end());

  beforeEach(async () => {
    await pool.query(
      "TRUNCATE store_promotions, promo_runs, price_changes, chain_products, products, ingest_runs, stores, chains RESTART IDENTITY CASCADE",
    );
    chainId = await upsertChain(pool, "7290027600007", "שופרסל");
    const ids = await upsertStores(pool, chainId, [
      { storeCode: "1", name: "בן יהודה", address: null, cityCode: "5000" },
    ]);
    storeId = ids.get("1")!;
    // Products 1-4 for the price tests; new products get ids from 101.
    await pool.query("INSERT INTO products (id, name) SELECT g, 'p' || g FROM generate_series(1, 4) g");
    await pool.query("SELECT setval('products_id_seq', 100)");
  });

  const day = (n: number) => new Date(Date.UTC(2026, 10, n, 1));
  const currentPrices = async () =>
    (
      await pool.query<{ product_id: number; price: string }>(
        "SELECT product_id, price FROM price_changes WHERE valid_to IS NULL ORDER BY product_id",
      )
    ).rows.map((r) => [r.product_id, Number(r.price)]);

  it("writes only the differences between two days", async () => {
    await applyPrices(pool, storeId, day(1), [
      { productId: 1, price: 10 },
      { productId: 2, price: 20 },
      { productId: 3, price: 30 },
    ]);

    // Day 2: product 1 unchanged, 2 got cheaper, 3 is gone, 4 is new.
    const result = await applyPrices(pool, storeId, day(2), [
      { productId: 1, price: 10 },
      { productId: 2, price: 18 },
      { productId: 4, price: 40 },
    ]);

    expect(result).toEqual({ opened: 2, closed: 2 });
    expect(await currentPrices()).toEqual([[1, 10], [2, 18], [4, 40]]);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM price_changes");
    expect(rows[0].n).toBe(5); // 3 from day 1 + 2 new periods on day 2
  });

  it("is idempotent: the same list twice changes nothing", async () => {
    const prices = [{ productId: 1, price: 10 }, { productId: 2, price: 20 }];
    await applyPrices(pool, storeId, day(1), prices);
    expect(await applyPrices(pool, storeId, day(2), prices)).toEqual({ opened: 0, closed: 0 });
  });

  it("shares one product row across chains for the same barcode", async () => {
    const otherChain = await upsertChain(pool, "7290058140886", "רמי לוי");
    const milk: PriceItem = {
      itemCode: "7290004131074",
      isBarcode: true,
      name: "חלב 3% 1 ליטר",
      manufacturer: "תנובה",
      quantity: 1000,
      unit: "ml",
      isWeighted: false,
      price: 7,
    };
    const a = await upsertProducts(pool, chainId, [milk]);
    const b = await upsertProducts(pool, otherChain, [{ ...milk, name: "חלב תנובה 3%" }]);
    expect(a.get(milk.itemCode)).toBe(b.get(milk.itemCode));

    // Internal codes are per chain, even when the code is the same.
    const tomato = { ...milk, itemCode: "123", isBarcode: false, name: "עגבניות" };
    const c = await upsertProducts(pool, chainId, [tomato]);
    const d = await upsertProducts(pool, otherChain, [tomato]);
    expect(c.get("123")).not.toBe(d.get("123"));
    // ...and stable across runs.
    expect((await upsertProducts(pool, chainId, [tomato])).get("123")).toBe(c.get("123"));
  });

  it("replaces a branch's promotions, keeping only products the chain lists", async () => {
    await upsertProducts(pool, chainId, [
      { itemCode: "7290000000011", isBarcode: true, name: "חלב", manufacturer: null, quantity: null, unit: null, isWeighted: false, price: 7 },
    ]);
    const row = (itemCode: string, promotionId: string): PromoRow => ({
      itemCode,
      promotionId,
      description: "2ב12",
      kind: "bundle",
      quantity: 2,
      getQuantity: null,
      price: 12,
      discount: null,
      minPurchase: null,
      maxUnits: null,
      club: null,
      startsAt: day(1),
      endsAt: day(30),
    });

    // The second item code is unknown to this chain: dropped.
    expect(await replacePromotions(pool, chainId, storeId, [row("7290000000011", "A"), row("999", "A")])).toBe(1);
    expect(await replacePromotions(pool, chainId, storeId, [row("7290000000011", "B")])).toBe(1);
    const { rows } = await pool.query("SELECT promotion_id FROM store_promotions WHERE store_id = $1", [storeId]);
    expect(rows).toEqual([{ promotion_id: "B" }]); // A was replaced, not kept
  });
});

