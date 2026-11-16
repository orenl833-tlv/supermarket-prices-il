const shekel = new Intl.NumberFormat("he-IL", { style: "currency", currency: "ILS" });

export const money = (n: number) => shekel.format(n);

export function distance(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} מ'` : `${km.toFixed(1)} ק"מ`;
}

export function size(quantity: number | null, unit: string | null): string {
  if (!quantity || !unit) return "";
  if (unit === "g") return quantity >= 1000 ? `${quantity / 1000} ק"ג` : `${quantity} גרם`;
  if (unit === "ml") return quantity >= 1000 ? `${quantity / 1000} ליטר` : `${quantity} מ"ל`;
  if (unit === "unit") return `${quantity} יח'`;
  return "";
}

/** "לפני 3 שעות" style age of a timestamp. */
export function age(iso: string, now = Date.now()): string {
  const hours = Math.round((now - Date.parse(iso)) / 3_600_000);
  if (hours < 1) return "לפני פחות משעה";
  if (hours < 24) return hours === 1 ? "לפני שעה" : `לפני ${hours} שעות`;
  const days = Math.round(hours / 24);
  return days === 1 ? "אתמול" : `לפני ${days} ימים`;
}

/** Read and write localStorage without ever throwing (private mode, blocked storage). */
export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* not critical */
    }
  },
};
