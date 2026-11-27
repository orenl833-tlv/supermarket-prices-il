import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import type pg from "pg";
import { carrefour } from "./chains/carrefour.js";
import { victory } from "./chains/laibcatalog.js";
import { shufersal } from "./chains/shufersal.js";
import { doralon, ramiLevy, yochananof } from "./chains/publishedprices.js";
import { areaFromEnv, isInArea } from "./area.js";
import type { ChainSource } from "./chains/types.js";
import type { RemoteFile } from "./types.js";
import {
  applyPrices,
  knownStores,
  replacePromotions,
  upsertChain,
  upsertProducts,
  upsertStores,
} from "./db/load.js";
import { migrate } from "./db/migrate.js";
import { createPool, inTransaction } from "./db/pool.js";
import { decodeFile } from "./encoding.js";
import { parseFileName } from "./filename.js";
import { classifyProducts } from "./classify.js";
import { geocodeStores } from "./geocode.js";
import { parsePriceFull, parseStores } from "./parse.js";
import { parsePromoFull } from "./promotions.js";
import { checkPriceFile } from "./quality.js";

/**
 * Daily ingest: for each chain, refresh the branch list, then load the newest
 * full price file of every branch in the target cities.
 *
 * One branch failing does not stop the others; the process exits non-zero at
 * the end so the scheduler marks the run as failed.
 */
/**
 * Carrefour and Victory only answer Israeli IP addresses. ISRAEL_CHAINS picks
 * what a run loads:
 *   unset   the four chains reachable from anywhere (GitHub-hosted runs)
 *   "only"  just Carrefour and Victory (the self-hosted runner in Israel)
 *   "1"     all six (a full run from an Israeli machine)
 */
const ISRAEL_ONLY: ChainSource[] = [carrefour, victory];
const ANYWHERE: ChainSource[] = [shufersal, ramiLevy, doralon, yochananof];
const CHAINS: ChainSource[] =
  process.env.ISRAEL_CHAINS === "only"
    ? ISRAEL_ONLY
    : process.env.ISRAEL_CHAINS === "1"
      ? [...ANYWHERE, ...ISRAEL_ONLY]
      : ANYWHERE;
const AREA = areaFromEnv();

type Outcome = "loaded" | "skipped" | "rejected" | "failed";

export interface IngestResult {
  totals: Record<Outcome, number>;
  /** One line per failed chain or branch, for the run report. */
  failures: string[];
}

export async function ingest(pool: pg.Pool, chains: ChainSource[] = CHAINS): Promise<IngestResult> {
  const totals: Record<Outcome, number> = { loaded: 0, skipped: 0, rejected: 0, failed: 0 };
  const failures: string[] = [];
  const fail = (line: string) => {
    console.error(line);
    failures.push(line);
  };

  for (const chain of chains) {
    try {
      const chainId = await upsertChain(pool, chain.code, chain.name);
      const storeIds = await chainStores(pool, chain, chainId);

      for (const [storeCode, storeId] of storeIds) {
        const outcome = await ingestStore(pool, chain, chainId, storeCode, storeId, fail);
        totals[outcome]++;
        // Promotions only adjust prices, so a problem with them is logged but
        // does not fail the run: the branch's regular prices are still right.
        await ingestPromotions(pool, chain, chainId, storeCode, storeId).catch((err) =>
          console.warn(`${chain.name} #${storeCode}: promotions: ${message(err)}`),
        );
      }
    } catch (err) {
      fail(`${chain.name}: ${message(err)}`);
      totals.failed++;
    }
  }
  return { totals, failures };
}

/**
 * The chain's branches in the target area, from today's Stores file.
 * If that file cannot be read, the branches saved on earlier runs are used,
 * so one missing file does not hold back every branch's prices.
 */
export async function chainStores(pool: pg.Pool, chain: ChainSource, chainId: number): Promise<Map<string, number>> {
  try {
    const storesFile = await chain.latestStoresFile();
    // The online store has no city; it is kept for delivery comparisons.
    const extra = [...(chain.extraStoreCodes ?? []), ...(chain.onlineStoreCode ? [chain.onlineStoreCode] : [])];
    const stores = parseStores(await downloadText(chain, storesFile)).filter((s) => isInArea(s, AREA, extra));
    const storeIds = await upsertStores(pool, chainId, stores);
    const onlineId = chain.onlineStoreCode ? storeIds.get(chain.onlineStoreCode) : undefined;
    if (onlineId) await pool.query("UPDATE stores SET online = true WHERE id = $1", [onlineId]);
    console.log(`${chain.name}: ${stores.length} branches in target cities`);
    return storeIds;
  } catch (err) {
    const known = await knownStores(pool, chainId);
    if (known.size === 0) throw err;
    console.warn(`${chain.name}: stores file unavailable (${message(err)}); using ${known.size} known branches`);
    return known;
  }
}

/**
 * Download and decode a file, downloading again once if the bytes do not
 * decode: a dropped connection can leave a gzip file cut short
 * ("unexpected end of file"), and a second download usually succeeds.
 */
export async function downloadText(chain: ChainSource, file: RemoteFile): Promise<string> {
  try {
    return decodeFile(await chain.download(file));
  } catch (err) {
    console.warn(`${chain.name}: ${file.name}: ${message(err)}; downloading again`);
    return decodeFile(await chain.download(file));
  }
}

