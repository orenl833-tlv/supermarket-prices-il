import type { BasketEntry, Importance } from "./api";

/**
 * A shared list travels in the link itself, so sharing needs no accounts or
 * server storage: ?list=4974-2-n-0,3053-1-m-1 means
 *   product 4974, quantity 2, normal, exact brand;
 *   product 3053, quantity 1, must,   any brand.
 * Only ids go in the link; names and prices are loaded fresh when it is opened.
 */
export interface SharedItem {
  productId: number;
  quantity: number;
  importance: Importance;
  anyBrand: boolean;
}

const IMPORTANCE_CODE: Record<Importance, string> = { must: "m", normal: "n", optional: "o" };
const CODE_IMPORTANCE: Record<string, Importance> = { m: "must", n: "normal", o: "optional" };

export function encodeList(entries: BasketEntry[]): string {
  return entries
    .map((e) => `${e.product.id}-${e.quantity}-${IMPORTANCE_CODE[e.importance]}-${e.anyBrand ? 1 : 0}`)
    .join(",");
}

/** Invalid parts are skipped, so a damaged link still opens what it can. */
export function decodeList(param: string): SharedItem[] {
  return param
    .split(",")
    .slice(0, 60)
    .flatMap((part) => {
      const m = /^(\d+)-(\d+(?:\.\d+)?)-([mno])-([01])$/.exec(part.trim());
      if (!m) return [];
      const quantity = Number(m[2]);
      if (!(quantity > 0 && quantity <= 100)) return [];
      return [{ productId: Number(m[1]), quantity, importance: CODE_IMPORTANCE[m[3]!]!, anyBrand: m[4] === "1" }];
    });
}

export function shareUrl(entries: BasketEntry[], origin = window.location.origin): string {
  return `${origin}/?list=${encodeList(entries)}`;
}
