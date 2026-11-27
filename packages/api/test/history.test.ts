import { describe, expect, it } from "vitest";
import { chainHistory, unitPriceUnder, type PricePeriod, type PromoPeriod } from "../src/history.js";

const day = (n: number) => new Date(Date.UTC(2026, 10, n));
const shelf = (storeId: number, price: number, from: number, to: number | null, chain = "שופרסל"): PricePeriod => ({
  chain,
  storeId,
  price,
  from: day(from),
  to: to === null ? null : day(to),
});

describe("unitPriceUnder", () => {
  it("prices one round of each kind of deal per unit", () => {
    expect(unitPriceUnder(15, { kind: "bundle", quantity: 2, price: 24, description: "2 ב-24" })).toBe(12);
    expect(unitPriceUnder(10, { kind: "buyGet", buy: 1, get: 1, discount: 1, description: "1+1" })).toBe(5);
    expect(unitPriceUnder(9, { kind: "buyGet", buy: 2, get: 1, discount: 1, description: "2+1" })).toBe(6);
    expect(unitPriceUnder(10, { kind: "unitPrice", price: 7.9, description: "ב-7.90" })).toBe(7.9);
    // A "deal" dearer than the shelf price never raises it.
    expect(unitPriceUnder(10, { kind: "bundle", quantity: 2, price: 25, description: "2 ב-25" })).toBe(10);
  });
});

describe("chainHistory", () => {
  it("takes the chain's cheapest branch at each moment and writes a point only on change", () => {
    const prices = [
      shelf(1, 10, 1, 10), // branch 1: 10, then 12 from day 10
      shelf(1, 12, 10, null),
      shelf(2, 11, 1, null), // branch 2: 11 throughout
    ];
    const [h] = chainHistory(prices, [], day(1), day(20));
    expect(h!.points).toEqual([
      { at: day(1).toISOString(), regular: 10, best: 10, promotion: null },
      // Branch 1 went up to 12, so branch 2's 11 is now the cheapest.
      { at: day(10).toISOString(), regular: 11, best: 11, promotion: null },
    ]);
  });

  it("shows a promotion as a lower price for as long as it runs", () => {
    const deal: PromoPeriod = {
      chain: "שופרסל",
      storeId: 1,
      promotion: { kind: "bundle", quantity: 2, price: 16, description: "2 ב-16" },
      from: day(5),
      to: day(8),
    };
    const [h] = chainHistory([shelf(1, 10, 1, null)], [deal], day(1), day(20));
    expect(h!.points.map((p) => [p.at.slice(8, 10), p.regular, p.best, p.promotion])).toEqual([
      ["01", 10, 10, null],
      ["05", 10, 8, "2 ב-16"],
      ["08", 10, 10, null],
    ]);
  });

  it("starts at the window, ignores what happened before it, and keeps chains apart", () => {
    const prices = [shelf(1, 9, 1, 15), shelf(1, 10, 15, null), shelf(3, 20, 1, null, "רמי לוי")];
    const history = chainHistory(prices, [], day(12), day(20));
    expect(history.map((h) => [h.chain, h.points.map((p) => [p.at.slice(8, 10), p.regular])])).toEqual([
      ["רמי לוי", [["12", 20]]],
      ["שופרסל", [["12", 9], ["15", 10]]],
    ]);
  });

  it("counts the branches loaded one after another in a daily run as one change", () => {
    const at = (day: number, hour: number, minute: number) => new Date(Date.UTC(2026, 10, day, hour, minute));
    const prices: PricePeriod[] = [
      { chain: "ויקטורי", storeId: 1, price: 19.9, from: at(17, 3, 15), to: null },
      { chain: "ויקטורי", storeId: 2, price: 15.9, from: at(17, 3, 20), to: null },
    ];
    const [h] = chainHistory(prices, [], day(1), day(20));
    expect(h!.points).toEqual([{ at: at(17, 3, 15).toISOString(), regular: 15.9, best: 15.9, promotion: null }]);
  });
});
