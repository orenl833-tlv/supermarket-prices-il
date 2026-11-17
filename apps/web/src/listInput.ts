import type { Product, SearchResult } from "./api";

/**
 * A search box entry with commas is a whole list: "חלב, אורז, ביצים".
 * Returns the items (trimmed, de-duplicated, at most 20), or null for a
 * single search. Hebrew lists also use "ו" ("חלב, אורז וביצים"), but a
 * leading ו is too often part of a word to split on, so only commas count.
 */
export function splitList(text: string): string[] | null {
  if (!/[,،]/.test(text)) return null;
  const items = [...new Set(text.split(/[,،\n]+/).map((s) => s.trim().replace(/\s+/g, " ")))].filter(
    (s) => s.length >= 2,
  );
  return items.length >= 2 ? items.slice(0, 20) : null;
}

export interface ListMatch {
  term: string;
  product: Product | null;
  /** True when the match is a whole category ("milk, any brand"). */
  anyBrand: boolean;
}

/**
 * The best match for one item of a typed list: a category item ("any brand")
 * when the word names one, otherwise the top search result.
 */
export function bestMatch(term: string, result: SearchResult): ListMatch {
  if (result.suggestion) return { term, product: result.suggestion.product, anyBrand: true };
  return { term, product: result.products[0] ?? null, anyBrand: false };
}
