import { parseFileName } from "../filename.js";
import { fetchBytes, fetchWithRetry } from "../http.js";
import type { RemoteFile } from "../types.js";
import { newest, type ChainSource } from "./types.js";

/**
 * Carrefour (including its Mega and Yeinot Bitan branches) publishes on its
 * own public page. The whole file list is embedded in that page as a JSON
 * array (`const files = [...]`); paging and filters are only client-side.
 * A file is downloaded from /<YYYYMMDD>/<name>, the date taken from the name.
 *
 * The site only answers Israeli IP addresses.
 */
const BASE = "https://prices.carrefour.co.il";

export const carrefour: ChainSource = (() => {
  let listing: Promise<RemoteFile[]> | null = null;
  const files = () => (listing ??= listFiles());

  return {
    code: "7290055700007",
    name: "קרפור",

    async latestStoresFile() {
      const file = newest((await files()).filter((f) => f.name.startsWith("Stores")));
      if (!file) throw new Error("Carrefour: no Stores file listed");
      return file;
    },

    async latestPriceFullFile(storeCode) {
      return newest(
        (await files()).filter(
          (f) => f.name.startsWith("PriceFull") && parseFileName(f.name)?.storeCode === storeCode,
        ),
      );
    },

    download(file) {
      return fetchBytes(file.url);
    },
  };
})();

async function listFiles(): Promise<RemoteFile[]> {
  const res = await fetchWithRetry(`${BASE}/`);
  if (!res.ok) throw new Error(`Carrefour listing: HTTP ${res.status}`);
  return parseCarrefourListing(await res.text());
}

/** Exported for tests: the file list embedded in the page. */
export function parseCarrefourListing(html: string): RemoteFile[] {
  const m = /const files\s*=\s*(\[[\s\S]*?\]);/.exec(html);
  if (!m) throw new Error("Carrefour listing: no file list in the page");
  const entries = JSON.parse(m[1]!) as Array<{ name?: string }>;
  return entries.flatMap((e) => {
    const date = e.name ? /-(\d{8})-\d+\.\w+$/.exec(e.name)?.[1] : undefined;
    return e.name && date ? [{ name: e.name, url: `${BASE}/${date}/${encodeURIComponent(e.name)}` }] : [];
  });
}
