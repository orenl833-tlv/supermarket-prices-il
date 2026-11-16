import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isInArea, TEL_AVIV } from "../src/area.js";
import { parseCarrefourListing } from "../src/chains/carrefour.js";
import { parseLaibCatalogListing, victory } from "../src/chains/laibcatalog.js";
import { newest } from "../src/chains/types.js";
import { parseFileName } from "../src/filename.js";
import { parsePriceFull, parseStores } from "../src/parse.js";

// Fixtures are trimmed copies of real files, fetched from an Israeli IP on 2026-11-16.
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("Carrefour", () => {
  const files = parseCarrefourListing(fixture("carrefour-listing.html"));

  it("reads the file list embedded in the page, with dated download paths", () => {
    expect(files.map((f) => f.name)).toContain("Stores7290055700007-000-20261116-000100.xml");
    const pf = files.find((f) => f.name.startsWith("PriceFull7290055700007-001-085-"))!;
    expect(pf.url).toBe(
      "https://prices.carrefour.co.il/20261116/PriceFull7290055700007-001-085-20261116-051005.gz",
    );
  });

  it("finds a branch's full price file among other branches and partial updates", () => {
    const forBranch = files.filter(
      (f) => f.name.startsWith("PriceFull") && parseFileName(f.name)?.storeCode === "85",
    );
    expect(newest(forBranch)?.name).toBe("PriceFull7290055700007-001-085-20261116-051005.gz");
  });

  it("fails loudly when the page no longer has the list", () => {
    expect(() => parseCarrefourListing("<html></html>")).toThrow(/no file list/);
  });

  it("parses its PriceFull format", () => {
    const file = parsePriceFull(fixture("carrefour-pricefull.xml"));
    expect(file).toMatchObject({ chainCode: "7290055700007", storeCode: "85", skipped: 0 });
    expect(file.items).toHaveLength(2);
    expect(file.items.every((i) => i.price > 0 && i.isBarcode)).toBe(true);
  });
});

describe("Victory (laibcatalog)", () => {
  it("reads the JSON file list and keeps entries with a file name", () => {
    // Shape of /webapi/api/getfiles?edi=7290696200003, as observed from Israel.
    const entries = parseLaibCatalogListing(
      JSON.stringify([
        { branchNumber: 16, fileName: "PriceFull7290696200003-001-016-20261116-050143.gz", fileType: "pricefull", fileDate: "2026-11-16 05:01:43", fileSize: "324.61 KB" },
        { branchNumber: 0, fileName: "Stores7290696200003-000-20261116060100-060100.gz", fileType: "stores", fileDate: "2026-11-16 06:01:00", fileSize: "2.42 KB" },
        { branchNumber: 16, fileName: "", fileType: "price" },
      ]),
    );
    expect(entries.map((e) => e.fileType)).toEqual(["pricefull", "stores"]);
  });

  it("parses the Stores file name, which repeats the time", () => {
    const info = parseFileName("Stores7290696200003-000-20261116060100-060100.gz");
    expect(info).toMatchObject({ kind: "Stores", chainCode: "7290696200003", storeCode: null });
    expect(info?.time.toISOString()).toBe("2026-11-16T04:01:00.000Z"); // 06:01 Israel time
  });

  it("matches Tel Aviv branches by city name, and the misspelled one by code", () => {
    const stores = parseStores(fixture("victory-stores.xml"));
    const inTelAviv = stores.filter((s) => isInArea(s, TEL_AVIV, victory.extraStoreCodes));
    expect(stores).toHaveLength(3);
    expect(inTelAviv.map((s) => s.storeCode).sort()).toEqual(["16", "9"]);
  });

  it("parses its PriceFull format", () => {
    const file = parsePriceFull(fixture("victory-pricefull.xml"));
    expect(file).toMatchObject({ chainCode: "7290696200003", storeCode: "16", skipped: 0 });
    expect(file.items).toHaveLength(2);
  });
});
