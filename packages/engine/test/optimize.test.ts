import { describe, expect, it } from "vitest";
import {
  combinations,
  deliveryCost,
  distanceKm,
  missingPenalties,
  optimize,
  walkingCost,
  type BasketItem,
  type PriceTable,
  type Store,
} from "../src/index.js";

const store = (id: number, distanceKm = 1): Store => ({ id, name: `store ${id}`, chain: "c", distanceKm });
const table = (rows: Record<number, Record<number, number>>): PriceTable =>
  new Map(
    Object.entries(rows).map(([s, p]) => [Number(s), new Map(Object.entries(p).map(([k, v]) => [Number(k), v]))]),
  );
const item = (productId: number, importance: BasketItem["importance"] = "normal", quantity = 1): BasketItem => ({
  productId,
  quantity,
  importance,
});

describe("optimize, one store", () => {
  const stores = [store(1), store(2)];
  const prices = table({
    1: { 10: 5, 11: 8 },
    2: { 10: 6, 11: 9 },
  });

  it("picks the store with the cheapest basket", () => {
    const basket = [item(10, "normal", 2), item(11)];
    const [best] = optimize({
      basket,
      stores,
      prices,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: missingPenalties(basket, stores, prices),
      missingTripCost: 15,
    });
    expect(best?.stops.map((s) => s.store.id)).toEqual([1]);
    expect(best?.itemsCost).toBe(18); // 2 × 5 + 8
  });

  it("breaks a price tie by distance", () => {
    const near = [store(1, 2), store(2, 0.5)];
    const same = table({ 1: { 10: 5 }, 2: { 10: 5 } });
    const [best] = optimize({
      basket: [item(10)],
      stores: near,
      prices: same,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: new Map(),
      missingTripCost: 15,
    });
    expect(best?.stops[0]?.store.id).toBe(2);
  });
});

describe("optimize, a missing item", () => {
  // Store 1 is cheap but has no product 12. Store 2 has everything but costs more.
  const stores = [store(1), store(2)];
  const prices = table({
    1: { 10: 100, 11: 100 },
    2: { 10: 120, 11: 120, 12: 20 },
  });
  const run = (basket: BasketItem[], maxStores = 1, extraStopCost = 15) =>
    optimize({
      basket,
      stores,
      prices,
      costModel: walkingCost({ extraStopCost }),
      maxStores,
      penalties: missingPenalties(basket, stores, prices),
      missingTripCost: extraStopCost,
    });

  it("charges a missing item its price elsewhere plus a trip to get it", () => {
    const [best, second] = run([item(10), item(11), item(12)]);
    expect(best?.stops[0]?.store.id).toBe(1);
    expect(best?.missing).toEqual([{ productId: 12, importance: "normal", penalty: 20 }]);
    expect(best?.score).toBe(235); // 200 + 20 for the item + 15 for the trip, still under 260
    expect(second?.stops[0]?.store.id).toBe(2);
  });

  it("prefers a complete store once the trip makes the gap too small", () => {
    const [best] = run([item(10), item(11), item(12)], 1, 50);
    expect(best?.stops[0]?.store.id).toBe(2); // 260 beats 200 + 20 + 50
  });

  it("drops a plan where nothing is bought", () => {
    const plans = run([item(12)]);
    expect(plans.map((p) => p.stops[0]?.store.id)).toEqual([2]);
  });

  it("never drops a must-have item", () => {
    const plans = run([item(10), item(11), item(12, "must")]);
    expect(plans.every((p) => p.missing.length === 0)).toBe(true);
    expect(plans[0]?.stops[0]?.store.id).toBe(2);
  });

  it("splits across two stores only when the saving beats the extra stop", () => {
    const basket = [item(10), item(11), item(12, "must")];
    // Two stops: 200 at store 1 + 20 at store 2 + 15 for the extra stop = 235 < 260.
    const [split] = run(basket, 2, 15);
    expect(split?.stops.map((s) => s.store.id)).toEqual([1, 2]);
    expect(split?.score).toBe(235);
    // With an extra stop worth 50 to the user, one store (260) wins over 270.
    const [single] = run(basket, 2, 50);
    expect(single?.stops.map((s) => s.store.id)).toEqual([2]);
  });

  it("does not charge for a missing optional item", () => {
    const [best] = run([item(10), item(11), item(12, "optional")]);
    expect(best?.penaltyCost).toBe(0);
    expect(best?.score).toBe(200);
  });
});

describe("optimize, one plan per chain", () => {
  it("keeps the nearest branch of each chain and lets other chains through", () => {
    const branch = (id: number, chain: string, distanceKm: number): Store => ({ id, name: `${id}`, chain, distanceKm });
    const stores = [branch(1, "A", 0.9), branch(2, "A", 0.3), branch(3, "A", 0.6), branch(4, "B", 1)];
    const prices = table({ 1: { 10: 5 }, 2: { 10: 5 }, 3: { 10: 5 }, 4: { 10: 6 } });
    const run = (onePerChain: boolean) =>
      optimize({
        basket: [item(10)],
        stores,
        prices,
        costModel: walkingCost({ extraStopCost: 15 }),
        maxStores: 1,
        penalties: new Map(),
        missingTripCost: 15,
        limit: 2,
        onePerChain,
      }).map((p) => p.stops[0]?.store.id);
    expect(run(false)).toEqual([2, 3]); // two branches of chain A
    expect(run(true)).toEqual([2, 4]); // nearest A, then chain B
  });
});

