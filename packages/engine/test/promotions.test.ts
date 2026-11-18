import { describe, expect, it } from "vitest";
import { choosePromo, promoCost, type Promotion } from "../src/promotions.js";

const twoPlusOne: Promotion = { kind: "buyGet", buy: 2, get: 1, discount: 1, description: "2+1" };
const onePlusOne: Promotion = { kind: "buyGet", buy: 1, get: 1, discount: 1, description: "1+1" };
const thirdHalf: Promotion = { kind: "buyGet", buy: 2, get: 1, discount: 0.5, description: "השלישי ב-50%" };
const twoFor24: Promotion = { kind: "bundle", quantity: 2, price: 24, description: "2 ב-24" };
const at990: Promotion = { kind: "unitPrice", price: 9.9, description: "ב-9.90" };

describe("promoCost", () => {
  it("prices buy N get M per full set, with the rest at the regular price", () => {
    expect(promoCost(10, 2, twoPlusOne)).toBe(20);
    expect(promoCost(10, 3, twoPlusOne)).toBe(20);
    expect(promoCost(10, 4, twoPlusOne)).toBe(30);
    expect(promoCost(10, 6, twoPlusOne)).toBe(40);
    expect(promoCost(10, 3, thirdHalf)).toBe(25);
  });

  it("prices bundles and unit prices", () => {
    expect(promoCost(13, 2, twoFor24)).toBe(24);
    expect(promoCost(13, 3, twoFor24)).toBe(37);
    expect(promoCost(12, 2, at990)).toBe(19.8);
  });

  it("never charges more than the regular price", () => {
    expect(promoCost(11, 2, twoFor24)).toBe(22); // "2 for 24" is no deal at 11 each
    expect(promoCost(8, 1, at990)).toBe(8);
  });
});

describe("choosePromo", () => {
  it("2 bags of rice with 2+1: takes the free third", () => {
    expect(choosePromo(10, 2, [twoPlusOne])).toMatchObject({ quantity: 3, lineTotal: 20, extraUnits: 1 });
  });

  it("1 wanted with 1+1 (2 for the price of 1): takes 2", () => {
    expect(choosePromo(10, 1, [onePlusOne])).toMatchObject({ quantity: 2, lineTotal: 10, extraUnits: 1 });
  });

  it("2 cheaper than 1: takes 2", () => {
    const odd: Promotion = { kind: "bundle", quantity: 2, price: 9, description: "2 ב-9" };
    expect(choosePromo(10, 1, [odd])).toMatchObject({ quantity: 2, lineTotal: 9, extraUnits: 1 });
  });

  it("3rd at 50%: keeps 2 and only suggests the third", () => {
    const choice = choosePromo(10, 2, [thirdHalf]);
    expect(choice).toMatchObject({ quantity: 2, lineTotal: 20, extraUnits: 0 });
    expect(choice.suggestion).toEqual({ quantity: 1, extraCost: 5, promotion: thirdHalf });
  });

  it("2 for 24 when 1 is wanted: suggests the second unit", () => {
    const choice = choosePromo(13, 1, [twoFor24]);
    expect(choice).toMatchObject({ quantity: 1, lineTotal: 13 });
    expect(choice.suggestion).toMatchObject({ quantity: 1, extraCost: 11 });
  });

  it("uses a unit price without changing the quantity", () => {
    expect(choosePromo(12, 2, [at990])).toMatchObject({ quantity: 2, lineTotal: 19.8, promotion: at990 });
  });

  it("picks the best of several promotions", () => {
    expect(choosePromo(13, 2, [at990, twoFor24])).toMatchObject({ lineTotal: 19.8, promotion: at990 });
  });

  it("leaves weighted quantities and lines without promotions alone", () => {
    expect(choosePromo(10, 1.5, [twoPlusOne])).toEqual({ quantity: 1.5, lineTotal: 15, extraUnits: 0 });
    expect(choosePromo(10, 2, [])).toEqual({ quantity: 2, lineTotal: 20, extraUnits: 0 });
  });

  it("a deal that is no deal is not used", () => {
    expect(choosePromo(11, 2, [twoFor24])).toEqual({ quantity: 2, lineTotal: 22, extraUnits: 0 });
  });
});
