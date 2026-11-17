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

/** One way to fill a list item: a product, or a whole category ("any brand"). */
export interface ListOption {
  product: Product;
  anyBrand: boolean;
  /** What the user sees in the menu. */
  label: string;
}

export interface ListMatch {
  term: string;
  /** Choices for this item, best first. */
  options: ListOption[];
  /** Index into options, or null to leave the item out. */
  chosen: number | null;
}

/** How many products each item offers besides the category. */
export const OPTIONS_PER_ITEM = 6;

/**
 * The choices for one item of a typed list: the category as "any brand" when
 * the word names one, then the top search results. The first is chosen.
 */
export function matchOptions(term: string, result: SearchResult): ListMatch {
  const options: ListOption[] = [];
  if (result.suggestion) {
    options.push({
      product: result.suggestion.product,
      anyBrand: true,
      label: `${result.suggestion.category}, כל מותג`,
    });
  }
  for (const p of result.products.slice(0, OPTIONS_PER_ITEM)) {
    options.push({ product: p, anyBrand: false, label: p.name });
  }
  return { term, options, chosen: options.length > 0 ? 0 : null };
}

/** The choice that will be added for an item, if any. */
export function chosenOption(m: ListMatch): ListOption | null {
  return m.chosen === null ? null : (m.options[m.chosen] ?? null);
}