describe("optimize, delivery", () => {
  const stores = [store(1), store(2)];
  const prices = table({
    1: { 10: 100, 11: 100 },
    2: { 10: 120, 11: 120, 12: 20 },
  });
  const rules = new Map([
    [1, { fee: 30, minimumOrder: 150 }],
    [2, { fee: 30, minimumOrder: 150 }],
  ]);

  it("rejects a split that leaves one order below its minimum", () => {
    const basket = [item(10), item(11), item(12, "must")];
    const plans = optimize({
      basket,
      stores,
      prices,
      costModel: deliveryCost(rules),
      maxStores: 2,
      penalties: new Map(),
      missingTripCost: 30,
    });
    // Ordering only product 12 from store 2 (₪20) is below its ₪150 minimum.
    expect(plans.map((p) => p.stops.map((s) => s.store.id))).toEqual([[2]]);
    expect(plans[0]?.score).toBe(290); // 260 + one delivery fee
  });
});

describe("helpers", () => {
  it("lists combinations of 1..k, smallest first", () => {
    expect([...combinations(["a", "b", "c"], 2)]).toEqual([
      ["a"],
      ["a", "b"],
      ["a", "c"],
      ["b"],
      ["b", "c"],
      ["c"],
    ]);
  });

  it("computes distances", () => {
    // Dizengoff Center to Azrieli, about 1.5 km.
    const d = distanceKm({ lat: 32.0753, lon: 34.7755 }, { lat: 32.0742, lon: 34.7918 });
    expect(d).toBeGreaterThan(1.4);
    expect(d).toBeLessThan(1.7);
  });
});

describe("optimize, substitutes", () => {
  // Store 1 has milk (10) but not our eggs (12); it has other eggs (13) for 14.
  // Store 2 has both exact products but costs more overall.
  const stores = [store(1), store(2)];
  const prices = table({
    1: { 10: 7, 13: 14 },
    2: { 10: 8, 12: 18 },
  });
  const substitutes = new Map([
    [1, new Map([[12, { productId: 13, quantity: 1, unitPrice: 14, lineTotal: 14, penalty: 0.5 }]])],
  ]);
  const run = (basket: BasketItem[], subs = substitutes) =>
    optimize({
      basket,
      stores,
      prices,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: missingPenalties(basket, stores, prices),
      missingTripCost: 15,
      substitutes: subs,
    });

  it("uses a close substitute where the exact product is missing", () => {
    const [best] = run([item(10), item(12)]);
    expect(best?.stops[0]?.store.id).toBe(1);
    expect(best?.stops[0]?.lines[1]).toEqual({
      productId: 13,
      quantity: 1,
      unitPrice: 14,
      lineTotal: 14,
      substituteFor: 12,
    });
    expect(best?.missing).toEqual([]);
    expect(best?.substitutionCost).toBe(0.5);
    expect(best?.score).toBe(21.5); // 7 + 14 + 0.5, beats 26 at store 2
  });

  it("lets a substitute satisfy a must-have item", () => {
    const [best] = run([item(10), item(12, "must")]);
    expect(best?.stops[0]?.store.id).toBe(1);
  });

  it("without substitutes the same store is charged for a missing item", () => {
    const [best] = run([item(10), item(12)], new Map());
    expect(best?.stops[0]?.store.id).toBe(2); // 26 beats 7 + 18 penalty + 15 trip
  });

  it("ignores a store's substitute when that store has the exact product", () => {
    const tie = table({ 1: { 10: 7 }, 2: { 10: 6.5 } });
    const [best] = optimize({
      basket: [item(10)],
      stores,
      prices: tie,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: new Map(),
      missingTripCost: 15,
      substitutes: new Map([[1, new Map([[10, { productId: 99, quantity: 1, unitPrice: 6, lineTotal: 6, penalty: 0.5 }]])]]),
    });
    // Store 1 has the exact product, so its substitute is not considered at all.
    expect(best?.stops[0]?.store.id).toBe(2);
    expect(best?.stops[0]?.lines[0]?.substituteFor).toBeUndefined();
  });
});

describe("optimize, any brand", () => {
  // Store 1 sells the exact product (10) for 15 and a close substitute for 12.
  const stores = [store(1)];
  const prices = table({ 1: { 10: 15, 13: 12 } });
  const substitutes = new Map([
    [1, new Map([[10, { productId: 13, quantity: 1, unitPrice: 12, lineTotal: 12, penalty: 0 }]])],
  ]);
  const run = (anyBrand: boolean) =>
    optimize({
      basket: [{ ...item(10), anyBrand }],
      stores,
      prices,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: new Map(),
      missingTripCost: 15,
      substitutes,
    })[0]?.stops[0]?.lines[0];

  it("takes the cheaper substitute even where the exact product is sold", () => {
    expect(run(true)).toMatchObject({ productId: 13, lineTotal: 12, substituteFor: 10 });
  });

  it("sticks to the exact product when 'any brand' is off", () => {
    expect(run(false)).toMatchObject({ productId: 10, lineTotal: 15 });
    expect(run(false)?.substituteFor).toBeUndefined();
  });
});

