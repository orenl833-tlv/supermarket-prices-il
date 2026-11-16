import { sizeOf } from "./size.js";
import { CATEGORIES } from "./taxonomy.js";
import type { CategoryDef, Classified, ProductInfo } from "./types.js";

/** The first category whose rules match, with the product's attributes and size; or null. */
export function classify(product: ProductInfo, categories: CategoryDef[] = CATEGORIES): Classified | null {
  const name = product.name.replace(/\s+/g, " ").trim();
  for (const category of categories) {
    if (category.weighted !== undefined && category.weighted !== product.isWeighted) continue;
    if (!category.match.test(name)) continue;
    if (category.exclude?.test(name)) continue;
    const attributes = Object.fromEntries(category.attributes.map((a) => [a.key, a.read(name)]));
    if (category.requires?.some((key) => attributes[key] === null)) continue;
    return { category, attributes, size: sizeOf(product, category.unit) };
  }
  return null;
}

export function categoryByKey(key: string): CategoryDef | undefined {
  return CATEGORIES.find((c) => c.key === key);
}
