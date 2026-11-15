import { XMLParser } from "fast-xml-parser";
import { stripZeros } from "./filename.js";
import { normalizeQuantity } from "./units.js";
import type { PriceFile, PriceItem, StoreRecord } from "./types.js";

/**
 * Tag names differ in case between chains (<Store> vs <STORE>, <Item> vs
 * <item>), so every tag is lower-cased. Values stay strings: item codes have
 * leading zeros that must not be turned into numbers.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  transformTagName: (name) => name.toLowerCase(),
  isArray: (name) => name === "store" || name === "item",
});

type Node = Record<string, unknown>;

export function parseStores(xml: string): StoreRecord[] {
  const stores: Node[] = [];
  collect(parser.parse(xml), "store", stores);
  return stores.flatMap((s) => {
    const code = text(s.storeid);
    const name = text(s.storename);
    if (!code || !name) return [];
    return [
      {
        storeCode: stripZeros(code),
        name,
        address: text(s.address),
        cityCode: text(s.city),
      },
    ];
  });
}

export function parsePriceFull(xml: string): PriceFile {
  const doc = parser.parse(xml) as Node;
  const root = (doc.root ?? doc.prices ?? Object.values(doc)[0]) as Node | undefined;
  if (!root) throw new Error("Empty price file");

  const chainCode = text(root.chainid);
  const storeCode = text(root.storeid);
  if (!chainCode || !storeCode) throw new Error("Price file has no ChainID/StoreID");

  const rawItems: Node[] = [];
  collect(root, "item", rawItems);

  const items: PriceItem[] = [];
  let skipped = 0;
  for (const raw of rawItems) {
    const item = toPriceItem(raw);
    if (item) items.push(item);
    else skipped++;
  }
  return { chainCode, storeCode: stripZeros(storeCode), items, skipped };
}

function toPriceItem(raw: Node): PriceItem | null {
  const itemCode = text(raw.itemcode);
  const name = text(raw.itemname);
  const price = Number(text(raw.itemprice));
  if (!itemCode || !name || !Number.isFinite(price) || price <= 0) return null;

  const { quantity, unit } = normalizeQuantity(text(raw.unitqty), text(raw.quantity));
  return {
    itemCode,
    // ItemType 1 = manufacturer barcode shared across chains, 0 = internal code.
    isBarcode: text(raw.itemtype) !== "0",
    name,
    manufacturer: cleanManufacturer(text(raw.manufacturename)),
    quantity,
    unit,
    isWeighted: text(raw.bisweighted) === "1",
    price,
  };
}

function cleanManufacturer(value: string | null): string | null {
  if (!value || value === "לא ידוע" || value === "כללי") return null;
  return value;
}

function collect(node: unknown, tag: string, out: Node[]): void {
  if (Array.isArray(node)) {
    for (const child of node) collect(child, tag, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node)) {
    if (key === tag) {
      for (const v of value as Node[]) out.push(v);
    } else {
      collect(value, tag, out);
    }
  }
}

function text(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}