describe("optimize with promotions", () => {
  // Rice: 10 in store 1, 8 in store 2. Store 1 has 2+1 on rice.
  const stores = [store(1), store(2)];
  const prices = table({ 1: { 20: 10 }, 2: { 20: 8 } });
  const promotions = new Map([
    [1, new Map([[20, [{ kind: "buyGet" as const, buy: 2, get: 1, discount: 1, description: "2+1 אורז" }]]])],
  ]);
  const run = (quantity: number) => {
    const basket = [item(20, "normal", quantity)];
    return optimize({
      basket,
      stores,
      prices,
      promotions,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: missingPenalties(basket, stores, prices),
      missingTripCost: 0,
    });
  };

  it("2 bags: the store with 2+1 costs 20 for 3 bags, but the other store's 2 bags at 16 still win", () => {
    const [best, second] = run(2);
    expect(best!.stops[0]!.store.id).toBe(2);
    expect(best!.itemsCost).toBe(16);
    expect(second!.stops[0]!.lines[0]).toMatchObject({ quantity: 3, lineTotal: 20, extraUnits: 1, promotion: "2+1 אורז" });
  });

  it("3 bags: 2+1 makes the dearer store cheaper (20 vs 24)", () => {
    const [best] = run(3);
    expect(best!.stops[0]!.store.id).toBe(1);
    expect(best!.stops[0]!.lines[0]).toMatchObject({ quantity: 3, lineTotal: 20, promotion: "2+1 אורז" });
    expect(best!.itemsCost).toBe(20);
  });
});

describe("optimize with minimum-purchase deals", () => {
  // Bisli 15.90; "ב-7.95 מעל 100" in store 1. Product 31 is the rest of the basket.
  const stores = [store(1)];
  const bisli = { kind: "unitPrice" as const, price: 7.95, minPurchase: 100, maxUnits: 2, description: "ביסלי ב-50% מעל 100" };
  const promotions = new Map([[1, new Map([[30, [bisli]]])]]);
  const run = (otherPrice: number) => {
    const prices = table({ 1: { 30: 15.9, 31: otherPrice } });
    const basket = [item(30), item(31)];
    const [best] = optimize({
      basket,
      stores,
      prices,
      promotions,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: missingPenalties(basket, stores, prices),
      missingTripCost: 0,
    });
    return best!.stops[0]!.lines.find((l) => l.productId === 30)!;
  };

  it("applies the deal when the rest of the basket reaches the minimum, not counting the product", () => {
    expect(run(100)).toMatchObject({ lineTotal: 7.95, promotion: "ביסלי ב-50% מעל 100" });
  });

  it("otherwise says how much more unlocks it (the product's own price does not count)", () => {
    const line = run(90); // 90 + 15.90 is over 100, but the product itself does not count
    expect(line.lineTotal).toBe(15.9);
    expect(line.unlock).toEqual({ minPurchase: 100, missing: 10, promotion: "ביסלי ב-50% מעל 100" });
  });
});

describe("optimize with club deals", () => {
  // Hummus 10 at chain "c" (store 1); club deal: 6 for members of the chain's club.
  const stores = [store(1)];
  const prices = table({ 1: { 40: 10 } });
  const club = { kind: "unitPrice" as const, price: 6, club: "מועדון אפליקציה", description: "חומוס ב-6 לחברי מועדון" };
  const promotions = new Map([[1, new Map([[40, [club]]])]]);
  const run = (memberChains?: Set<string>) => {
    const basket = [item(40, "normal", 2)];
    const [best] = optimize({
      basket,
      stores,
      prices,
      promotions,
      memberChains,
      costModel: walkingCost({ extraStopCost: 15 }),
      maxStores: 1,
      penalties: missingPenalties(basket, stores, prices),
      missingTripCost: 0,
    });
    return best!.stops[0]!;
  };

  it("does not give club prices to non-members, but says what membership would save", () => {
    const stop = run();
    expect(stop.subtotal).toBe(20);
    expect(stop.clubSaving).toBe(8); // 2 × (10 - 6)
  });

  it("gives club prices to members, with nothing left to save", () => {
    const stop = run(new Set(["c"]));
    expect(stop.subtotal).toBe(12);
    expect(stop.clubSaving).toBeUndefined();
  });
});

describe("deliveryCost", () => {
  const stop = (subtotal: number) => ({ store: store(1), lines: [], subtotal });
  const model = deliveryCost(new Map([[1, { fee: 30, minimumOrder: 100, freeAbove: 300 }]]));

  it("charges the fee, refuses orders below the minimum, and is free above the threshold", () => {
    expect(model.fixedCost([stop(150)])).toBe(30);
    expect(model.fixedCost([stop(90)])).toBeNull();
    expect(model.fixedCost([stop(300)])).toBe(0);
  });
});
