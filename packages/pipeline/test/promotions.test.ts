import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { limitedHours, parsePromoFull } from "../src/promotions.js";

// Five real promotions from a Shufersal PromoFull file (branch 1, 16.11.2026).
const xml = readFileSync(new URL("./fixtures/promofull-shufersal-sample.xml", import.meta.url), "utf8");
const fileTime = new Date("2026-11-16T12:00:00Z");

describe("parsePromoFull", () => {
  const file = parsePromoFull(xml, fileTime);
  const byDescription = (start: string) => file.rows.filter((r) => r.description.startsWith(start));

  it("reads the chain and branch", () => {
    expect(file.chainCode).toBe("7290027600007");
    expect(file.storeCode).toBe("1");
  });

  it("1+1: buy one, the same product free (group 1 = buy, group 2 = get)", () => {
    expect(byDescription("1+1 וופל")).toEqual([
      expect.objectContaining({ itemCode: "8000380004676", kind: "buyGet", quantity: 1, getQuantity: 1, discount: 1 }),
    ]); // the other wafer is only in the gift group: a cross-product deal, left out
  });

  it("2 for 24: a bundle, one row per product in the deal", () => {
    const rows = byDescription("2ב24");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ kind: "bundle", quantity: 2, price: 24 });
  });

  it("a fixed promotion price", () => {
    expect(byDescription("12.90 דבש")[0]).toMatchObject({ kind: "unitPrice", price: 12.9 });
  });

  it("leaves out coupons and weighted deals, and counts why", () => {
    expect(file.rows.some((r) => r.description.includes("קופון"))).toBe(false);
    expect(file.rows.some((r) => r.description.startsWith("84 נעם"))).toBe(false);
    expect(file.skipped).toEqual({ coupon: 1, weighted: 1 });
  });

  it("drops promotions that ended before the file was published", () => {
    expect(parsePromoFull(xml, new Date("2027-01-01T00:00:00Z")).rows).toEqual([]);
  });
});

describe("limitedHours", () => {
  it("treats the whole day (Carrefour's 00:01-23:59) and empty fields as no limit", () => {
    expect(limitedHours("00:01:00.000", "23:59:00.000")).toBe(false);
    expect(limitedHours(null, null)).toBe(false);
  });

  it("treats part of the day as a limit", () => {
    expect(limitedHours("08:00", "12:00")).toBe(true);
    expect(limitedHours(null, "20:00")).toBe(true);
  });
});
