import type { PriceFile, PriceItem } from "./types.js";

/**
 * Checks that decide whether a price file is trusted enough to touch the
 * database. A rejected file leaves yesterday's prices in place, which is
 * better than writing a broken list (closing thousands of prices because a
 * download was cut short).
 */
export const LIMITS = {
  maxPrice: 5_000, // ₪; anything above is a data error for a supermarket
  maxSkippedShare: 0.05, // reject if more than 5% of lines are unusable
  minShareOfPrevious: 0.5, // reject if the list shrank by more than half since the last good run
  minItems: 100,
};

export type QualityResult =
  | { ok: true; items: PriceItem[]; skipped: number }
  | { ok: false; reason: string };

export function checkPriceFile(file: PriceFile, previousItemCount: number | null): QualityResult {
  // Drop absurd prices, and keep one line per item code (the last one wins).
  const byCode = new Map<string, PriceItem>();
  let skipped = file.skipped;
  for (const item of file.items) {
    if (item.price > LIMITS.maxPrice) {
      skipped++;
      continue;
    }
    byCode.set(item.itemCode, item);
  }
  const items = [...byCode.values()];
  const total = file.items.length + file.skipped;

  if (items.length < LIMITS.minItems) {
    return { ok: false, reason: `only ${items.length} usable items` };
  }
  if (total > 0 && skipped / total > LIMITS.maxSkippedShare) {
    return { ok: false, reason: `${skipped} of ${total} lines unusable` };
  }
  if (previousItemCount && items.length < previousItemCount * LIMITS.minShareOfPrevious) {
    return {
      ok: false,
      reason: `${items.length} items, down from ${previousItemCount} in the last good run`,
    };
  }
  return { ok: true, items, skipped };
}
