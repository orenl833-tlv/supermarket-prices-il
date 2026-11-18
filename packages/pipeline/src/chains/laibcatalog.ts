import { fetchBytes, fetchWithRetry } from "../http.js";
import type { RemoteFile } from "../types.js";
import { newest, type ChainSource } from "./types.js";

/**
 * laibcatalog.co.il serves several chains (Victory, Mahsanei HaShuk and
 * others), each by its chain code ("edi"). A JSON API lists the files:
 *   GET /webapi/api/getfiles?edi=<code>
 *   -> [{ branchNumber, fileName, fileType: "pricefull" | "stores" | ..., fileDate, fileSize }]
 * and a file is downloaded from /webapi/<code>/<fileName>.
 *
 * The site only answers Israeli IP addresses.
 */
const BASE = "https://laibcatalog.co.il/webapi";

interface Entry {
  branchNumber?: number;
  fileName?: string;
  fileType?: string;
}

export function laibCatalogChain(opts: {
  code: string;
  name: string;
  extraStoreCodes?: string[];
}): ChainSource {
  let listing: Promise<Entry[]> | null = null;
  const entries = () => (listing ??= listEntries(opts.code));
  const toFile = (e: Entry): RemoteFile => ({
    name: e.fileName!,
    url: `${BASE}/${opts.code}/${encodeURIComponent(e.fileName!)}`,
  });

  return {
    code: opts.code,
    name: opts.name,
    extraStoreCodes: opts.extraStoreCodes,

    async latestStoresFile() {
      const file = newest((await entries()).filter((e) => e.fileType === "stores").map(toFile));
      if (!file) throw new Error(`${opts.name}: no Stores file listed`);
      return file;
    },

    async latestPriceFullFile(storeCode) {
      return newest(
        (await entries())
          .filter((e) => e.fileType === "pricefull" && String(e.branchNumber) === storeCode)
          .map(toFile),
      );
    },

    async latestPromoFullFile(storeCode) {
      return newest(
        (await entries())
          .filter((e) => e.fileName!.startsWith("PromoFull") && String(e.branchNumber) === storeCode)
          .map(toFile),
      );
    },

    download(file) {
      return fetchBytes(file.url);
    },
  };
}

async function listEntries(code: string): Promise<Entry[]> {
  const res = await fetchWithRetry(`${BASE}/api/getfiles?edi=${code}`);
  if (!res.ok) throw new Error(`laibcatalog listing: HTTP ${res.status}`);
  return parseLaibCatalogListing(await res.text());
}

/** Exported for tests. Entries without a file name are dropped. */
export function parseLaibCatalogListing(json: string): Entry[] {
  const data = JSON.parse(json) as unknown;
  if (!Array.isArray(data)) throw new Error("laibcatalog listing: expected an array");
  return (data as Entry[]).filter((e) => typeof e.fileName === "string" && e.fileName.length > 0);
}

export const victory = laibCatalogChain({
  code: "7290696200003",
  name: "ויקטורי",
  // Branch 009 (HaArba'a 6, Tel Aviv) has its city misspelled as "תל אבית יפה".
  extraStoreCodes: ["9"],
});
