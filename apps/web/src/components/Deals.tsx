import { useEffect, useState } from "react";
import { deals as loadDeals, type Deal } from "../api";
import { money } from "../format";
import { Vegetable } from "./Veggies";

/**
 * "מציאות היום": products that one chain sells far below the others today,
 * from the daily data (see packages/api/src/deals.ts). Each can be added to
 * the list in one tap.
 */
export function Deals({ onAdd, inBasket }: { onAdd: (productId: number) => void; inBasket: Set<number> }) {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [all, setAll] = useState(false);

  useEffect(() => {
    loadDeals().then(setDeals).catch(() => {});
  }, []);

  if (deals.length === 0) return null;
  const shown = all ? deals : deals.slice(0, 5);

  return (
    <section className="card deals" aria-labelledby="deals-title">
      <h2 className="h2 row gap" id="deals-title">
        <Vegetable kind="tomato" size={28} />
        מציאות היום
      </h2>
      <p className="muted small">מוצרים שרשת אחת מוכרת היום הרבה מתחת למחיר ברשתות האחרות.</p>
      <ul className="deal-list">
        {shown.map((d) => (
          <li key={d.productId} className="row between">
            <span>
              <strong>{d.name}</strong>
              <span className="small">
                {" "}
                ב{d.chain} {money(d.price)}
                {" "}
                <s className="muted">{money(d.othersPrice)}</s>
                <span className="badge">-{Math.round(d.saving * 100)}%</span>
              </span>
              {d.promotion && <span className="muted small promo-text"> ({d.promotion})</span>}
            </span>
            <button
              className="link small"
              disabled={inBasket.has(d.productId)}
              onClick={() => onAdd(d.productId)}
              aria-label={`הוספת ${d.name}`}
            >
              {inBasket.has(d.productId) ? "ברשימה" : "הוספה"}
            </button>
          </li>
        ))}
      </ul>
      {deals.length > 5 && (
        <button className="link small" onClick={() => setAll(!all)}>
          {all ? "פחות" : `עוד ${deals.length - 5}`}
        </button>
      )}
    </section>
  );
}
