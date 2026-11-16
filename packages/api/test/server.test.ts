import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPrices, upsertChain, upsertProducts, upsertStores } from "@spil/pipeline/src/db/load.js";
import { migrate } from "@spil/pipeline/src/db/migrate.js";
import type { PriceItem } from "@spil/pipeline/src/types.js";
import { buildServer } from "../src/server.js";

const url = process.env.TEST_DATABASE_URL;

const product = (itemCode: string, name: string, price: number): PriceItem => ({
  itemCode,
  isBarcode: true,
  name,
  manufacturer: null,
  quantity: null,
  unit: null,
  isWeighted: false,
  price,
});

describe.skipIf(!url)("API", () => {
  let pool: pg.Pool;
  let app: ReturnType<typeof buildServer>;
  const center = { lat: 32.08, lon: 34.78 };

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrate(pool, () => {});

    // Two chains, one branch each, ~0.5 km from the centre; a third branch 10 km away.
    const a = await upsertChain(pool, "1000000000001", "זולה");
    const b = await upsertChain(pool, "1000000000002", "יקרה");
    const [aStores, bStores] = [
      await upsertStores(pool, a, [
        { storeCode: "1", name: "זולה מרכז", address: "א 1", cityCode: "5000" },
        { storeCode: "2", name: "זולה רחוקה", address: "ב 2", cityCode: "5000" },
      ]),
      await upsertStores(pool, b, [{ storeCode: "1", name: "יקרה מרכז", address: "ג 3", cityCode: "5000" }]),
    ];
    await pool.query("UPDATE stores SET lat = 32.084, lon = 34.78 WHERE name LIKE '%מרכז'");
    await pool.query("UPDATE stores SET lat = 32.17, lon = 34.78 WHERE name = 'זולה רחוקה'");

    const milk = product("7290000000011", "חלב 3% שומן 1 ליטר", 7);
    const bread = product("7290000000028", "לחם אחיד פרוס", 8);
    const oat = product("7290000000035", "משקה שיבולת שועל", 15);
    const day = new Date("2026-11-16T04:00:00Z");

    const aIds = await upsertProducts(pool, a, [milk, bread]);
    await applyPrices(pool, aStores.get("1")!, day, [
      { productId: aIds.get(milk.itemCode)!, price: 6.5 },
      { productId: aIds.get(bread.itemCode)!, price: 7 },
    ]);
    const bIds = await upsertProducts(pool, b, [milk, bread, oat]);
    await applyPrices(pool, bStores.get("1")!, day, [
      { productId: bIds.get(milk.itemCode)!, price: 7.9 },
      { productId: bIds.get(bread.itemCode)!, price: 9 },
      { productId: bIds.get(oat.itemCode)!, price: 15 },
    ]);

    app = buildServer(pool);
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  const search = async (q: string) =>
    (await app.inject({ url: `/api/products?q=${encodeURIComponent(q)}` })).json().products;

  it("searches by every word of the name, and by barcode", async () => {
    expect((await search("חלב שומן")).map((p: { name: string }) => p.name)).toEqual(["חלב 3% שומן 1 ליטר"]);
    expect(await search("חלב לחם")).toEqual([]);
    const [byBarcode] = await search("7290000000028");
    expect(byBarcode).toMatchObject({
      name: "לחם אחיד פרוס",
      storeCount: 2,
      chains: ["זולה", "יקרה"],
      minPrice: 7,
      maxPrice: 9,
    });
  });

  it("treats % and _ in a search as plain characters", async () => {
    // Unescaped, "_" would match any character and "%" anything at all.
    expect(await search("_")).toEqual([]);
    expect((await search("%")).map((p: { name: string }) => p.name)).toEqual(["חלב 3% שומן 1 ליטר"]);
  });

  it("compares a basket across nearby branches", async () => {
    const [milk, bread, oat] = [
      (await search("חלב"))[0].id,
      (await search("לחם"))[0].id,
      (await search("שיבולת"))[0].id,
    ];
    const res = await app.inject({
      method: "POST",
      url: "/api/compare",
      payload: {
        ...center,
        radiusKm: 2,
        items: [
          { productId: milk, quantity: 2 },
          { productId: bread, quantity: 1 },
          { productId: oat, quantity: 1, importance: "optional" },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.storesConsidered).toBe(2); // the far branch is outside the radius
    const [best, second] = body.plans;
    expect(best.stops[0].store.name).toBe("זולה מרכז");
    expect(best.itemsCost).toBe(20); // 2 × 6.5 + 7; oat drink is optional and missing
    expect(best.missing).toEqual([{ productId: oat, importance: "optional", penalty: 0 }]);
    expect(second.stops[0].store.name).toBe("יקרה מרכז");
    expect(body.productNames[milk]).toBe("חלב 3% שומן 1 ליטר");
  });

  it("rejects bad input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/compare",
      payload: { lat: 0, lon: 0, items: [] },
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports data freshness per chain", async () => {
    const res = await app.inject({ url: "/api/status" });
    expect(res.json().chains.map((c: { chain: string }) => c.chain)).toEqual(["זולה", "יקרה"]);
  });
});

describe("serving the web app", () => {
  it("serves index.html for app routes and 404 JSON for unknown API routes", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "web-"));
    writeFileSync(join(root, "index.html"), "<!doctype html><title>app</title>");
    // Static routes need no database.
    const web = buildServer({} as pg.Pool, { webRoot: root });
    expect((await web.inject({ url: "/" })).body).toContain("<title>app</title>");
    expect((await web.inject({ url: "/some/page" })).body).toContain("<title>app</title>");
    const api404 = await web.inject({ url: "/api/nope" });
    expect(api404.statusCode).toBe(404);
    expect(api404.json()).toEqual({ error: "Not found" });
    await web.close();
  });
});
