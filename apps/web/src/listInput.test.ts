import { describe, expect, it } from "vitest";
import type { Product } from "./api";
import { chosenOption, matchOptions, OPTIONS_PER_ITEM, splitList } from "./listInput";

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

describe("matchOptions", () => {
  it("offers the category first, as 'any brand', then the search results", () => {
    const milk = product(1, "חלב 3% 1 ליטר");
    const choco = product(2, "שוקו");
    const m = matchOptions("חלב", { products: [milk, choco], suggestion: { category: "חלב", product: milk } });
    expect(m.options.map((o) => [o.label, o.anyBrand])).toEqual([
      ["חלב, כל מותג", true],
      ["חלב 3% 1 ליטר", false],
      ["שוקו", false],
    ]);
    expect(chosenOption(m)?.anyBrand).toBe(true);
  });

  it("chooses the top result when there is no category, and nothing when nothing matched", () => {
    const rice = product(3, "אורז פרסי");
    expect(chosenOption(matchOptions("אורז", { products: [rice], suggestion: null }))?.product).toBe(rice);
    const none = matchOptions("קוויאר", { products: [], suggestion: null });
    expect(none.chosen).toBeNull();
    expect(chosenOption(none)).toBeNull();
  });

  it("caps the number of products offered", () => {
    const many = Array.from({ length: 20 }, (_, i) => product(i, `מוצר ${i}`));
    expect(matchOptions("מוצר", { products: many, suggestion: null }).options).toHaveLength(OPTIONS_PER_ITEM);
  });
});
