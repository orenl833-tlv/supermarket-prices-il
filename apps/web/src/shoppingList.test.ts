import { describe, expect, it } from "vitest";
import type { Plan } from "./api";
import { planText } from "./shoppingList";

const store = (id: number, chain: string, name: string, address: string | null) => ({
  id, name, chain, address, distanceKm: 0.4, lat: 32.08, lon: 34.78,
});

const names: Record<number, string> = { 1: "חלב 3%", 2: "לחם", 3: "ביצים L", 4: "ביצים M", 5: "קפה" };
const name = (id: number) => names[id]!;

describe("planText", () => {
  it("lists each store's items with quantities, substitutes, missing items and the total", () => {
    const plan: Plan = {
      stops: [
        {
          store: store(10, "זולה", "דיזנגוף", "דיזנגוף 50"),
          lines: [
            { productId: 1, quantity: 2, unitPrice: 6.5, lineTotal: 13 },
            { productId: 4, quantity: 1, unitPrice: 12, lineTotal: 12, substituteFor: 3 },
          ],
          subtotal: 25,
        },
        {
          store: store(11, "יקרה", "מרכז", null),
          lines: [{ productId: 2, quantity: 1, unitPrice: 9, lineTotal: 9 }],
          subtotal: 9,
        },
      ],
      missing: [{ productId: 5, importance: "optional", penalty: 0 }],
      itemsCost: 34,
      fixedCost: 15,
      penaltyCost: 0,
      substitutionCost: 0.5,
      score: 49.5,
    };

    const text = planText(plan, name);
    const blocks = text.split("\n\n");
    expect(blocks).toHaveLength(4);
    expect(blocks[0]!.split("\n")).toEqual([
      "🛒 זולה דיזנגוף, דיזנגוף 50",
      expect.stringMatching(/^- חלב 3% ×2: .*13/),
      expect.stringMatching(/^- ביצים M \(במקום ביצים L\): .*12/),
    ]);
    expect(blocks[1]).toMatch(/^🛒 יקרה מרכז\n- לחם: .*9/);
    expect(blocks[2]).toBe("חסר: קפה");
    expect(blocks[3]).toMatch(/^סה"כ: .*34/);
  });
});
