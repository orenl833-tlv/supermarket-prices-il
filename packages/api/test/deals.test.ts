import { describe, expect, it } from "vitest";
import { pickDeals, type ChainPrice } from "../src/deals.js";

const row = (productId: number, chain: string, price: number, promotion: string | null = null): ChainPrice => ({
  productId,
  name: `מוצר ${productId}`,
  chain,
  price,
  promotion,
});

describe("pickDeals", () => {
  it("finds a chain far below the median of the others", () => {
    const deals = pickDeals([row(1, "א", 5, "2ב10"), row(1, "ב", 10), row(1, "ג", 11), row(1, "ד", 9)], 10);
    expect(deals).toEqual([
      { productId: 1, name: "מוצר 1", chain: "א", price: 5, promotion: "2ב10", othersPrice: 10, saving: 0.5 },
    ]);
  });

  it("ignores small gaps, products in fewer than three chains, and gaps too big to be real", () => {
    expect(pickDeals([row(1, "א", 9), row(1, "ב", 10), row(1, "ג", 10)], 10)).toEqual([]); // 10% off
    expect(pickDeals([row(2, "א", 5), row(2, "ב", 10)], 10)).toEqual([]); // two chains
    expect(pickDeals([row(3, "א", 1), row(3, "ב", 10), row(3, "ג", 10)], 10)).toEqual([]); // 90% off: a data error
  });

  it("puts the biggest saving first and keeps the limit", () => {
    const rows = [
      ...[row(1, "א", 7), row(1, "ב", 10), row(1, "ג", 10)],
      ...[row(2, "א", 4), row(2, "ב", 10), row(2, "ג", 10)],
      ...[row(3, "א", 6), row(3, "ב", 10), row(3, "ג", 10)],
    ];
    expect(pickDeals(rows, 2).map((d) => d.productId)).toEqual([2, 3]);
  });
});
