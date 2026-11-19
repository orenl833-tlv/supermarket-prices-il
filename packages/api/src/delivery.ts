import { distanceKm, type DeliveryRule, type Store } from "@spil/engine";
import type pg from "pg";

/**
 * Home-delivery terms per chain. They are not in the price files (the law
 * covers prices, not delivery), so they are entered by hand from each chain's
 * site and change rarely; a monthly workflow reminds the owner to check them
 * (.github/workflows/delivery-terms-reminder.yml). A chain whose fee or
 * minimum is still null is left out of the delivery comparison.
 */
export interface DeliveryTerms {
  chain: string;
  fee: number | null;
  minimumOrder: number | null;
  freeAbove?: number;
  /**
   * Delivers only north of this latitude in Tel Aviv. Rami Levy lists
   * "מרכז וצפון תל אביב (עד ארלוזורוב)"; Arlozorov street is at about 32.086.
   */
  northOfLat?: number;
  /**
   * The chain publishes no price file for its online store (Rami Levy's
   * "מרלוג אינטרנט" has none), so its nearest branch's prices stand in. A check
   * on 19.11.2026 found Rami Levy's online prices equal to or a little below
   * its branch prices (milk 7.20 online vs 7.35, rice 11.00 vs 11.90).
   */
  estimateFromBranch?: boolean;
  /** When the terms were last checked against the chain's site (YYYY-MM-DD). */
  checkedAt: string | null;
  source: string;
}

export const DELIVERY_TERMS: DeliveryTerms[] = [
  {
    chain: "שופרסל",
    // Terms, section 37: "דמי משלוח בסך 35.90 ש"ח ... בכל סכום הזמנה"; the same in every slot; no minimum.
    fee: 35.9,
    minimumOrder: 0,
    checkedAt: "2026-11-19",
    source: "https://www.shufersal.co.il/online/he/regu-online",
  },
  {
    chain: "רמי לוי",
    // "עלות המשלוח - 35.90 ש"ח"; FAQ: no minimum order.
    fee: 35.9,
    minimumOrder: 0,
    northOfLat: 32.086,
    estimateFromBranch: true,
    checkedAt: "2026-11-19",
    source: "https://www.rami-levy.co.il/he/orders-and-deliveries",
  },
];

type Usable = DeliveryTerms & { fee: number; minimumOrder: number };

/** Terms that are complete enough to compare. */
export function usableTerms(terms: DeliveryTerms[]): Usable[] {
  return terms.filter((t): t is Usable => t.fee !== null && t.minimumOrder !== null);
}

/** Terms that deliver to this point (some chains cover only part of the city). */
export function termsFor(terms: DeliveryTerms[], point: { lat: number; lon: number }): Usable[] {
  return usableTerms(terms).filter((t) => t.northOfLat === undefined || point.lat >= t.northOfLat);
}

export type DeliveryStore = Store & { address: null; lat: null; lon: null; priceNote: string | null };

/**
 * The stores to price delivery from, as engine stores (distance 0: delivery
 * has no walk), and each one's delivery rule: a chain's online store, or for a
 * chain without online prices, its branch nearest to the customer.
 */
export async function onlineStores(
  db: pg.Pool,
  terms: DeliveryTerms[],
  point: { lat: number; lon: number },
): Promise<{ stores: DeliveryStore[]; rules: Map<number, DeliveryRule> }> {
  const usable = termsFor(terms, point);
  if (usable.length === 0) return { stores: [], rules: new Map() };
  const { rows } = await db.query<{ id: number; name: string; chain: string; online: boolean; lat: number | null; lon: number | null }>(
    `SELECT s.id, s.name, c.name AS chain, s.online, s.lat, s.lon
     FROM stores s JOIN chains c ON c.id = s.chain_id
     WHERE c.name = ANY($1::text[]) AND (s.online OR s.lat IS NOT NULL)`,
    [usable.map((t) => t.chain)],
  );

  const stores: DeliveryStore[] = [];
  const rules = new Map<number, DeliveryRule>();
  for (const t of usable) {
    const chainRows = rows.filter((r) => r.chain === t.chain);
    const source = t.estimateFromBranch
      ? chainRows
          .filter((r) => !r.online && r.lat !== null && r.lon !== null)
          .sort((a, b) => distanceKm(point, a as { lat: number; lon: number }) - distanceKm(point, b as { lat: number; lon: number }))[0]
      : chainRows.find((r) => r.online);
    if (!source) continue;
    stores.push({
      id: source.id,
      name: t.estimateFromBranch ? "משלוח" : source.name,
      chain: t.chain,
      distanceKm: 0,
      address: null,
      lat: null,
      lon: null,
      priceNote: t.estimateFromBranch ? `מחיר משוער לפי סניף ${source.name}; באתר לרוב זהה או מעט זול יותר` : null,
    });
    rules.set(source.id, { fee: t.fee, minimumOrder: t.minimumOrder, ...(t.freeAbove ? { freeAbove: t.freeAbove } : {}) });
  }
  return { stores, rules };
}
