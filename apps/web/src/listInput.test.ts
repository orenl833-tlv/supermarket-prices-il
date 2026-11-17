import { describe, expect, it } from "vitest";
import type { Product } from "./api";
import { bestMatch, splitList } from "./listInput";

const product = (id: number, name: string): Product => ({
  id, name, manufacturer: null, quantity: null, unit: null, isWeighted: false,
  storeCount: 1, chains: ["א"], minPrice: 5, maxPrice: 5,
});

describe("splitList", () => {
  it("splits on commas, trims and drops repeats and fragments", () => {
    expect(splitList("חלב, אורז ,ביצים, חלב,, x")).toEqual(["חלב", "אורז", "ביצים"]);
  });

  it("treats text without commas, or with one real item, as a single search", () => {
    expect(splitList("חלב 3%")).toBeNull();
    expect(splitList("חלב,")).toBeNull();
  });
});

describe("bestMatch", () => {
  it("prefers the category suggestion, as 'any brand'", () => {
    const milk = product(1, "חלב 3% 1 ליטר");
    expect(bestMatch("חלב", { products: [product(2, "שוקו")], suggestion: { category: "חלב", product: milk } })).toEqual(
      { term: "חלב", product: milk, anyBrand: true },
    );
  });

  it("falls back to the top result, or nothing", () => {
    const rice = product(3, "אורז פרסי");
    expect(bestMatch("אורז", { products: [rice], suggestion: null })).toEqual({ term: "אורז", product: rice, anyBrand: false });
    expect(bestMatch("קוויאר", { products: [], suggestion: null }).product).toBeNull();
  });
});
