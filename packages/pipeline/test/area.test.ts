import { describe, expect, it } from "vitest";
import { isInArea, TEL_AVIV } from "../src/area.js";

const store = (cityCode: string | null, storeCode = "1") => ({
  storeCode,
  name: "x",
  address: null,
  cityCode,
});

describe("isInArea", () => {
  it("matches the CBS code", () => {
    expect(isInArea(store("5000"), TEL_AVIV)).toBe(true);
    expect(isInArea(store("6600"), TEL_AVIV)).toBe(false);
  });

  it("matches city names written as text, with spacing and quote variants", () => {
    expect(isInArea(store("תל-אביב"), TEL_AVIV)).toBe(true);
    expect(isInArea(store(" תל  אביב "), TEL_AVIV)).toBe(true);
    expect(isInArea(store("ת״א"), TEL_AVIV)).toBe(true);
    expect(isInArea(store("רמת גן"), TEL_AVIV)).toBe(false);
  });

  it("includes stores the chain lists by hand when City is unusable", () => {
    expect(isInArea(store("0", "32"), TEL_AVIV, ["32"])).toBe(true);
    expect(isInArea(store("0", "8"), TEL_AVIV, ["32"])).toBe(false);
  });
});
