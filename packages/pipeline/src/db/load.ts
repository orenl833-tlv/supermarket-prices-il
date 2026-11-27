import type pg from "pg";
import type { PromoRow } from "../promotions.js";
import type { PriceItem, StoreRecord } from "../types.js";

type Db = pg.Pool | pg.PoolClient;

export async function upsertChain(db: Db, code: string, name: string): Promise<number> {
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO chains (code, name) VALUES ($1, $2)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [code, name],
  );
  return rows[0]!.id;
}

/** Insert or update branches; returns store_code -> stores.id. */
export async function upsertStores(
  db: Db,
  chainId: number,
  stores: StoreRecord[],
): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: number; store_code: string }>(
    `INSERT INTO stores (chain_id, store_code, name, address, city_code)
     SELECT $1, * FROM unnest($2::text[], $3::text[], $4::text[], $5::text[])
     ON CONFLICT (chain_id, store_code) DO UPDATE
       SET name = EXCLUDED.name, address = EXCLUDED.address,
           city_code = EXCLUDED.city_code, updated_at = now()
     RETURNING id, store_code`,
    [
      chainId,
      stores.map((s) => s.storeCode),
      stores.map((s) => s.name),
      stores.map((s) => s.address),
      stores.map((s) => s.cityCode),
    ],
  );
  return new Map(rows.map((r) => [r.store_code, r.id]));
}

/**
 * The branches already saved for a chain: store_code -> stores.id.
 * Used when a chain's Stores file is missing for the day (Victory sometimes
 * publishes it after its price files), so its branches can still be updated.
 */
export async function knownStores(db: Db, chainId: number): Promise<Map<string, number>> {
  const { rows } = await db.query<{ id: number; store_code: string }>(
    "SELECT id, store_code FROM stores WHERE chain_id = $1 ORDER BY store_code",
    [chainId],
  );
  return new Map(rows.map((r) => [r.store_code, r.id]));
}

/**
 * Make sure every item has a products row and a chain_products mapping.
 * Returns item_code -> products.id.
 *
 * Barcoded items (ItemType 1) share one products row across chains, matched
 * on the barcode: this is the first, simplest level of cross-chain matching.
 * Internal codes get a products row of their own, found again through
 * chain_products on later runs.
 */
export async function upsertProducts(
  db: Db,
  chainId: number,
  items: PriceItem[],
): Promise<Map<string, number>> {
  const barcoded = items.filter((i) => i.isBarcode);
  const internal = items.filter((i) => !i.isBarcode);

  // 1. Barcoded products: insert new ones, keep existing rows as they are.
  await db.query(
    `INSERT INTO products (barcode, name, manufacturer, quantity, unit, is_weighted)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::boolean[])
     ON CONFLICT (barcode) DO NOTHING`,
    columns(barcoded),
  );
  const ids = new Map<string, number>();
  const { rows: byBarcode } = await db.query<{ id: number; barcode: string }>(
    "SELECT id, barcode FROM products WHERE barcode = ANY($1::text[])",
    [barcoded.map((i) => i.itemCode)],
  );
  for (const r of byBarcode) ids.set(r.barcode, r.id);

  // 2. Internal codes: reuse the product this chain already mapped, else create one.
  const { rows: known } = await db.query<{ item_code: string; product_id: number }>(
    `SELECT item_code, product_id FROM chain_products
     WHERE chain_id = $1 AND item_code = ANY($2::text[])`,
    [chainId, internal.map((i) => i.itemCode)],
  );
  for (const r of known) ids.set(r.item_code, r.product_id);
  const fresh = internal.filter((i) => !ids.has(i.itemCode));
  if (fresh.length > 0) {
    const [, ...rest] = columns(fresh);
    const { rows: created } = await db.query<{ id: number }>(
      `INSERT INTO products (name, manufacturer, quantity, unit, is_weighted)
       SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[], $4::text[], $5::boolean[])
       RETURNING id`,
      rest,
    );
    // INSERT ... SELECT FROM unnest returns rows in input order.
    created.forEach((r, n) => ids.set(fresh[n]!.itemCode, r.id));
  }

  // 3. Record how this chain names each product.
  await db.query(
    `INSERT INTO chain_products (chain_id, item_code, product_id, raw_name)
     SELECT $1, * FROM unnest($2::text[], $3::int[], $4::text[])
     ON CONFLICT (chain_id, item_code) DO UPDATE
       SET product_id = EXCLUDED.product_id, raw_name = EXCLUDED.raw_name`,
    [chainId, items.map((i) => i.itemCode), items.map((i) => ids.get(i.itemCode)), items.map((i) => i.name)],
  );
  return ids;
}

/**
 * Apply one store's full price list as of `asOf`. This is the heart of the
 * price-history design: only differences are written.
 *
 *   1. Close every current price that changed or is no longer listed
 *      (valid_to = asOf).
 *   2. Open a new period for every listed product that has no current price
 *      left (new products, and the ones just closed in step 1).
 *
 * Running it twice with the same input changes nothing the second time.
 * Call it inside a transaction so both steps land together.
 */
