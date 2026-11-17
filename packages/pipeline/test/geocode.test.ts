import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { upsertChain, upsertStores } from "../src/db/load.js";
import { migrate } from "../src/db/migrate.js";
import { cleanAddress, geocodeQuery, geocodeStores, type Geocoder } from "../src/geocode.js";

describe("geocodeQuery", () => {
  const store = { chain_code: "7290027600007", store_code: "1", name: "x", city_code: "5000" };

  it("joins the street with the city name", () => {
    expect(geocodeQuery({ ...store, address: "בן יהודה 79" })).toBe("בן יהודה 79, תל אביב-יפו");
  });

  it("uses the override for branches with no usable address", () => {
    expect(geocodeQuery({ ...store, chain_code: "7290803800003", store_code: "32", address: "unknown" })).toBe(
      "בן צבי, תל אביב-יפו",
    );
  });

  it("gives up when there is nothing to look up", () => {
    expect(geocodeQuery({ ...store, address: "unknown" })).toBeNull();
  });

  it("cleans comma-separated numbers and placeholders", () => {
    expect(cleanAddress("האומן,15")).toBe("האומן 15");
    expect(cleanAddress(" לא ידוע ")).toBeNull();
  });

  it("cleans Carrefour's address styles", () => {
    expect(cleanAddress("שד.הארזים 2")).toBe("שדרות הארזים 2");
    expect(cleanAddress("ככר דיזנגוף 9")).toBe("כיכר דיזנגוף 9");
    expect(cleanAddress("4-6 גרפית")).toBe("גרפית 4");
    expect(cleanAddress("קניון גינדי - רחוב קרליבך")).toBe("קרליבך");
    expect(cleanAddress("לה גרדיה 78")).toBe("לה גווארדיה 78");
    expect(cleanAddress("עמק הברכה")).toBe("עמק ברכה");
  });

  it("looks up streets listed under Tel Aviv in their real city", () => {
    expect(geocodeQuery({ ...store, address: "שד.האורנים 16" })).toBe("שדרות האורנים 16, רמת גן");
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("geocodeStores", () => {
  let pool: pg.Pool;

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url });
    await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public");
    await migrate(pool, () => {});
    const chainId = await upsertChain(pool, "7290027600007", "שופרסל");
    await upsertStores(pool, chainId, [
      { storeCode: "1", name: "בן יהודה", address: "בן יהודה 79", cityCode: "5000" },
      { storeCode: "2", name: "בלי כתובת", address: null, cityCode: "5000" },
    ]);
  });

  afterAll(() => pool.end());

  it("looks each address up once, and again only when it changes", async () => {
    const queries: string[] = [];
    const fake: Geocoder = async (q) => {
      queries.push(q);
      return { lat: 32.08, lon: 34.77, precision: "address" };
    };

    const first = await geocodeStores(pool, fake, 0);
    expect(first.updated).toBe(1);
    expect(first.failed).toEqual(["בלי כתובת: no usable address"]);

    await geocodeStores(pool, fake, 0);
    expect(queries).toHaveLength(1); // nothing changed, no new request

    await pool.query("UPDATE stores SET address = 'בן יהודה 80' WHERE store_code = '1'");
    await geocodeStores(pool, fake, 0);
    expect(queries).toEqual(["בן יהודה 79, תל אביב-יפו", "בן יהודה 80, תל אביב-יפו"]);
  });
});

describe("cleanAddress on real chain addresses", () => {
  it.each([
    ["רח' מקס ברוד 34", "מקס ברוד 34"],
    ["החשמונאים 84 פינת קרליבך", "החשמונאים 84"],
    ["הרצל 91 עובר להרצל 114)", "הרצל 91"],
    ["דרך נמיר 301 תל אביב&#x0D;", "דרך נמיר 301"],
    ["הרוגי המלכות 9 שיכון דן", "הרוגי מלכות 9"],
    ["קינג גורג 24", "המלך ג'ורג' 24"],
    ["שד יהודית 16", "שדרות יהודית 16"],
    ["יהודה מכבי 81", "יהודה המכבי 81"],
    ["בן יהודה 79", "בן יהודה 79"],
    ["אבן גבירול157", "אבן גבירול 157"],
    ["שד` רוטשילד 14", "שדרות רוטשילד 14"],
    ["1 אחי מאיר", "אבא אחימאיר 1"],
  ])("%s -> %s", (raw, clean) => {
    expect(cleanAddress(raw)).toBe(clean);
  });
});

describe("streetOnly", async () => {
  const { streetOnly } = await import("../src/geocode.js");
  it("drops the house number", () => {
    expect(streetOnly("דרויאנוב 5")).toBe("דרויאנוב");
    expect(streetOnly("דרך בן צבי")).toBeNull();
  });
});
