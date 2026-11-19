import type { DeliveryRule, Store } from "@spil/engine";
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
  /** When the terms were last checked against the chain's site (YYYY-MM-DD). */
  checkedAt: string | null;
  source: string;
}

export const DELIVERY_TERMS: DeliveryTerms[] = [
  { chain: "שופרסל", fee: null, minimumOrder: null, checkedAt: null, source: "https://www.shufersal.co.il/online/" },
  { chain: "רמי לוי", fee: null, minimumOrder: null, checkedAt: null, source: "https://www.rami-levy.co.il/" },
];

/** Terms that are complete enough to compare. */
export function usableTerms(terms: DeliveryTerms[]): Array<DeliveryTerms & { fee: number; minimumOrder: number }> {
  return terms.filter((t): t is DeliveryTerms & { fee: number; minimumOrder: number } => t.fee !== null && t.minimumOrder !== null);
}

/**
 * The online stores of chains with usable terms, as engine stores (distance 0:
 * delivery has no walk), and each one's delivery rule.
 */
export async function onlineStores(
  db: pg.Pool,
  terms: DeliveryTerms[],
): Promise<{ stores: Array<Store & { address: null; lat: null; lon: null }>; rules: Map<number, DeliveryRule> }> {
  const usable = usableTerms(terms);
  if (usable.length === 0) return { stores: [], rules: new Map() };
  const { rows } = await db.query<{ id: number; name: string; chain: string }>(
    `SELECT s.id, s.name, c.name AS chain
     FROM stores s JOIN chains c ON c.id = s.chain_id
     WHERE s.online AND c.name = ANY($1::text[])`,
    [usable.map((t) => t.chain)],
  );
  const byChain = new Map(usable.map((t) => [t.chain, t]));
  const rules = new Map<number, DeliveryRule>();
  for (const r of rows) {
    const t = byChain.get(r.chain)!;
    rules.set(r.id, { fee: t.fee, minimumOrder: t.minimumOrder, ...(t.freeAbove ? { freeAbove: t.freeAbove } : {}) });
  }
  return {
    stores: rows.map((r) => ({ id: r.id, name: r.name, chain: r.chain, distanceKm: 0, address: null, lat: null, lon: null })),
    rules,
  };
}
