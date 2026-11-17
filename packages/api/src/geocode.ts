/**
 * Address search for "where do you start from", limited to Tel Aviv.
 *
 * The browser asks our API, not Nominatim directly, so we can respect
 * Nominatim's usage policy in one place: an identifying User-Agent, at most
 * one request per second, and a cache so repeated searches cost nothing.
 */
export interface Place {
  lat: number;
  lon: number;
  label: string;
}

export type AddressLookup = (query: string) => Promise<Place | null>;

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "supermarket-prices-il/0.1 (portfolio project)";
// Tel Aviv-Yafo, west,north,east,south. Results outside it are not returned.
const TEL_AVIV_VIEWBOX = "34.74,32.15,34.86,32.02";
const MIN_GAP_MS = 1100;
const CACHE_SIZE = 500;

export function nominatimLookup(fetchFn: typeof fetch = fetch): AddressLookup {
  const cache = new Map<string, Place | null>();
  let queue: Promise<unknown> = Promise.resolve();

  return async (query) => {
    const key = query.trim().replace(/\s+/g, " ");
    if (cache.has(key)) return cache.get(key)!;

    // Requests wait for each other, with a gap, so we never exceed one per second.
    const result = queue.then(async () => {
      const url = `${NOMINATIM}?${new URLSearchParams({
        q: key,
        format: "jsonv2",
        limit: "1",
        countrycodes: "il",
        viewbox: TEL_AVIV_VIEWBOX,
        bounded: "1",
        "accept-language": "he",
      })}`;
      try {
        const res = await fetchFn(url, {
          headers: { "user-agent": USER_AGENT, referer: "https://supermarket-prices-il.onrender.com/" },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
        const [hit] = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
        return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: shortLabel(hit.display_name) } : null;
      } finally {
        await new Promise((r) => setTimeout(r, MIN_GAP_MS));
      }
    });
    queue = result.catch(() => {});

    const place = await result;
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
    cache.set(key, place);
    return place;
  };
}

/** "דיזנגוף 50, לב העיר, תל אביב-יפו, ..., ישראל" -> "דיזנגוף 50, לב העיר" */
export function shortLabel(displayName: string): string {
  return displayName.split(", ").slice(0, 2).join(", ");
}