async function ingestStore(
  pool: pg.Pool,
  chain: ChainSource,
  chainId: number,
  storeCode: string,
  storeId: number,
  fail: (line: string) => void,
): Promise<Outcome> {
  const label = `${chain.name} #${storeCode}`;
  const file = await chain.latestPriceFullFile(storeCode).catch((err) => {
    fail(`${label}: listing failed: ${message(err)}`);
    return undefined;
  });
  if (file === undefined) return "failed";
  if (file === null) {
    console.log(`${label}: no price file published`);
    return "skipped";
  }
  const info = parseFileName(file.name);
  if (!info) {
    fail(`${label}: unexpected file name ${file.name}`);
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
    const parsed = parsePriceFull(await downloadText(chain, file));
    // The file must be the chain's. The store number inside it may differ from
    // the one in the file name: Carrefour renumbered branches (e.g. the file
    // for 408 says StoreId 119). The name matches the branch list, so it wins.
    if (parsed.chainCode !== chain.code) {
      throw new Error(`file is for chain ${parsed.chainCode}`);
    }
    if (parsed.storeCode !== storeCode) {
      console.log(`${label}: file name says ${storeCode}, contents say ${parsed.storeCode}; using the name`);
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
    fail(`${label}: failed: ${message(err)}`);
    return "failed";
  }
}

/**
 * Load a branch's newest PromoFull file, unless it was already loaded. Its
 * promotions replace the branch's previous ones in one transaction.
 */
async function ingestPromotions(
  pool: pg.Pool,
  chain: ChainSource,
  chainId: number,
  storeCode: string,
  storeId: number,
): Promise<void> {
  const file = await chain.latestPromoFullFile(storeCode);
  if (!file) return;
  const info = parseFileName(file.name);
  if (!info) throw new Error(`unexpected file name ${file.name}`);
  const { rows: seen } = await pool.query(
    "SELECT 1 FROM promo_runs WHERE file_name = $1 OR (store_id = $2 AND file_time >= $3) LIMIT 1",
    [file.name, storeId, info.time],
  );
  if (seen.length > 0) return;

  const parsed = parsePromoFull(await downloadText(chain, file), info.time);
  if (parsed.chainCode !== chain.code) throw new Error(`file is for chain ${parsed.chainCode}`);
  const skipped = Object.values(parsed.skipped).reduce((a, b) => a + b, 0);
  const stored = await inTransaction(pool, async (client) => {
    const n = await replacePromotions(client, chainId, storeId, parsed.rows, info.time);
    await client.query(
      `INSERT INTO promo_runs (store_id, file_name, file_time, promotions, skipped) VALUES ($1, $2, $3, $4, $5)`,
      [storeId, file.name, info.time, n, skipped],
    );
    return n;
  });
  // Reasons in the log show at a glance when a chain's file differs ({"coupon": 12, "club": 3}).
  console.log(
    `${chain.name} #${storeCode}: ${stored} promotion rows, ${skipped} promotions left out ${JSON.stringify(parsed.skipped)}`,
  );
}

/**
 * The free Neon plan stops writes at 0.5 GB. Prices are stored only when they
 * change, so growth is slow, but a warning well before the limit leaves time
 * to act. The ::warning:: prefix shows it on the GitHub Actions run page.
 */
const DB_SIZE_WARN_BYTES = 400 * 1024 * 1024;

async function reportDatabaseSize(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ bytes: string }>(
    "SELECT pg_database_size(current_database()) AS bytes",
  );
  const bytes = Number(rows[0]!.bytes);
  const mb = (bytes / 1024 / 1024).toFixed(1);
  if (bytes > DB_SIZE_WARN_BYTES) console.warn(`::warning::database size ${mb} MB is close to the free plan limit`);
  else console.log(`database size: ${mb} MB`);
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Write the run's failures as Markdown for the workflow's failure issue, so
 * the cause can be read in the email without opening the run log.
 */
export function failureReport(failures: string[], retried: boolean): string {
  if (failures.length === 0) return "No failures.\n";
  const note = retried ? " (still failing after a second attempt)" : "";
  return `Failed${note}:\n\n${failures.map((f) => `- ${f}`).join("\n")}\n`;
}

// A chain that publishes late or a dropped download is usually fine a few
// minutes later. Runs set INGEST_RETRY_MINUTES so a failed run waits and
// tries again before reporting; files already loaded are skipped.
const RETRY_MINUTES = Number(process.env.INGEST_RETRY_MINUTES ?? 0);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try {
    await migrate(pool);
    let { totals, failures } = await ingest(pool);
    const retried = failures.length > 0 && RETRY_MINUTES > 0;
    if (retried) {
      console.log(`first pass`, totals, `; trying the failures again in ${RETRY_MINUTES} minutes`);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MINUTES * 60_000));
      ({ totals, failures } = await ingest(pool));
    }
    if (process.env.INGEST_REPORT) await writeFile(process.env.INGEST_REPORT, failureReport(failures, retried));
    const { classified, changed } = await classifyProducts(pool);
    console.log(`categories: ${classified} products classified, ${changed} changed`);
    // Coordinates for new or moved branches. A geocoding problem is logged
    // but does not fail the run: prices are still correct without it.
    const geo = await geocodeStores(pool).catch((err) => ({ updated: 0, failed: [message(err)] }));
    if (geo.updated > 0) console.log(`geocoded ${geo.updated} branches`);
    for (const f of geo.failed) console.warn(`geocoding: ${f}`);
    await reportDatabaseSize(pool);
    console.log("done", totals);
    if (totals.failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
