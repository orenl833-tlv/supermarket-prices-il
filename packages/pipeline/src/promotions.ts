import { XMLParser } from "fast-xml-parser";
import { stripZeros } from "./filename.js";

/**
 * Read a PromoFull file and keep the promotions the engine can price.
 *
 * A promotion has groups; each group lists items, and each item carries the
 * deal's numbers (checked on real Shufersal and Rami Levy files, 18.11):
 *   one group,  RewardType 3,     MinQty 1, DiscountedPrice P  -> unitPrice P
 *   one group,  RewardType 1/10,  MinQty N, DiscountedPrice X  -> bundle: N for X
 *   two groups, group 1 RewardType 0 MinQty N (what you buy),
 *               group 2 MinQty M DiscountRate R (what you get) -> buyGet N+M, R% off
 * Left out on purpose: coupons, club-only deals, deals with hours or days,
 * minimum-purchase deals, weighted items, and deals across different products.
 */
export interface PromoRow {
  itemCode: string;
  promotionId: string;
  description: string;
  kind: "unitPrice" | "bundle" | "buyGet";
  quantity: number | null;
  getQuantity: number | null;
  price: number | null;
  discount: number | null;
  startsAt: Date;
  endsAt: Date;
}

export interface PromoFile {
  chainCode: string;
  storeCode: string;
  rows: PromoRow[];
  /** Promotions in the file that were left out, by reason. */
  skipped: Record<string, number>;
}

const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  transformTagName: (name) => name.toLowerCase(),
  isArray: (name) => name === "promotion" || name === "group" || name === "promotionitem",
});

type Node = Record<string, unknown>;

interface RawItem {
  itemCode: string;
  rewardType: number;
  minQty: number;
  discountRate: number | null;
  discountedPrice: number | null;
  weighted: boolean;
}

export function parsePromoFull(xml: string, fileTime: Date): PromoFile {
  const doc = parser.parse(xml) as Node;
  const root = (doc.root ?? doc.promos ?? Object.values(doc)[0]) as Node | undefined;
  if (!root) throw new Error("Empty promotion file");
  const chainCode = text(root.chainid);
  const storeCode = text(root.storeid);
  if (!chainCode || !storeCode) throw new Error("Promotion file has no ChainID/StoreID");

  const promotions: Node[] = [];
  collect(root, "promotion", promotions);

  const rows: PromoRow[] = [];
  const skipped: Record<string, number> = {};
  for (const p of promotions) {
    const result = interpretPromotion(p, fileTime);
    if (typeof result === "string") skipped[result] = (skipped[result] ?? 0) + 1;
    else rows.push(...result);
  }
  return { chainCode, storeCode: stripZeros(storeCode), rows, skipped };
}

/** The rows for one promotion, or the reason it is left out. Exported for tests. */
export function interpretPromotion(p: Node, fileTime: Date): PromoRow[] | string {
  const description = text(p.promotiondescription) ?? "";
  const promotionId = text(p.promotionid);
  const startsAt = date(text(p.promotionstartdatetime));
  const endsAt = date(text(p.promotionenddatetime));
  if (!promotionId || !startsAt || !endsAt) return "incomplete";
  if (endsAt < fileTime) return "ended";
  if (text(p.additionaliscoupon) === "1" || /קופ/.test(description)) return "coupon";
  if (!(text(p.clubid) ?? "0").startsWith("0")) return "club";
  if (text(p.promotionstarthour) || text(p.promotionendhour) || text(p.promotiondays)) return "limited hours";
  if (/מעל\s*\d/.test(description)) return "minimum purchase";

  const groupNodes: Node[] = [];
  collect(p, "group", groupNodes);
  if (groupNodes.some((g) => (num(text(g.minpurchaseamount)) ?? 0) > 0)) return "minimum purchase";
  const groups = groupNodes.map((g) => {
    const items: Node[] = [];
    collect(g, "promotionitem", items);
    return items.map(toRawItem).filter((i): i is RawItem => i !== null);
  });
  if (groups.some((g) => g.some((i) => i.weighted || !Number.isInteger(i.minQty) || i.minQty < 1))) {
    return "weighted";
  }

  const base = { promotionId, description, startsAt, endsAt };
  const rows: PromoRow[] = [];
  if (groups.length === 1) {
    for (const i of groups[0]!) {
      const price = i.discountedPrice ?? 0;
      if (i.rewardType === 3 && i.minQty === 1 && price > 0) {
        rows.push({ ...base, itemCode: i.itemCode, kind: "unitPrice", quantity: null, getQuantity: null, price, discount: null });
      } else if ((i.rewardType === 1 || i.rewardType === 10) && i.minQty >= 2 && price > 0) {
        rows.push({ ...base, itemCode: i.itemCode, kind: "bundle", quantity: i.minQty, getQuantity: null, price, discount: null });
      }
    }
  } else if (groups.length === 2) {
    // Buy N of a product, get M of the same product at R% off.
    const gifts = new Map(groups[1]!.map((i) => [i.itemCode, i]));
    for (const buy of groups[0]!) {
      const get = gifts.get(buy.itemCode);
      const rate = get?.discountRate ?? null;
      if (buy.rewardType === 0 && get && rate !== null && rate > 0 && rate <= 100) {
        rows.push({
          ...base,
          itemCode: buy.itemCode,
          kind: "buyGet",
          quantity: buy.minQty,
          getQuantity: get.minQty,
          price: null,
          discount: rate / 100,
        });
      }
    }
  } else {
    return "unsupported";
  }
  // The same item can appear twice in a group; keep one row per item.
  const unique = [...new Map(rows.map((r) => [r.itemCode, r])).values()];
  return unique.length > 0 ? unique : "unsupported";
}

function toRawItem(n: Node): RawItem | null {
  const itemCode = text(n.itemcode);
  const rewardType = num(text(n.rewardtype));
  const minQty = num(text(n.minqty));
  if (!itemCode || rewardType === null || minQty === null) return null;
  return {
    itemCode,
    rewardType,
    minQty,
    discountRate: num(text(n.discountrate)),
    discountedPrice: num(text(n.discountedprice)),
    weighted: text(n.biswighted) === "1" || text(n.bisweighted) === "1",
  };
}

/** Promotion times are Israel local time without an offset; +02/+03 is close enough for a date range. */
function date(s: string | null): Date | null {
  if (!s) return null;
  const d = new Date(`${s.replace(" ", "T").slice(0, 19)}+02:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function num(s: string | null): number | null {
  if (s === null || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function collect(node: unknown, tag: string, out: Node[]): void {
  if (Array.isArray(node)) {
    for (const n of node) collect(n, tag, out);
    return;
  }
  if (node === null || typeof node !== "object") return;
  for (const [key, value] of Object.entries(node as Node)) {
    if (key === tag) {
      for (const v of Array.isArray(value) ? value : [value]) if (v && typeof v === "object") out.push(v as Node);
    } else {
      collect(value, tag, out);
    }
  }
}
