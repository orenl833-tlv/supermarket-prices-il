import { promoCost, type Promotion } from "@spil/engine";
import type pg from "pg";
import { toPromotion } from "./queries.js";

/**
 * Price history of one product, per chain, for the chart.
 *
 * price_changes keeps one row per period with the same price (valid_from to
 * valid_to), and store_promotions keeps promotions after they end. From those
 * periods we build, for each chain, a step series over time:
 *
 *   regular  the lowest shelf price among the chain's Tel Aviv branches
 *   best     the lowest price per unit once promotions are counted
 *            ("2 ב-24" is 12 a unit, "1+1" half price)
 *
 * Only promotions open to every customer with no minimum purchase are
 * counted, as in "מציאות היום". Online stores are left out: the chart is about
 * shelf prices.
 */

export interface PricePeriod {
  chain: string;
  storeId: number;
  price: number;
  from: Date;
  to: Date | null; // null = current price
}

export interface PromoPeriod {
  chain: string;
  storeId: number;
  promotion: Promotion;
  from: Date;
  to: Date; // the earlier of its end date and the day it stopped being published
}

export interface HistoryPoint {
  /** From this time until the next point (or now), these prices held. */
  at: string;
  regular: number;
  best: number;
  /** The promotion behind `best`, when it is below `regular`. */
  promotion: string | null;
}

export interface ChainHistory {
  chain: string;
  points: HistoryPoint[];
}

/** Units one "round" of the deal covers: 1 at a unit price, N in "N for X", N+M in "buy N get M". */
function dealUnits(p: Promotion): number {
  if (p.kind === "bundle") return p.quantity;
  if (p.kind === "buyGet") return p.buy + p.get;
  return 1;
}

/** Price per unit when buying exactly one round of the deal. */
export function unitPriceUnder(regular: number, p: Promotion): number {
  const units = dealUnits(p);
  return Math.round((promoCost(regular, units, p) / units) * 100) / 100;
}

const validAt = (t: number, from: Date, to: Date | null) => from.getTime() <= t && (to === null || to.getTime() > t);

/**
 * Turn price and promotion periods into one step series per chain. Pure, so
 * it is tested without a database. A point is written only where something
 * changes, so a price that held for a month is one point.
 */
export function chainHistory(prices: PricePeriod[], promos: PromoPeriod[], since: Date, now: Date): ChainHistory[] {
  const chains = [...new Set(prices.map((p) => p.chain))].sort();
  return chains.map((chain) => {
    const chainPrices = prices.filter((p) => p.chain === chain);
    const chainPromos = promos.filter((p) => p.chain === chain);

    // Prices can only change where some period starts or ends.
    const times = new Set<number>([since.getTime()]);
    for (const p of [...chainPrices, ...chainPromos]) {
      for (const d of [p.from, p.to]) {
        if (d && d > since && d <= now) times.add(d.getTime());
      }
    }

    const points: HistoryPoint[] = [];
    for (const t of [...times].sort((a, b) => a - b)) {
      let regular = Infinity;
      let best = Infinity;
      let promotion: string | null = null;
      for (const shelf of chainPrices.filter((p) => validAt(t, p.from, p.to))) {
        regular = Math.min(regular, shelf.price);
        if (shelf.price < best) {
          best = shelf.price;
          promotion = null;
        }
        // Each promotion is priced against the regular price of its own branch.
        for (const deal of chainPromos.filter((d) => d.storeId === shelf.storeId && validAt(t, d.from, d.to))) {
          const unit = unitPriceUnder(shelf.price, deal.promotion);
          if (unit < best) {
            best = unit;
            promotion = deal.promotion.description;
          }
        }
      }
      if (regular === Infinity) continue; // no branch had a price yet
      if (best >= regular) promotion = null;
      const last = points.at(-1);
      if (last && last.regular === regular && last.best === best && last.promotion === promotion) continue;
      points.push({ at: new Date(t).toISOString(), regular, best, promotion });
    }
    return { chain, points };
  });
}

export async function productHistory(
  db: pg.Pool,
  productId: number,
  days: number,
  now = new Date(),
): Promise<{ name: string; since: string; now: string; chains: ChainHistory[] } | null> {
  const since = new Date(now.getTime() - days * 86_400_000);
  const { rows: product } = await db.query<{ name: string }>("SELECT name FROM products WHERE id = $1", [productId]);
  if (product.length === 0) return null;

  const { rows: prices } = await db.query<{ chain: string; store_id: number; price: number; valid_from: Date; valid_to: Date | null }>(
    `SELECT c.name AS chain, pc.store_id, pc.price::float AS price, pc.valid_from, pc.valid_to
     FROM price_changes pc
     JOIN stores s ON s.id = pc.store_id
     JOIN chains c ON c.id = s.chain_id
     WHERE pc.product_id = $1 AND NOT s.online
       AND (pc.valid_to IS NULL OR pc.valid_to > $2)`,
    [productId, since],
  );
  const { rows: promos } = await db.query(
    `SELECT c.name AS chain, sp.store_id, sp.description, sp.kind, sp.quantity, sp.get_quantity,
            sp.price::float AS price, sp.discount::float AS discount, sp.min_purchase, sp.max_units, sp.club_name,
            sp.starts_at, LEAST(sp.ends_at, COALESCE(sp.ended_at, sp.ends_at)) AS ends
     FROM store_promotions sp
     JOIN stores s ON s.id = sp.store_id
     JOIN chains c ON c.id = s.chain_id
     WHERE sp.product_id = $1 AND NOT s.online
       AND sp.min_purchase IS NULL AND sp.club_name IS NULL
       AND sp.starts_at <= $3 AND LEAST(sp.ends_at, COALESCE(sp.ended_at, sp.ends_at)) > $2`,
    [productId, since, now],
  );

  const chains = chainHistory(
    prices.map((r) => ({ chain: r.chain, storeId: r.store_id, price: r.price, from: r.valid_from, to: r.valid_to })),
    promos.flatMap((r) => {
      const promotion = toPromotion(r);
      return promotion ? [{ chain: r.chain, storeId: r.store_id, promotion, from: r.starts_at, to: r.ends }] : [];
    }),
    since,
    now,
  );
  return { name: product[0]!.name, since: since.toISOString(), now: now.toISOString(), chains };
}
