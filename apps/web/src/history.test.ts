import { describe, expect, it } from "vitest";
import type { HistoryPoint } from "./api";
import { chainSlots, change, niceTicks, pointAt, priceRange, promoSegments, stepPath } from "./history";

const p = (day: number, regular: number, best = regular, promotion: string | null = null): HistoryPoint => ({
  at: new Date(Date.UTC(2026, 10, day)).toISOString(),
  regular,
  best,
  promotion,
});
const t = (day: number) => Date.UTC(2026, 10, day);

describe("price history helpers", () => {
  const points = [p(1, 10), p(5, 10, 8, "2 ב-16"), p(8, 12)];

  it("finds the price in force at a time", () => {
    expect(pointAt(points, t(0))).toBeNull();
    expect(pointAt(points, t(6))?.best).toBe(8);
    expect(pointAt(points, t(30))?.regular).toBe(12);
  });

  it("draws a step line that holds each price until the next change", () => {
    const x = (ms: number) => (ms - t(1)) / 86_400_000; // one unit per day
    const y = (price: number) => price;
    expect(stepPath(points.map((q) => ({ at: q.at, price: q.regular })), x, y, t(10))).toBe(
      "M0.0,10.0 H4.0 L4.0,10.0 H7.0 L7.0,12.0 H9.0",
    );
  });

  it("marks only the stretches where a promotion was lower", () => {
    expect(promoSegments(points, t(10))).toEqual([{ from: t(5), to: t(8), price: 8 }]);
  });

  it("reports the shelf price change and a range with room around it", () => {
    expect(change(points)).toBeCloseTo(0.2);
    expect(change([p(1, 10)])).toBe(0);
    const [lo, hi] = priceRange([{ points }]);
    expect(lo).toBeLessThan(8);
    expect(hi).toBeGreaterThan(12);
    // A flat price still gets a visible range.
    expect(priceRange([{ points: [p(1, 10)] }])).toEqual([9, 11]);
  });

  it("picks round tick values", () => {
    expect(niceTicks(7.4, 12.6)).toEqual([8, 10, 12]);
    expect(niceTicks(0, 100)).toEqual([0, 25, 50, 75, 100]);
  });

  it("keeps each chain's color, and gives other chains free ones", () => {
    expect([...chainSlots(["רמי לוי", "שופרסל"])]).toEqual([
      ["רמי לוי", 2],
      ["שופרסל", 1],
    ]);
    expect([...chainSlots(["שופרסל", "חדשה", "אחרת"])]).toEqual([
      ["שופרסל", 1],
      ["חדשה", 2],
      ["אחרת", 3],
    ]);
  });
});
