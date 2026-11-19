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
 * Deals that need a minimum purchase in the store ("מעל 75") keep it in
 * minPurchase; the engine applies them only when the rest of the basket in
 * that store reaches it. A per-customer limit ("עד 3 יח'", MaxQty) is kept
 * for unit-price deals.
 * Left out on purpose: coupons, club-only deals, deals with hours or days,
 * weighted items, and deals across different products.
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
  /** Spend at least this much on other products in the store (shekels). */
  minPurchase: number | null;
  /** At most this many units at the promotion price (unit-price deals). */
  maxUnits: number | null;
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
  /** Per-customer limit, when the chain sets one. */
  maxQty: number | null;
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

/**
 * Why a file's promotions were left out, with a few examples per reason and
 * the fields that decided it. For diagnosing a chain whose files differ
 * (src/diagnose-promotions.ts); the daily run does not use it.
 */
export function diagnosePromoFull(xml: string, fileTime: Date): Record<string, { count: number; examples: string[] }> {
  const doc = parser.parse(xml) as Node;
  const promotions: Node[] = [];
  collect(doc, "promotion", promotions);
  const out: Record<string, { count: number; examples: string[] }> = {};
  for (const p of promotions) {
    const result = interpretPromotion(p, fileTime);
    const reason = typeof result === "string" ? result : "kept";
    const entry = (out[reason] ??= { count: 0, examples: [] });
    entry.count++;
    if (entry.examples.length < 6) {
      const groups: Node[] = [];
      collect(p, "group", groups);
      const items = groups.map((g) => {
        const its: Node[] = [];
        collect(g, "promotionitem", its);
        const i = its[0] ?? {};
        return `[${its.length} items, reward ${text(i.rewardtype)}, minQty ${text(i.minqty)}, price ${text(i.discountedprice)}, rate ${text(i.discountrate)}, min ${text(g.minpurchaseamount)}]`;
      });
      entry.examples.push(
        `${text(p.promotiondescription)} | club ${text(p.clubid)} | hours ${text(p.promotionstarthour)}-${text(p.promotionendhour)} days ${text(p.promotiondays)} | coupon ${text(p.additionaliscoupon)} | ${items.join(" ")}`,
      );
    }
  }
  return out;
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
  if (limitedHours(text(p.promotionstarthour), text(p.promotionendhour)) || limitedDays(text(p.promotiondays))) {
    return "limited hours";
  }

  const groupNodes: Node[] = [];
  collect(p, "group", groupNodes);
  // The minimum is in MinPurchaseAmount; a few deals only say it in words ("מעל 99").
  const minFromGroups = Math.max(0, ...groupNodes.map((g) => num(text(g.minpurchaseamount)) ?? 0));
  const minFromText = Number(/מעל\s*(\d+)/.exec(description)?.[1] ?? 0);
  const minPurchase = minFromGroups || minFromText || null;
  // A group whose only item is the code 0000000000000 stands for "anything in
  // the store": it carries the minimum purchase, not a product, so drop it.
  const groups = groupNodes
    .map((g) => {
      const items: Node[] = [];
      collect(g, "promotionitem", items);
      return items.map(toRawItem).filter((i): i is RawItem => i !== null && !/^0+$/.test(i.itemCode));
    })
    .filter((g) => g.length > 0);
  if (groups.some((g) => g.some((i) => i.weighted || !Number.isInteger(i.minQty) || i.minQty < 1))) {
    return "weighted";
  }
  // RedemptionLimit: how many times one customer may use the deal.
  const redemptions = num(text(p.redemptionlimit));
  const limit = redemptions && redemptions > 0 ? redemptions : null;

  const base = { promotionId, description, startsAt, endsAt, minPurchase };
  const rows: PromoRow[] = [];
  if (groups.length === 1) {
    for (const i of groups[0]!) {
      const price = i.discountedPrice ?? 0;
      const isUnitPrice = (i.rewardType === 3 || i.rewardType === 2) && i.minQty === 1 && price > 0;
      if (isUnitPrice) {
        rows.push({
          ...base,
          itemCode: i.itemCode,
          kind: "unitPrice",
          quantity: null,
          getQuantity: null,
          price,
          discount: null,
          maxUnits: i.maxQty ?? limit,
        });
      } else if ((i.rewardType === 1 || i.rewardType === 10) && i.minQty >= 2 && price > 0) {
        rows.push({
          ...base,
          itemCode: i.itemCode,
          kind: "bundle",
          quantity: i.minQty,
          getQuantity: null,
          price,
          discount: null,
          maxUnits: i.maxQty ?? (limit ? limit * i.minQty : null),
        });
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
          maxUnits: limit ? limit * (buy.minQty + get.minQty) : null,
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

/**
 * A deal limited to part of the day. Carrefour fills the fields with the whole
 * day ("00:01:00.000" to "23:59:00.000"), which is no limit at all.
 */
export function limitedHours(start: string | null, end: string | null): boolean {
  const minutes = (t: string | null, fallback: number) => {
    const m = t ? /^(\d{1,2}):(\d{2})/.exec(t) : null;
    return m ? Number(m[1]) * 60 + Number(m[2]) : fallback;
  };
  return minutes(start, 0) > 1 || minutes(end, 24 * 60) < 23 * 60 + 58;
}

/** A deal limited to some days of the week; all seven days ("1234567") is no limit. */
function limitedDays(days: string | null): boolean {
  if (!days) return false;
  const digits = new Set(days.replace(/\D/g, ""));
  return digits.size > 0 && digits.size < 7;
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
    maxQty: (num(text(n.maxqty)) ?? 0) > 0 ? num(text(n.maxqty)) : null,
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
