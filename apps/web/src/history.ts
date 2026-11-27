import type { HistoryPoint } from "./api";

/**
 * Helpers for the price history chart, kept apart from the component so the
 * arithmetic is tested on its own.
 */

/**
 * Each chain has a fixed color slot, so a chain keeps its color whatever else
 * is on the chart. The colors are defined in styles.css (--series-1..8).
 */
const CHAIN_SLOT: Record<string, number> = {
  שופרסל: 1,
  "רמי לוי": 2,
  ויקטורי: 3,
  יוחננוף: 4,
  "AM:PM": 5,
  קרפור: 6,
};
const SLOTS = 7;

/**
 * Color slot per chain on one chart: the chain's own slot, or for a chain
 * not in the table, the first slot no other chain on the chart uses.
 */
export function chainSlots(chains: string[]): Map<string, number> {
  const slots = new Map<string, number>();
  const used = new Set(chains.map((c) => CHAIN_SLOT[c]).filter((s): s is number => s !== undefined));
  for (const chain of chains) {
    let slot = CHAIN_SLOT[chain];
    if (slot === undefined) {
      slot = 1;
      while (used.has(slot) && slot < SLOTS) slot++;
      used.add(slot);
    }
    slots.set(chain, slot);
  }
  return slots;
}

/** The point in force at time t: the last one that started at or before it. */
export function pointAt(points: HistoryPoint[], t: number): HistoryPoint | null {
  let found: HistoryPoint | null = null;
  for (const p of points) {
    if (Date.parse(p.at) <= t) found = p;
    else break;
  }
  return found;
}

/** Up to `count` round tick values covering [min, max]. */
export function niceTicks(min: number, max: number, count = 4): number[] {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw)!;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) ticks.push(Math.round(v * 100) / 100);
  return ticks;
}

/** The price range to draw: every price on the chart, with some room above and below. */
export function priceRange(chains: Array<{ points: HistoryPoint[] }>): [number, number] {
  const prices = chains.flatMap((c) => c.points.flatMap((p) => [p.regular, p.best]));
  if (prices.length === 0) return [0, 1];
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);
  const pad = (hi - lo) * 0.15 || hi * 0.1 || 1;
  return [Math.max(0, lo - pad), hi + pad];
}

/**
 * SVG path of a step line: the price holds flat until the next point, where
 * it jumps. `x` and `y` map times and prices to the chart; the last price
 * runs on to `end`.
 */
export function stepPath(
  points: Array<{ at: string; price: number }>,
  x: (t: number) => number,
  y: (price: number) => number,
  end: number,
): string {
  return points
    .map((p, i) => {
      const x0 = x(Date.parse(p.at)).toFixed(1);
      const next = i + 1 < points.length ? Date.parse(points[i + 1]!.at) : end;
      return `${i === 0 ? "M" : "L"}${x0},${y(p.price).toFixed(1)} H${x(next).toFixed(1)}`;
    })
    .join(" ");
}

/**
 * The stretches where a promotion made the price lower, as separate flat
 * segments (drawn dashed under the shelf price line).
 */
export function promoSegments(points: HistoryPoint[], end: number): Array<{ from: number; to: number; price: number }> {
  return points.flatMap((p, i) => {
    if (p.best >= p.regular) return [];
    const to = i + 1 < points.length ? Date.parse(points[i + 1]!.at) : end;
    return [{ from: Date.parse(p.at), to, price: p.best }];
  });
}

/** Change of the shelf price from the first point to the last, as a fraction (0.05 = 5% up). */
export function change(points: HistoryPoint[]): number {
  if (points.length < 2) return 0;
  return points.at(-1)!.regular / points[0]!.regular - 1;
}

/** "27.11" */
export function shortDate(iso: string | number): string {
  const d = new Date(iso);
  return d.toLocaleDateString("he-IL", { day: "numeric", month: "numeric", timeZone: "Asia/Jerusalem" });
}
