import type { StoreRecord } from "./types.js";

/**
 * Which branches belong to the area we serve.
 *
 * Chains fill the City field differently: Shufersal, Rami Levy, AM:PM and
 * Carrefour use the CBS locality code (5000 = Tel Aviv-Yafo), Victory writes
 * the city name, and Yochananof leaves it as 0. So a branch matches if its
 * city is a known code or name, or if the chain lists it explicitly.
 */
export interface Area {
  cityCodes: string[];
  cityNames: string[];
}

export const TEL_AVIV: Area = {
  cityCodes: ["5000"],
  cityNames: ["תל אביב", "תל אביב יפו", "תל אביב-יפו", "תל-אביב", "תל-אביב-יפו", 'ת"א', "יפו"],
};

export function areaFromEnv(env = process.env): Area {
  return env.CITY_CODES ? { ...TEL_AVIV, cityCodes: env.CITY_CODES.split(",") } : TEL_AVIV;
}

export function isInArea(store: StoreRecord, area: Area, extraStoreCodes: string[] = []): boolean {
  if (extraStoreCodes.includes(store.storeCode)) return true;
  const city = normalize(store.cityCode ?? "");
  if (city === "") return false;
  return area.cityCodes.includes(city) || area.cityNames.some((name) => normalize(name) === city);
}

/** Collapse spacing and quote variants: "תל  אביב", "ת״א" and 'ת"א' compare equal. */
function normalize(s: string): string {
  return s.replace(/[״”]/g, '"').replace(/\s+/g, " ").trim();
}
