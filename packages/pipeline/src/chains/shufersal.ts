import { fetchBytes, fetchWithRetry } from "../http.js";
import type { RemoteFile } from "../types.js";
import { newest, type ChainSource } from "./types.js";

/**
 * Shufersal publishes its files on a public page, no login needed.
 * The listing returns signed Azure blob links that expire after about an
 * hour, so a file must be downloaded soon after it is listed.
 */
const BASE = "https://prices.shufersal.co.il/FileObject/UpdateCategory";
const CATEGORY = { priceFull: 2, stores: 5 } as const;

export const shufersal: ChainSource = {
  code: "7290027600007",
  name: "שופרסל",

  async latestStoresFile() {
    const file = newest(await listFiles(CATEGORY.stores, "0"));
    if (!file) throw new Error("Shufersal: no Stores file listed");
    return file;
  },

  async latestPriceFullFile(storeCode) {
    const files = await listFiles(CATEGORY.priceFull, storeCode);
    return newest(files.filter((f) => f.name.startsWith("PriceFull")));
  },

  download(file) {
    return fetchBytes(file.url);
  },
};

async function listFiles(category: number, storeId: string): Promise<RemoteFile[]> {
  const res = await fetchWithRetry(`${BASE}?catID=${category}&storeId=${storeId}&page=1`);
  if (!res.ok) throw new Error(`Shufersal listing: HTTP ${res.status}`);
  return parseListing(await res.text());
}

/** Exported for tests: extract file links from the listing HTML. */
export function parseListing(html: string): RemoteFile[] {
  const files: RemoteFile[] = [];
  for (const m of html.matchAll(/href="(https:\/\/pricesprodpublic[^"]+)"/g)) {
    const url = m[1]!.replaceAll("&amp;", "&");
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    if (name) files.push({ name, url });
  }
  return files;
}