export async function applyPrices(
  db: Db,
  storeId: number,
  asOf: Date,
  prices: Array<{ productId: number; price: number }>,
): Promise<{ opened: number; closed: number }> {
  // The incoming list as a table: (product_id, price), price rounded like the column.
  const incoming = `incoming AS (
    SELECT * FROM unnest($3::int[], $4::numeric(10,2)[]) AS i(product_id, price)
  )`;
  const params = [storeId, asOf, prices.map((p) => p.productId), prices.map((p) => p.price)];

  const closed = await db.query(
    `WITH ${incoming}
     UPDATE price_changes pc SET valid_to = $2
     WHERE pc.store_id = $1 AND pc.valid_to IS NULL AND pc.valid_from < $2
       AND NOT EXISTS (
         SELECT 1 FROM incoming i WHERE i.product_id = pc.product_id AND i.price = pc.price
       )`,
    params,
  );

  const opened = await db.query(
    `WITH ${incoming}
     INSERT INTO price_changes (store_id, product_id, price, valid_from)
     SELECT $1, i.product_id, i.price, $2 FROM incoming i
     WHERE NOT EXISTS (
       SELECT 1 FROM price_changes pc
       WHERE pc.store_id = $1 AND pc.product_id = i.product_id AND pc.valid_to IS NULL
     )`,
    params,
  );

  return { opened: opened.rowCount ?? 0, closed: closed.rowCount ?? 0 };
}

function columns(items: PriceItem[]) {
  return [
    items.map((i) => i.itemCode),
    items.map((i) => i.name),
    items.map((i) => i.manufacturer),
    items.map((i) => i.quantity),
    items.map((i) => i.unit),
    items.map((i) => i.isWeighted),
  ];
}

/**
 * Load a branch's promotions from its newest PromoFull file, keeping history.
 *
 * - a promotion in the file is inserted, or updated in place if already stored
 *   (and reopened if it had been marked ended);
 * - a stored promotion the file no longer lists is marked ended at the file's
 *   time. Its row stays for the price history chart.
 *
 * Items the chain has no price for (not in chain_products) are skipped.
 * Returns the number of promotions now current for the branch.
 */
export async function replacePromotions(
  db: Db,
  chainId: number,
  storeId: number,
  rows: PromoRow[],
  fileTime: Date,
): Promise<number> {
  const { rows: result } = await db.query<{ current: number }>(
    `WITH incoming AS (
       -- one row per product and promotion: a file may list an item twice
       SELECT DISTINCT ON (cp.product_id, r.promotion_id)
              cp.product_id, r.promotion_id, r.description, r.kind, r.quantity, r.get_quantity, r.price,
              r.discount, r.min_purchase, r.max_units, r.club_name, r.starts_at, r.ends_at
       FROM unnest($3::text[], $4::text[], $5::text[], $6::text[], $7::int[], $8::int[], $9::numeric[],
                   $10::numeric[], $11::numeric[], $12::int[], $13::text[], $14::timestamptz[], $15::timestamptz[])
            AS r(item_code, promotion_id, description, kind, quantity, get_quantity, price, discount,
                 min_purchase, max_units, club_name, starts_at, ends_at)
       JOIN chain_products cp ON cp.chain_id = $2 AND cp.item_code = r.item_code
     ),
     upserted AS (
       INSERT INTO store_promotions
         (store_id, product_id, promotion_id, description, kind, quantity, get_quantity, price, discount,
          min_purchase, max_units, club_name, starts_at, ends_at)
       SELECT $1, product_id, promotion_id, description, kind, quantity, get_quantity, price, discount,
              min_purchase, max_units, club_name, starts_at, ends_at
       FROM incoming
       ON CONFLICT (store_id, product_id, promotion_id) DO UPDATE SET
         description = EXCLUDED.description, kind = EXCLUDED.kind, quantity = EXCLUDED.quantity,
         get_quantity = EXCLUDED.get_quantity, price = EXCLUDED.price, discount = EXCLUDED.discount,
         min_purchase = EXCLUDED.min_purchase, max_units = EXCLUDED.max_units,
         club_name = EXCLUDED.club_name, starts_at = EXCLUDED.starts_at, ends_at = EXCLUDED.ends_at,
         ended_at = NULL
       RETURNING 1
     ),
     ended AS (
       UPDATE store_promotions sp SET ended_at = $16
       WHERE sp.store_id = $1 AND sp.ended_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM incoming i
                         WHERE i.product_id = sp.product_id AND i.promotion_id = sp.promotion_id)
       RETURNING 1
     )
     SELECT (SELECT count(*) FROM upserted)::int AS current`,
    [
      storeId,
      chainId,
      rows.map((r) => r.itemCode),
      rows.map((r) => r.promotionId),
      rows.map((r) => r.description),
      rows.map((r) => r.kind),
      rows.map((r) => r.quantity),
      rows.map((r) => r.getQuantity),
      rows.map((r) => r.price),
      rows.map((r) => r.discount),
      rows.map((r) => r.minPurchase),
      rows.map((r) => r.maxUnits),
      rows.map((r) => r.club),
      rows.map((r) => r.startsAt),
      rows.map((r) => r.endsAt),
      fileTime,
    ],
  );
  return result[0]!.current;
}
