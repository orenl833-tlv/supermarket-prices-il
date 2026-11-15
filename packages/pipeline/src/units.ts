import type { Unit } from "./types.js";

/**
 * Normalize a product's size to one of four base units, so prices can later be
 * compared per litre or per 100 g across chains.
 *
 * Chains write the unit in Hebrew, with small differences ("קילוגרם",
 * "ק\"ג", trailing spaces). Unknown units return null rather than a guess.
 */
const UNITS: Array<{ match: RegExp; unit: Unit; factor: number }> = [
  { match: /^(קילוגרם|קילו|ק"ג|קג|kg)$/i, unit: "g", factor: 1000 },
  { match: /^(גרם|גר|ג'|g|gr)$/i, unit: "g", factor: 1 },
  { match: /^(ליטר|ל'|l|lt|liter)$/i, unit: "ml", factor: 1000 },
  { match: /^(מיליליטר|מ"ל|מל|ml)$/i, unit: "ml", factor: 1 },
  { match: /^(יחידות|יחידה|יח'|יח|unit|units)$/i, unit: "unit", factor: 1 },
  { match: /^(מטרים|מטר|מ'|m)$/i, unit: "m", factor: 1 },
];

export function normalizeQuantity(
  unitText: string | null | undefined,
  quantityText: string | null | undefined,
): { quantity: number | null; unit: Unit | null } {
  const text = (unitText ?? "").trim();
  const rule = UNITS.find((u) => u.match.test(text));
  if (!rule) return { quantity: null, unit: null };

  const quantity = Number((quantityText ?? "").trim());
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { quantity: null, unit: rule.unit };
  }
  return { quantity: round(quantity * rule.factor), unit: rule.unit };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
