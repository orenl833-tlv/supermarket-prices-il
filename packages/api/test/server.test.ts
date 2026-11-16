import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyPrices, upsertChain, upsertProducts, upsertStores } from "@spil/pipeline/src/db/load.js";
import { migrate } from "@spil/pipeline/src/db/migrate.js";
import { classifyProducts } from "@spil/pipeline/src/classify.js";
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

    const milk = { ...product("7290000000011", "חלב 3% שומן 1 ליטר", 7), quantity: 1000, unit: "ml" as const };
    const bread = product("7290000000028", "לחם אחיד פרוס", 8);
    const oat = product("7290000000035", "משקה שיבולת שועל", 15);
    // Each chain sells its own 12-pack of eggs (different barcodes): close substitutes.
    const eggsA = product("7290000000042", "ביצים L ארוזות 12 י", 12);
    const eggsB = product("7290000000059", "ביצים 12 יח גדול L", 13);
    const day = new Date("2026-11-16T04:00:00Z");

    // One full price list per branch: applyPrices treats the list as complete.
    const aIds = await upsertProducts(pool, a, [milk, bread, eggsA]);
    await applyPrices(pool, aStores.get("1")!, day, [
      { productId: aIds.get(milk.itemCode)!, price: 6.5 },
      { productId: aIds.get(bread.itemCode)!, price: 7 },
      { productId: aIds.get(eggsA.itemCode)!, price: 12 },
    ]);
    const bIds = await upsertProducts(pool, b, [milk, bread, oat, eggsB]);
    await applyPrices(pool, bStores.get("1")!, day, [
      { productId: bIds.get(milk.itemCode)!, price: 7.9 },
      { productId: bIds.get(bread.itemCode)!, price: 9 },
      { productId: bIds.get(oat.itemCode)!, price: 15 },
      { productId: bIds.get(eggsB.itemCode)!, price: 13 },
    ]);

    await classifyProducts(pool);

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

  it("offers a close substitute in a store that lacks the exact product", async () => {
    const [eggsA] = await search("ביצים L ארוזות");
    const [bread] = await search("לחם");
    const res = await app.inject({
      method: "POST",
      url: "/api/compare",
      payload: {
        ...center,
        radiusKm: 2,
        items: [
          { productId: eggsA.id, quantity: 1, importance: "must" },
          { productId: bread.id, quantity: 1 },
        ],
      },
    });
    const body = res.json();
    const expensive = body.plans.find(
      (p: { stops: Array<{ store: { name: string } }> }) => p.stops[0]?.store.name === "יקרה מרכז",
    );
    const eggsLine = expensive.stops[0].lines.find((l: { substituteFor?: number }) => l.substituteFor === eggsA.id);
    expect(eggsLine).toMatchObject({ quantity: 1, unitPrice: 13, lineTotal: 13 });
    expect(body.productNames[eggsLine.productId]).toBe("ביצים 12 יח גדול L");
    expect(expensive.substitutionCost).toBe(0.5); // same size, same type: base penalty only
    expect(body.unavailable).toEqual([]);
  });

  it("with 'any brand', takes another brand where it is cheaper even if the exact one is sold", async () => {
    // Chain B sells only its own eggs (13); chain A sells A's eggs (12). Ask for B's eggs.
    const [eggsB] = await search("ביצים 12 יח גדול");
    const [bread] = await search("לחם");
    const compare = async (anyBrand: boolean) =>
      (
        await app.inject({
          method: "POST",
          url: "/api/compare",
          payload: {
            ...center,
            radiusKm: 2,
            items: [
              { productId: eggsB.id, quantity: 1, anyBrand },
              { productId: bread.id, quantity: 1 },
            ],
          },
        })
      ).json();
    const cheapStore = (body: { plans: Array<{ stops: Array<{ store: { name: string }; lines: Array<{ productId: number; substituteFor?: number }> }> }> }) =>
      body.plans.find((p) => p.stops[0]?.store.name === "זולה מרכז")!;
    // Store A lacks B's eggs either way, so it gets A's eggs as a substitute...
    expect(cheapStore(await compare(false)).stops[0]!.lines.some((l) => l.substituteFor === eggsB.id)).toBe(true);
    // ...and with "any brand" there is no base penalty.
    const anyBrand = await compare(true);
    expect(cheapStore(anyBrand)).toMatchObject({ substitutionCost: 0 });
  });

  it("suggests 'any eggs' when the search names the category", async () => {
    const res = (await app.inject({ url: `/api/products?q=${encodeURIComponent("ביצים")}` })).json();
    expect(res.suggestion).toMatchObject({ category: "ביצים" });
    expect(res.suggestion.product.name).toMatch(/^ביצים/);
    // Not for a word that is only part of a product name.
    const other = (await app.inject({ url: `/api/products?q=${encodeURIComponent("לחם")}` })).json();
    expect(other.suggestion).toBeNull();
  });

  it("shows the category and price per unit in search results", async () => {
    const [eggs] = await search("ביצים L ארוזות");
    expect(eggs).toMatchObject({ category: "ביצים", unitPrice: { price: 1, per: "egg" } }); // 12 / 12 eggs
    const [milk] = await search("חלב 3% שומן");
    expect(milk.unitPrice).toEqual({ price: 6.5, per: "liter" }); // cheapest 6.50 per 1 litre
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
