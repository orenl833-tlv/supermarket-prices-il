import { describe, expect, it } from "vitest";
import { queryKeys, rankHits, searchKey, stem } from "../src/search.js";

describe("searchKey and stem", () => {
  it("treats spellings with and without vowel letters alike", () => {
    expect(searchKey("לאבנה")).toBe(searchKey("לבנה"));
    expect(searchKey("קוטג'")).toBe(searchKey("קוטג"));
  });

  it("matches singular and plural through the stem", () => {
    expect(searchKey(stem("לימונים"))).toBe(searchKey("לימון"));
    expect(searchKey(stem("עגבניה"))).toBe(searchKey(stem("עגבניות")));
    expect(stem("תות")).toBe("תות"); // too short to have an ending
  });

  it("makes one key per query word", () => {
    expect(queryKeys("לאבנה  5%")).toEqual(["לבנה", "5%"]);
  });
});

const hit = (name: string, chains = 3, storeCount = 10) => ({
  name,
  chains: Array.from({ length: chains }, (_, i) => `c${i}`),
  storeCount,
});
const names = (query: string, hits: ReturnType<typeof hit>[]) => rankHits(query, hits).map((h) => h.name);

describe("rankHits", () => {
  it("puts plain Bamba before flavours, even when a flavour is sold in more stores", () => {
    expect(names("במבה", [hit("במבה נוגט 60 גרם", 4, 73), hit("במבה 80 גרם", 4, 39)])).toEqual([
      "במבה 80 גרם",
      "במבה נוגט 60 גרם",
    ]);
  });

  it("puts plain labaneh before labaneh with pickled lemon, whatever the spelling", () => {
    const hits = [hit("לאבנה לימון כבוש 250 גרם"), hit("לאבנה 5% 250 גרם")];
    expect(names("לבנה", hits)[0]).toBe("לאבנה 5% 250 גרם");
  });

  it("prefers whole-word matches: lemons before lemonade", () => {
    expect(names("לימונים", [hit("לימונדה 1.5 ליטר", 4, 60), hit("לימון", 1, 30)])).toEqual([
      "לימון",
      "לימונדה 1.5 ליטר",
    ]);
  });

  it("does not count sizes as extra words", () => {
    expect(names("ביצים", [hit("ביצי קינדר הפתעה", 4, 60), hit("ביצים 12 יח L", 2, 8)])[0]).toBe("ביצים 12 יח L");
  });

  it("among equally good names, prefers what more chains sell", () => {
    expect(names("קוטג", [hit("קוטג 5% 250 גרם", 1, 5), hit("קוטג 5% 250 גר", 4, 64)])[0]).toBe("קוטג 5% 250 גר");
  });
});
