import { fileURLToPath } from "node:url";
import type pg from "pg";
import { shufersal } from "./chains/shufersal.js";
import { doralon, ramiLevy, yochananof } from "./chains/publishedprices.js";
import { areaFromEnv, isInArea } from "./area.js";
import type { ChainSource } from "./chains/types.js";
import { applyPrices, upsertChain, upsertProducts, upsertStores } from "./db/load.js";
import { migrate } from "./db/migrate.js";
import { createPool, inTransaction } from "./db/pool.js";
import { decodeFile } from "./encoding.js";
import { parseFileName } from "./filename.js";
import { classifyProducts } from "./classify.js";
import { geocodeStores } from "./geocode.js";
import { parsePriceFull, parseStores } from "./parse.js";
import { checkPriceFile } from "./quality.js";

/**
 * Daily ingest: for each chain, refresh the branch list, then load the newest
 * full price file of every branch in the target cities.
 *
 * One branch failing does not stop the others; the process exits non-zero at
 * the end so the scheduler marks the run as failed.
 */
const CHAINS: ChainSource[] = [shufersal, ramiLevy, doralon, yochananof];
const AREA = areaFromEnv();

type Outcome = "loaded" | "skipped" | "rejected" | "failed";

export async function ingest(pool: pg.Pool): Promise<Record<Outcome, number>> {
  const totals: Record<Outcome, number> = { loaded: 0, skipped: 0, rejected: 0, failed: 0 };

  for (const chain of CHAINS) {
    let storeIds: Map<string, number>;
    try {
      const storesFile = await chain.latestStoresFile();
      const stores = parseStores(decodeFile(await chain.download(storesFile))).filter((s) =>
        isInArea(s, AREA, chain.extraStoreCodes),
      );
      const chainId = await upsertChain(pool, chain.code, chain.name);
      storeIds = await upsertStores(pool, chainId, stores);
      console.log(`${chain.name}: ${stores.length} branches in target cities`);

      for (const [storeCode, storeId] of storeIds) {
        const outcome = await ingestStore(pool, chain, chainId, storeCode, storeId);
        totals[outcome]++;
      }
    } catch (err) {
      console.error(`${chain.name}: ${message(err)}`);
      totals.failed++;
    }
  }
  return totals;
}

async function ingestStore(
  pool: pg.Pool,
  chain: ChainSource,
  chainId: number,
  storeCode: string,
  storeId: number,
): Promise<Outcome> {
  const label = `${chain.name} #${storeCode}`;
  const file = await chain.latestPriceFullFile(storeCode).catch((err) => {
    console.error(`${label}: listing failed: ${message(err)}`);
    return undefined;
  });
  if (file === undefined) return "failed";
  if (file === null) {
    console.log(`${label}: no price file published`);
    return "skipped";
  }
  const info = parseFileName(file.name);
  if (!info) {
    console.error(`${label}: unexpected file name ${file.name}`);
    return "failed";
  }

  // Skip files already handled, and files older than the last good one.
  // A failed file may be retried; any other status means it was handled.
  const { rows: seen } = await pool.query(
    `SELECT 1 FROM ingest_runs
     WHERE (file_name = $1 AND status <> 'failed')
        OR (store_id = $2 AND status = 'ok' AND file_time >= $3)
     LIMIT 1`,
    [file.name, storeId, info.time],
  );
  if (seen.length > 0) return "skipped";

  const { rows: run } = await pool.query<{ id: number }>(
    `INSERT INTO ingest_runs (store_id, file_name, file_time, status)
     VALUES ($1, $2, $3, 'running')
     ON CONFLICT (file_name) DO UPDATE
       SET status = 'running', started_at = now(), finished_at = NULL, error = NULL
     RETURNING id`,
    [storeId, file.name, info.time],
  );
  const runId = run[0]!.id;
  const finish = (status: string, fields: Record<string, unknown> = {}) =>
    pool.query(
      `UPDATE ingest_runs SET status = $2, finished_at = now(),
         items_read = $3, items_skipped = $4, prices_changed = $5, error = $6
       WHERE id = $1`,
      [runId, status, fields.read ?? null, fields.skipped ?? null, fields.changed ?? null, fields.error ?? null],
    );

  try {
    const parsed = parsePriceFull(decodeFile(await chain.download(file)));
    if (parsed.chainCode !== chain.code || parsed.storeCode !== storeCode) {
      throw new Error(`file is for ${parsed.chainCode}/${parsed.storeCode}`);
    }

    const { rows: prev } = await pool.query<{ items_read: number }>(
      `SELECT items_read FROM ingest_runs
       WHERE store_id = $1 AND status = 'ok' ORDER BY file_time DESC LIMIT 1`,
      [storeId],
    );
    const quality = checkPriceFile(parsed, prev[0]?.items_read ?? null);
    if (!quality.ok) {
      await finish("rejected", { read: parsed.items.length, skipped: parsed.skipped, error: quality.reason });
      console.warn(`${label}: rejected ${file.name}: ${quality.reason}`);
      return "rejected";
    }

    const { opened, closed } = await inTransaction(pool, async (client) => {
      const productIds = await upsertProducts(client, chainId, quality.items);
      const prices = quality.items.map((i) => ({
        productId: productIds.get(i.itemCode)!,
        price: i.price,
      }));
      return applyPrices(client, storeId, info.time, prices);
    });

    await finish("ok", { read: quality.items.length, skipped: quality.skipped, changed: opened + closed });
    console.log(`${label}: ${quality.items.length} items, ${opened} new prices, ${closed} closed`);
    return "loaded";
  } catch (err) {
    await finish("failed", { error: message(err) });
    console.error(`${label}: failed: ${message(err)}`);
    return "failed";
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try {
    await migrate(pool);
    const totals = await ingest(pool);
    const { classified, changed } = await classifyProducts(pool);
    console.log(`categories: ${classified} products classified, ${changed} changed`);
    // Coordinates for new or moved branches. A geocoding problem is logged
    // but does not fail the run: prices are still correct without it.
    const geo = await geocodeStores(pool).catch((err) => ({ updated: 0, failed: [message(err)] }));
    if (geo.updated > 0) console.log(`geocoded ${geo.updated} branches`);
    for (const f of geo.failed) console.warn(`geocoding: ${f}`);
    console.log("done", totals);
    if (totals.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
