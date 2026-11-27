import type pg from "pg";

/**
 * "מציאות היום": products that one chain sells far below the others today.
 *
 * For each packaged product (barcode, not sold by weight) we take each
 * chain's best effective unit price in Tel Aviv: the regular price, or a
 * promotion's price per unit when lower ("2 ב-24" is 12 a unit; "1+1" is half
 * price). A deal is a chain whose price is well below the median of the other
 * chains. A huge gap is more often a data error (a different pack size under
 * the same barcode, a stale price) than a bargain, so gaps are capped.
 */
export const MIN_SAVING = 0.25;
export const MAX_SAVING = 0.7;
/** The product must be sold by at least this many chains, so "the others" means something. */
export const MIN_CHAINS = 3;

export interface ChainPrice {
  productId: number;
  name: string;
  chain: string;
  price: number;
  /** The promotion behind the price, if any ("2ב24 ..."). */
  promotion: string | null;
}

export interface Deal {
  productId: number;
  name: string;
  chain: string;
  price: number;
  promotion: string | null;
  /** Median of the other chains' best prices. */
  othersPrice: number;
  saving: number;
}

/** Pick the deals from each chain's best price per product. Pure, so it is tested without a database. */
export function pickDeals(rows: ChainPrice[], limit: number): Deal[] {
  const byProduct = new Map<number, ChainPrice[]>();
  for (const r of rows) byProduct.set(r.productId, [...(byProduct.get(r.productId) ?? []), r]);

  const deals: Deal[] = [];
  for (const chains of byProduct.values()) {
    if (chains.length < MIN_CHAINS) continue;
    const best = chains.reduce((a, b) => (b.price < a.price ? b : a));
    const othersPrice = median(chains.filter((c) => c !== best).map((c) => c.price));
    const saving = 1 - best.price / othersPrice;
    if (saving >= MIN_SAVING && saving <= MAX_SAVING) {
      deals.push({ ...best, othersPrice: round(othersPrice), saving: round(saving) });
    }
  }
  // Biggest saving first; on equal savings, the bigger shekel difference.
  deals.sort((a, b) => b.saving - a.saving || b.othersPrice - b.price - (a.othersPrice - a.price));
  return deals.slice(0, limit);
}

/**
 * Each chain's best effective unit price for products with a real price gap
 * between chains. The SQL narrows the candidates (a spread of at least 25%
 * between the cheapest and dearest chain); pickDeals decides.
 */
export async function chainPrices(db: pg.Pool, now = new Date()): Promise<ChainPrice[]> {
  const { rows } = await db.query<{
    product_id: number;
    name: string;
    chain: string;
    price: number;
    promotion: string | null;
  }>(
    `WITH unit AS (
       SELECT pc.product_id, s.chain_id,
              -- per-unit price under each active promotion without a minimum purchase
              LEAST(pc.price, CASE sp.kind
                WHEN 'unitPrice' THEN sp.price
                WHEN 'bundle' THEN sp.price / sp.quantity
                WHEN 'buyGet' THEN pc.price * (sp.quantity + sp.get_quantity * (1 - sp.discount))
                                   / (sp.quantity + sp.get_quantity)
                ELSE pc.price END) AS price,
              pc.price AS regular, sp.description
       FROM price_changes pc
       JOIN stores s ON s.id = pc.store_id
       JOIN products p ON p.id = pc.product_id
       LEFT JOIN store_promotions sp
         ON sp.store_id = pc.store_id AND sp.product_id = pc.product_id
        AND sp.starts_at <= $1 AND sp.ends_at > $1 AND sp.ended_at IS NULL AND sp.min_purchase IS NULL AND sp.club_name IS NULL
       WHERE pc.valid_to IS NULL AND p.barcode IS NOT NULL AND NOT p.is_weighted
     ),
     per_chain AS (
       -- each chain's lowest unit price; the promotion is named only when it is what made it lower
       SELECT DISTINCT ON (product_id, chain_id) product_id, chain_id, price,
              CASE WHEN price < regular THEN description END AS promotion
       FROM unit
       ORDER BY product_id, chain_id, price, (price < regular) DESC
     ),
     candidates AS (
       SELECT product_id FROM per_chain
       GROUP BY product_id
       HAVING count(*) >= $2 AND min(price) <= max(price) * (1 - $3::numeric)
     )
     SELECT pcn.product_id, p.name, c.name AS chain, pcn.price::float AS price, pcn.promotion
     FROM per_chain pcn
     JOIN candidates USING (product_id)
     JOIN products p ON p.id = pcn.product_id
     JOIN chains c ON c.id = pcn.chain_id`,
    [now, MIN_CHAINS, MIN_SAVING],
  );
  return rows.map((r) => ({ productId: r.product_id, name: r.name, chain: r.chain, price: r.price, promotion: r.promotion }));
}

/** Deals change once a day, so the answer is kept for an hour. */
export function cachedDeals(db: pg.Pool, limit = 12, ttlMs = 3_600_000): () => Promise<Deal[]> {
  let cache: { at: number; deals: Promise<Deal[]> } | null = null;
  return () => {
    if (!cache || Date.now() - cache.at > ttlMs) {
      const deals = chainPrices(db).then((rows) => pickDeals(rows, limit));
      cache = { at: Date.now(), deals };
      deals.catch(() => (cache = null)); // do not keep a failure
    }
    return cache.deals;
  };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
