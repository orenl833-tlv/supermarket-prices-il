import { describe, expect, it } from "vitest";
import { nominatim, shortLabel, streetAddress } from "../src/geocode.js";

describe("nominatim search", () => {
  it("returns the first hit with a short label, and caches it", async () => {
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response(
        JSON.stringify([{ lat: "32.0779", lon: "34.7738", display_name: "דיזנגוף 50, לב העיר, תל אביב-יפו, ישראל" }]),
      );
    }) as typeof fetch;
    const lookup = nominatim(fakeFetch).search;

    expect(await lookup("דיזנגוף  50")).toEqual({ lat: 32.0779, lon: 34.7738, label: "דיזנגוף 50, לב העיר" });
    expect(await lookup("דיזנגוף 50")).toEqual({ lat: 32.0779, lon: 34.7738, label: "דיזנגוף 50, לב העיר" });
    expect(urls).toHaveLength(1); // the second search came from the cache
    expect(urls[0]).toContain("bounded=1");
  });

  it("returns null when nothing in Tel Aviv matches", async () => {
    const lookup = nominatim((async () => new Response("[]")) as unknown as typeof fetch).search;
    expect(await lookup("רחוב שלא קיים")).toBeNull();
  });
});

describe("shortLabel", () => {
  it("keeps the street and neighbourhood", () => {
    expect(shortLabel("כיכר רבין, הצפון הישן, תל אביב-יפו, ישראל")).toBe("כיכר רבין, הצפון הישן");
  });
});

describe("nominatim reverse", () => {
  it("gives the street address, cached by position rounded to about 10 m", async () => {
    let calls = 0;
    const fakeFetch = (async () => {
      calls++;
      return new Response(JSON.stringify({ address: { road: "דיזנגוף", house_number: "50", suburb: "לב העיר" } }));
    }) as unknown as typeof fetch;
    const { reverse } = nominatim(fakeFetch);
    expect(await reverse(32.07751, 34.77553)).toBe("דיזנגוף 50, לב העיר");
    expect(await reverse(32.077512, 34.775531)).toBe("דיזנגוף 50, לב העיר");
    expect(calls).toBe(1);
  });
});

describe("streetAddress", () => {
  it("joins street, number and neighbourhood, and copes with missing parts", () => {
    expect(streetAddress({ road: "אבן גבירול", house_number: "71", neighbourhood: "הצפון הישן" })).toBe(
      "אבן גבירול 71, הצפון הישן",
    );
    expect(streetAddress({ road: "כיכר רבין" })).toBe("כיכר רבין");
    expect(streetAddress({})).toBeNull();
  });
});
