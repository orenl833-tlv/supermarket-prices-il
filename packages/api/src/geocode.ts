/**
 * Address search and reverse lookup for "where do you start from".
 *
 * The browser asks our API, not Nominatim directly, so we respect Nominatim's
 * usage policy in one place: an identifying User-Agent and Referer, at most one
 * request per second (a shared queue), and caches so repeats cost nothing.
 */
export interface Place {
  lat: number;
  lon: number;
  label: string;
}

/** A typed address -> a place in Tel Aviv, or null. */
export type AddressLookup = (query: string) => Promise<Place | null>;
/** Coordinates -> the nearest street address, or null. */
export type ReverseLookup = (lat: number, lon: number) => Promise<string | null>;

const NOMINATIM = "https://nominatim.openstreetmap.org";
const HEADERS = {
  "user-agent": "supermarket-prices-il/0.1 (portfolio project)",
  referer: "https://supermarket-prices-il.onrender.com/",
};
// Tel Aviv-Yafo, west,north,east,south. Searches return nothing outside it.
const TEL_AVIV_VIEWBOX = "34.74,32.15,34.86,32.02";
const MIN_GAP_MS = 1100;
const CACHE_SIZE = 500;

export function nominatim(fetchFn: typeof fetch = fetch): { search: AddressLookup; reverse: ReverseLookup } {
  let queue: Promise<unknown> = Promise.resolve();

  /** One request at a time, with a gap after each, so we never exceed one per second. */
  function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const result = queue.then(async () => {
      const url = `${NOMINATIM}/${path}?${new URLSearchParams({ format: "jsonv2", "accept-language": "he", ...params })}`;
      try {
        const res = await fetchFn(url, { headers: HEADERS, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
        return (await res.json()) as T;
      } finally {
        await new Promise((r) => setTimeout(r, MIN_GAP_MS));
      }
    });
    queue = result.catch(() => {});
    return result;
  }

  const searchCache = new Map<string, Place | null>();
  const search: AddressLookup = (query) => {
    const key = query.trim().replace(/\s+/g, " ");
    return cached(searchCache, key, async () => {
      const [hit] = await get<Array<{ lat: string; lon: string; display_name: string }>>("search", {
        q: key,
        limit: "1",
        countrycodes: "il",
        viewbox: TEL_AVIV_VIEWBOX,
        bounded: "1",
      });
      return hit ? { lat: Number(hit.lat), lon: Number(hit.lon), label: shortLabel(hit.display_name) } : null;
    });
  };

  const reverseCache = new Map<string, string | null>();
  const reverse: ReverseLookup = (lat, lon) =>
    // Rounded to about 10 m: a phone's position wobbles, the answer does not.
    cached(reverseCache, `${lat.toFixed(4)},${lon.toFixed(4)}`, async () => {
      const hit = await get<{ address?: NominatimAddress; error?: string }>("reverse", {
        lat: String(lat),
        lon: String(lon),
        zoom: "18",
      });
      return hit.address ? streetAddress(hit.address) : null;
    });

  return { search, reverse };
}

async function cached<T>(cache: Map<string, T>, key: string, load: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key)!;
  const value = await load();
  if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

interface NominatimAddress {
  road?: string;
  house_number?: string;
  suburb?: string;
  neighbourhood?: string;
  city?: string;
  town?: string;
}

/** { road: "דיזנגוף", house_number: "50", suburb: "לב העיר" } -> "דיזנגוף 50, לב העיר" */
export function streetAddress(a: NominatimAddress): string | null {
  const street = [a.road, a.house_number].filter(Boolean).join(" ");
  const area = a.neighbourhood ?? a.suburb ?? a.city ?? a.town;
  const parts = [street, area].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

/** "דיזנגוף 50, לב העיר, תל אביב-יפו, ..., ישראל" -> "דיזנגוף 50, לב העיר" */
export function shortLabel(displayName: string): string {
  return displayName.split(", ").slice(0, 2).join(", ");
}
