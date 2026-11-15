import { describe, expect, it } from "vitest";
import { checkPriceFile } from "../src/quality.js";
import type { PriceFile, PriceItem } from "../src/types.js";

const item = (code: number, price = 10): PriceItem => ({
  itemCode: String(code),
  isBarcode: true,
  name: `item ${code}`,
  manufacturer: null,
  quantity: null,
  unit: null,
  isWeighted: false,
  price,
});

const file = (items: PriceItem[], skipped = 0): PriceFile => ({
  chainCode: "1",
  storeCode: "1",
  items,
  skipped,
});

const many = (n: number) => Array.from({ length: n }, (_, i) => item(i));

describe("checkPriceFile", () => {
  it("accepts a normal file", () => {
    const result = checkPriceFile(file(many(1000)), 990);
    expect(result).toMatchObject({ ok: true, skipped: 0 });
  });

  it("drops absurd prices and duplicate codes", () => {
    const result = checkPriceFile(file([...many(200), item(1, 12), item(9999, 99_999)]), null);
    expect(result.ok && result.items).toHaveLength(200);
    expect(result.ok && result.items.find((i) => i.itemCode === "1")?.price).toBe(12);
  });

  it("rejects a file that shrank by more than half (likely truncated)", () => {
    const result = checkPriceFile(file(many(400)), 1000);
    expect(result).toEqual({ ok: false, reason: "400 items, down from 1000 in the last good run" });
  });

  it("rejects a file with too many unusable lines", () => {
    expect(checkPriceFile(file(many(500), 100), null).ok).toBe(false);
  });

  it("rejects a nearly empty file", () => {
    expect(checkPriceFile(file(many(10)), null).ok).toBe(false);
  });
});
