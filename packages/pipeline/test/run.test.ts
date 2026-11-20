import { gzipSync } from "node:zlib";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ChainSource } from "../src/chains/types.js";
import { upsertChain, upsertStores } from "../src/db/load.js";
import { migrate } from "../src/db/migrate.js";
import { downloadText, failureReport, ingest } from "../src/run.js";
import type { RemoteFile } from "../src/types.js";

const FILE: RemoteFile = { name: "Stores7290000000001-202611200500.xml", url: "x" };

/** A chain whose portal answers with the given functions; nothing else works. */
function fakeChain(overrides: Partial<ChainSource>): ChainSource {
  const unused = () => Promise.reject(new Error("not used in this test"));
  return {
    code: "7290000000001",
    name: "רשת בדיקה",
    latestStoresFile: unused,
    latestPriceFullFile: () => Promise.resolve(null),
    latestPromoFullFile: () => Promise.resolve(null),
    download: unused,
    ...overrides,
  };
}

describe("downloadText", () => {
  it("downloads again when the first copy is cut short", async () => {
    const whole = gzipSync(Buffer.from("<Root>שלום</Root>"));
    const copies = [whole.subarray(0, whole.length - 10), whole];
    const chain = fakeChain({ download: () => Promise.resolve(copies.shift()!) });
    expect(await downloadText(chain, FILE)).toBe("<Root>שלום</Root>");
    expect(copies).toHaveLength(0);
  });

  it("gives up after the second attempt", async () => {
    const cut = gzipSync(Buffer.from("<Root/>")).subarray(0, 8);
    const chain = fakeChain({ download: () => Promise.resolve(cut) });
    await expect(downloadText(chain, FILE)).rejects.toThrow();
  });
});

describe("failureReport", () => {
  it("lists each failure for the issue body", () => {
    expect(failureReport(["ויקטורי: no Stores file listed"], true)).toBe(
      "Failed (still failing after a second attempt):\n\n- ויקטורי: no Stores file listed\n",
    );
    expect(failureReport([], false)).toBe("No failures.\n");
  });
});

/** Integration tests against a real Postgres; see load.test.ts. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("ingest without a Stores file", () => {
  let pool: pg.Pool;
  const missing = () => Promise.reject(new Error("no Stores file listed"));

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrate(pool, () => {});
  });

  afterAll(() => pool.end());

  beforeEach(() => pool.query("TRUNCATE stores, chains RESTART IDENTITY CASCADE"));

  it("still updates the branches saved on earlier runs", async () => {
    const chainId = await upsertChain(pool, "7290000000001", "רשת בדיקה");
    await upsertStores(pool, chainId, [{ storeCode: "7", name: "דיזנגוף", address: null, cityCode: "5000" }]);
    const asked: string[] = [];
    const chain = fakeChain({
      latestStoresFile: missing,
      latestPriceFullFile: (code) => {
        asked.push(code);
        return Promise.resolve(null);
      },
    });

    const { totals, failures } = await ingest(pool, [chain]);
    expect(asked).toEqual(["7"]);
    expect(failures).toEqual([]);
    expect(totals.skipped).toBe(1);
  });

  it("fails the chain when no branches were ever saved", async () => {
    const { totals, failures } = await ingest(pool, [fakeChain({ latestStoresFile: missing })]);
    expect(totals.failed).toBe(1);
    expect(failures).toEqual(["רשת בדיקה: no Stores file listed"]);
  });
});
