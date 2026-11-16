import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { parseListing } from "../src/chains/shufersal.js";
import { decodeFile } from "../src/encoding.js";
import { parseFileName } from "../src/filename.js";
import { parsePriceFull, parseStores } from "../src/parse.js";
import { normalizeQuantity } from "../src/units.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("decodeFile", () => {
  const text = "<Root>שלום</Root>";

  it("reads UTF-16 LE with a BOM (Rami Levy Stores files)", () => {
    const bytes = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
    expect(decodeFile(bytes)).toBe(text);
  });

  it("strips a UTF-8 BOM", () => {
    const bytes = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)]);
    expect(decodeFile(bytes)).toBe(text);
  });

  it("unpacks gzip first", () => {
    expect(decodeFile(gzipSync(Buffer.from(text)))).toBe(text);
  });
});

describe("parseFileName", () => {
  it("reads a PriceFull name, converting Israel winter time (UTC+2)", () => {
    const info = parseFileName("PriceFull7290027600007-001-001-20261115-030000.gz");
    expect(info).toMatchObject({ kind: "PriceFull", chainCode: "7290027600007", storeCode: "1" });
    expect(info?.time.toISOString()).toBe("2026-11-15T01:00:00.000Z");
  });

  it("uses summer time (UTC+3) in July", () => {
    const info = parseFileName("PriceFull7290058140886-001-733-20260701-0600");
    expect(info?.storeCode).toBe("733");
    expect(info?.time.toISOString()).toBe("2026-07-01T03:00:00.000Z");
  });

  it("reads a Stores name, which has no store code", () => {
    const info = parseFileName("Stores7290058140886-000-20261113-050500.xml");
    expect(info).toMatchObject({ kind: "Stores", storeCode: null });
  });

  it("accepts a shortened time (Shufersal sometimes writes HHM)", () => {
    const info = parseFileName("Stores7290027600007-000-20261116-020.gz");
    expect(info?.time.toISOString()).toBe("2026-11-16T00:00:00.000Z"); // 02:00 Israel time
  });

  it("rejects other names", () => {
    expect(parseFileName("readme.txt")).toBeNull();
  });
});

describe("normalizeQuantity", () => {
  it.each([
    ["קילוגרם", "1.5", 1500, "g"],
    ["גרם", "439", 439, "g"],
    ["ליטר", "1", 1000, "ml"],
    ["מיליליטר", "200.00", 200, "ml"],
    ["יחידות ", "6", 6, "unit"],
  ])("%s × %s → %d %s", (unitText, qty, quantity, unit) => {
    expect(normalizeQuantity(unitText, qty)).toEqual({ quantity, unit });
  });

  it("returns nulls for an unknown unit instead of guessing", () => {
    expect(normalizeQuantity("לא ידוע", "1")).toEqual({ quantity: null, unit: null });
  });
});

describe("parseStores", () => {
  it("reads Shufersal's <Chain> layout", () => {
    const stores = parseStores(fixture("shufersal-stores.xml"));
    expect(stores).toHaveLength(2);
    expect(stores[1]).toEqual({
      storeCode: "1",
      name: 'שלי ת"א- בן יהודה',
      address: "בן יהודה 79",
      cityCode: "5000",
    });
  });

  it("reads Rami Levy's <Root> layout and strips leading zeros", () => {
    const stores = parseStores(fixture("ramilevy-stores.xml"));
    expect(stores.map((s) => s.storeCode)).toEqual(["1", "733"]);
  });
});

describe("parsePriceFull", () => {
  const file = parsePriceFull(fixture("ramilevy-pricefull.xml"));

  it("reads the header", () => {
    expect(file).toMatchObject({ chainCode: "7290058140886", storeCode: "733" });
  });

  it("normalizes a barcoded item", () => {
    expect(file.items[0]).toEqual({
      itemCode: "7290011877859",
      isBarcode: true,
      name: "אינסטלטור פותח סתימו",
      manufacturer: "סנו",
      quantity: 200,
      unit: "ml",
      isWeighted: false,
      price: 14.9,
    });
  });

  it("keeps leading zeros of internal codes and drops 'unknown' manufacturers", () => {
    expect(file.items[1]).toMatchObject({
      itemCode: "0000000000123",
      isBarcode: false,
      manufacturer: null,
      isWeighted: true,
      quantity: 1000,
      unit: "g",
    });
  });

  it("counts lines without a valid price as skipped", () => {
    expect(file.items).toHaveLength(2);
    expect(file.skipped).toBe(1);
  });
});

describe("Shufersal listing", () => {
  it("extracts signed download links and file names", () => {
    const files = parseListing(fixture("shufersal-listing.html"));
    expect(files.map((f) => f.name)).toEqual([
      "PriceFull7290027600007-001-001-20261114-030000.gz",
      "PriceFull7290027600007-001-001-20261115-030000.gz",
    ]);
    expect(files[0]?.url).toContain("&sig=abc&");
  });
});

describe("newest", () => {
  it("compares the time in the name, not the name as text", async () => {
    const { newest } = await import("../src/chains/types.js");
    const file = (name: string) => ({ name, url: name });
    expect(
      newest([
        file("PriceFull7290803800003-000-027-20261116-004031.gz"),
        file("PriceFull7290803800003-999-027-20261115-004031.gz"),
        file("PriceFull7290803800003-7999-202405211349.gz"), // legacy format, ignored
      ])?.name,
    ).toBe("PriceFull7290803800003-000-027-20261116-004031.gz");
  });
});
