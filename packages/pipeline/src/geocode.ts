import { fileURLToPath } from "node:url";
import type pg from "pg";
import { fetchWithRetry } from "./http.js";
import { createPool } from "./db/pool.js";

/**
 * Give every branch coordinates, using OpenStreetMap's Nominatim.
 *
 * Runs after the branch list is refreshed and only looks up branches that are
 * new or whose address changed, so a normal day makes no requests at all.
 * Nominatim's usage policy allows at most one request per second.
 */
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "supermarket-prices-il/0.1 (portfolio project)";
const REQUEST_GAP_MS = 1100;

/** Rough box around Tel Aviv-Yafo: a result outside it is a wrong match. */
const BOUNDS = { minLat: 32.02, maxLat: 32.15, minLon: 34.73, maxLon: 34.86 };

const CITY_NAMES: Record<string, string> = { "5000": "תל אביב-יפו" };
const DEFAULT_CITY = "תל אביב-יפו";

/**
 * Branches whose published address is missing or unusable, keyed by
 * "<chain code>:<store code>". A street without a number gives street-level
 * precision, which is recorded as such.
 */
const OVERRIDES: Record<string, string> = {
  "7290803800003:32": "בן צבי", // Yochananof Ben Tsvi (street-level only)
  "7290803800003:35": "נחלת יצחק", // Yochananof Nahalat Yitshak
  "7290803800003:54": "אחד העם", // Yochananof Ahad Ha'am, Tel Aviv
  "7290027600007:695": "הברזל 20", // Shufersal BE inside Assuta Ramat HaHayal
};

interface StoreRow {
  id: number;
  chain_code: string;
  store_code: string;
  name: string;
  address: string | null;
  city_code: string | null;
  geocode_query: string | null;
}

export interface GeocodeResult {
  lat: number;
  lon: number;
  precision: "address" | "street";
}

export type Geocoder = (query: string) => Promise<GeocodeResult | null>;

/** Build the search text for a branch, or null if there is nothing usable. */
export function geocodeQuery(store: Omit<StoreRow, "id" | "geocode_query">): string | null {
  const city = CITY_NAMES[store.city_code ?? ""] ?? DEFAULT_CITY;
  const override = OVERRIDES[`${store.chain_code}:${store.store_code}`];
  const street = override ?? cleanAddress(store.address);
  return street ? `${street}, ${city}` : null;
}

/**
 * Street spellings that OpenStreetMap writes differently from the chains.
 * Keys are matched as whole words at the start of the cleaned address.
 */
const STREET_ALIASES: Record<string, string> = {
  "קינג גורג": "המלך ג'ורג'",
  "קינג ג'ורג'": "המלך ג'ורג'",
  "יהודה מכבי": "יהודה המכבי",
  "שד יהודית": "שדרות יהודית",
  "שד' יהודית": "שדרות יהודית",
  "וינשל": "ויינשל",
  "אחי מאיר": "אבא אחימאיר",
  "הרוגי המלכות": "הרוגי מלכות",
  "חשמונאים": "החשמונאים",
  "ארלוזרוב": "ארלוזורוב",
  "שדרות מנחם בגין": "מנחם בגין",
  "דרך מנחם בגין": "מנחם בגין",
  "אלנקווה": "הרב אלנקוה",
};

/**
 * Turn a chain's free-text address into something a geocoder understands:
 *   "האומן,15"                     -> "האומן 15"
 *   "רח' מקס ברוד 34"              -> "מקס ברוד 34"
 *   "1 אחי מאיר"                   -> "אחי מאיר 1"
 *   "החשמונאים 84 פינת קרליבך"     -> "החשמונאים 84"
 *   "הרצל 91 עובר להרצל 114)"      -> "הרצל 91"
 *   "דרך נמיר 301 תל אביב&#x0D;"   -> "דרך נמיר 301"
 *   "אבן גבירול157"                -> "אבן גבירול 157"
 * Placeholders like "unknown" give null.
 */
