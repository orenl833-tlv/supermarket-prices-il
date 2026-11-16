import type { Plan } from "./api";
import { money } from "./format";

/**
 * A plan as plain text to paste into WhatsApp or a notes app: one block per
 * store, its items with quantities and prices, then the total. Substitutes say
 * what they replace, so whoever goes shopping knows it is on purpose.
 */
export function planText(plan: Plan, name: (productId: number) => string): string {
  const blocks = plan.stops.map((stop) => {
    const header = `🛒 ${stop.store.chain} ${stop.store.name}${stop.store.address ? `, ${stop.store.address}` : ""}`;
    const lines = stop.lines.map((l) => {
      const qty = l.quantity !== 1 ? ` ×${l.quantity}` : "";
      const instead = l.substituteFor !== undefined ? ` (במקום ${name(l.substituteFor)})` : "";
      return `- ${name(l.productId)}${qty}${instead}: ${money(l.lineTotal)}`;
    });
    return [header, ...lines].join("\n");
  });
  const missing = plan.missing.length > 0 ? [`חסר: ${plan.missing.map((m) => name(m.productId)).join(", ")}`] : [];
  return [...blocks, ...missing, `סה"כ: ${money(plan.itemsCost)}`].join("\n\n");
}
