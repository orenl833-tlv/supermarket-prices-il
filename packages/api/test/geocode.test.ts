import { describe, expect, it } from "vitest";
import { nominatimLookup, shortLabel } from "../src/geocode.js";

describe("nominatimLookup", () => {
  it("returns the first hit with a short label, and caches it", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify([{ lat: "32.0779", lon: "34.7738", display_name: "דיזנגוף 50, לב העיר, תל אביב-יפו, ישראל" }]),
      );
    }) as typeof fetch;
    const lookup = nominatimLookup(fakeFetch);

    expect(await lookup("דיזנגוף  50")).toEqual({ lat: 32.0779, lon: 34.7738, label: "דיזנגוף 50, לב העיר" });
    expect(await lookup("דיזנגוף 50")).toEqual({ lat: 32.0779, lon: 34.7738, label: "דיזנגוף 50, לב העיר" });
    expect(urls).toHaveLength(1); // the second search came from the cache
    expect(urls[0]).toContain("bounded=1");
  });

  it("returns null when nothing in Tel Aviv matches", async () => {
    const lookup = nominatimLookup((async () => new Response("[]")) as unknown as typeof fetch);
    expect(await lookup("רחוב שלא קיים")).toBeNull();
  });
});

describe("shortLabel", () => {
  it("keeps the street and neighbourhood", () => {
    expect(shortLabel("כיכר רבין, הצפון הישן, תל אביב-יפו, ישראל")).toBe("כיכר רבין, הצפון הישן");
  });
});