export function cleanAddress(address: string | null): string | null {
  if (!address) return null;
  let a = address
    .replace(/&#x?[0-9a-f]+;/gi, " ") // stray XML character references
    .replace(/[,()]/g, " ")
    .replace(/([א-ת])(\d)/g, "$1 $2") // "אבן גבירול157" -> "אבן גבירול 157"
    .replace(/\s+/g, " ")
    .trim();
  if (a === "" || /^(unknown|לא ידוע|0)$/i.test(a)) return null;

  a = a.replace(/^(רח'|רחוב)\s+/, "");
  // Keep "street number" and drop what follows: corners, notes, neighbourhoods, the city.
  const m = /^(\d+)\s+(\D+)$/.exec(a); // number first: "1 אחי מאיר"
  if (m) a = `${m[2]} ${m[1]}`;
  const withNumber = /^(\D+?\s\d+[א-ת]?)(\s|$)/.exec(a);
  if (withNumber) a = withNumber[1]!;
  a = a.replace(/\s+(תל אביב|תל-אביב|ת"א).*$/, "").trim();

  for (const [from, to] of Object.entries(STREET_ALIASES)) {
    if (a === from || a.startsWith(`${from} `)) a = to + a.slice(from.length);
  }
  return a || null;
}

/** "דרויאנוב 5" -> "דרויאנוב": a street-level fallback when the house is not found. */
export function streetOnly(street: string): string | null {
  const s = street.replace(/\s\d+[א-ת]?$/, "").trim();
  return s && s !== street ? s : null;
}

/**
 * Nominatim structured search ("street" + "city" fields), not free text:
 * free text also matches place names, so "חשמונאים 100" found a school named
 * Hashmonaim on another street. The trade-off is strict spelling, handled by
 * STREET_ALIASES and the street-only fallback.
 */
export const nominatim: Geocoder = async (query) => {
  const [street = "", city = DEFAULT_CITY] = query.split(", ");
  // Structured search expects the house number first: "100 החשמונאים".
  const m = /^(.*\D)\s(\d+[א-ת]?)$/.exec(street);
  const url = `${NOMINATIM}?${new URLSearchParams({
    street: m ? `${m[2]} ${m[1]}` : street,
    city,
    format: "jsonv2",
    addressdetails: "1",
    limit: "1",
    countrycodes: "il",
  })}`;
  const res = await fetchWithRetry(url, { headers: { "user-agent": USER_AGENT } });
  if (!res.ok) throw new Error(`Nominatim: HTTP ${res.status}`);
  const [hit] = (await res.json()) as Array<{
    lat: string;
    lon: string;
    address?: { house_number?: string };
  }>;
  if (!hit) return null;
  const lat = Number(hit.lat);
  const lon = Number(hit.lon);
  const inBounds =
    lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lon >= BOUNDS.minLon && lon <= BOUNDS.maxLon;
  if (!inBounds) return null;
  return { lat, lon, precision: hit.address?.house_number ? "address" : "street" };
};

export async function geocodeStores(
  pool: pg.Pool,
  geocoder: Geocoder = nominatim,
  gapMs = REQUEST_GAP_MS,
): Promise<{ updated: number; failed: string[] }> {
  const { rows } = await pool.query<StoreRow>(
    `SELECT s.id, c.code AS chain_code, s.store_code, s.name, s.address, s.city_code, s.geocode_query
     FROM stores s JOIN chains c ON c.id = s.chain_id
     WHERE s.geocode_precision IS DISTINCT FROM 'manual'`,
  );

  let updated = 0;
  const failed: string[] = [];
  for (const store of rows) {
    const query = geocodeQuery(store);
    if (query === null) {
      failed.push(`${store.name}: no usable address`);
      continue;
    }
    if (query === store.geocode_query) continue; // already done for this address

    let hit = await geocoder(query);
    if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
    const [street, city] = query.split(", ");
    const fallback = street ? streetOnly(street) : null;
    if (!hit && fallback) {
      const streetHit = await geocoder(`${fallback}, ${city}`);
      if (gapMs > 0) await new Promise((r) => setTimeout(r, gapMs));
      hit = streetHit && { ...streetHit, precision: "street" };
    }
    if (!hit) {
      failed.push(`${store.name}: no match for "${query}"`);
      continue;
    }
    await pool.query(
      `UPDATE stores SET lat = $2, lon = $3, geocode_query = $4,
         geocode_precision = $5, geocoded_at = now()
       WHERE id = $1`,
      [store.id, hit.lat, hit.lon, query, hit.precision],
    );
    updated++;
  }
  return { updated, failed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool();
  try {
    const { updated, failed } = await geocodeStores(pool);
    console.log(`geocoded ${updated} branches`);
    for (const f of failed) console.warn(`  ${f}`);
  } finally {
    await pool.end();
  }
}
