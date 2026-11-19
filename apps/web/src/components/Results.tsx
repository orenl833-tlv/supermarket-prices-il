import { useState } from "react";
import type { CompareResult, Plan } from "../api";
import { age, distance, isStale, money } from "../format";
import { planText } from "../shoppingList";
import { ResultsMap } from "./ResultsMap";

export function Results({
  result,
  origin,
  updatedAt = {},
  onAddUnits,
  onAddProduct,
}: {
  result: CompareResult;
  origin: { lat: number; lon: number };
  /** chain name -> when its prices were last updated */
  updatedAt?: Record<string, string | null>;
  /** Add units of a basket product, to take up a suggested deal. */
  onAddUnits?: (productId: number, units: number) => void;
  /** Add a product the basket does not have, to take up an unlocked deal. */
  onAddProduct?: (productId: number) => void;
}) {
  const name = (id: number) => result.productNames[id] ?? `מוצר ${id}`;
  const [best, ...rest] = result.plans;

  if (!best) {
    return (
      <section className="card">
        <p>לא נמצא סופר מתאים באזור. נסו להגדיל את המרחק או לסמן פחות מוצרים כ"חובה".</p>
      </section>
    );
  }

  return (
    <section aria-label="תוצאות">
      <p className="muted small">
        נבדקו {result.storesConsidered} סניפים באזור.
        {result.unavailable.length > 0 && <> אין באזור: {result.unavailable.map(name).join(", ")}.</>}
      </p>
      <ResultsMap origin={origin} plans={result.plans} />
      <PlanCard plan={best} best name={name} updatedAt={updatedAt} onAddUnits={onAddUnits} onAddProduct={onAddProduct} />
      {rest.map((plan, i) => (
        <PlanCard
          key={i}
          plan={plan}
          name={name}
          diff={plan.score - best.score}
          updatedAt={updatedAt}
          onAddUnits={onAddUnits}
          onAddProduct={onAddProduct}
        />
      ))}
    </section>
  );
}

function PlanCard({
  plan,
  best = false,
  diff = 0,
  name,
  updatedAt,
  onAddUnits,
  onAddProduct,
}: {
  plan: Plan;
  best?: boolean;
  diff?: number;
  name: (id: number) => string;
  updatedAt: Record<string, string | null>;
  onAddUnits?: (productId: number, units: number) => void;
  onAddProduct?: (productId: number) => void;
}) {
  const [open, setOpen] = useState(best);
  const [copied, setCopied] = useState(false);
  const stores = plan.stops.map((s) => `${s.store.chain} ${s.store.name}`).join(" + ");
  const substitutes = plan.stops.flatMap((s) => s.lines).filter((l) => l.substituteFor !== undefined);
  const staleChains = [...new Set(plan.stops.map((s) => s.store.chain))].filter((c) => isStale(updatedAt[c]));

  return (
    <article className={`card plan ${best ? "best" : ""}`}>
      <header className="row between">
        <div>
          {best && <span className="badge">הכי משתלם</span>}
          <h3 className="h3">{stores}</h3>
          <p className="muted small">
            {plan.stops.map((s) => distance(s.store.distanceKm)).join(" + ")}
            {plan.stops.length > 1 && " · שני סופרים"}
          </p>
        </div>
        <div className="price">
          <strong>{money(plan.itemsCost)}</strong>
          {plan.score !== plan.itemsCost && (
            <span className="muted small" title="כולל השלמת מוצרים חסרים, תחליפים ועצירה נוספת">
              משוקלל {money(plan.score)}
            </span>
          )}
          {!best && diff > 0 && <span className="muted small">+{money(diff)} מהמומלץ</span>}
        </div>
      </header>

      {staleChains.map((chain) => (
        <p key={chain} className="warn small">
          המחירים של {chain} עודכנו {age(updatedAt[chain]!)}, ואולי השתנו מאז.
        </p>
      ))}

      {substitutes.length > 0 && (
        <p className="note small">
          {substitutes.length === 1 ? "עם תחליף קרוב ל" : "עם תחליפים קרובים ל: "}
          {substitutes.map((l) => name(l.substituteFor!)).join(", ")}
        </p>
      )}

      {plan.missing.length > 0 && (
        <p className="warn small">
          חסר: {plan.missing.map((m) => name(m.productId)).join(", ")}
          {plan.missing.some((m) => m.importance === "normal") &&
            ` (בחישוב הוספנו ${money(plan.penaltyCost)} על קנייה במקום אחר)`}
        </p>
      )}

      <div className="row gap">
        <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "הסתרת פירוט" : "פירוט לפי סופר"}
        </button>
        <button
          className="link"
          onClick={async () => {
            // The phone's share sheet where there is one, otherwise the clipboard.
            const text = planText(plan, name);
            try {
              if (navigator.share) await navigator.share({ title: "רשימת קניות", text });
              else {
                await navigator.clipboard.writeText(text);
                setCopied(true);
              }
            } catch {
              /* share sheet closed or clipboard blocked */
            }
          }}
        >
          {copied ? "הרשימה הועתקה" : "שליחת רשימת קנייה"}
        </button>
      </div>
      {open &&
        plan.stops.map((stop) => (
          <div key={stop.store.id} className="stop">
            <p className="stop-name">
              {stop.store.chain} {stop.store.name}
              {stop.store.address && <span className="muted small"> · {stop.store.address}</span>}
            </p>
            <ul className="lines">
              {stop.lines.map((l) => (
                <li key={l.productId} className="row between">
                  <span>
                    {l.substituteFor !== undefined && <span className="tag">תחליף</span>}
                    {l.promotion && <span className="tag promo">מבצע</span>}
                    {name(l.productId)}
                    {l.quantity !== 1 && <span className="muted"> × {l.quantity}</span>}
                    {l.substituteFor !== undefined && (
                      <span className="muted small"> (במקום {name(l.substituteFor)})</span>
                    )}
                    {l.promotion && <span className="muted small promo-text"> {l.promotion}</span>}
                    {l.extraUnits ? (
                      <span className="small promo-extra">
                        {" "}
                        {l.extraUnits === 1 ? "כולל יחידה נוספת" : `כולל ${l.extraUnits} יחידות נוספות`} בלי
                        תוספת מחיר
                      </span>
                    ) : null}
                    {l.unlock && (
                      <span className="small promo-unlock">
                        {" "}
                        {l.unlock.promotion}: עוד {money(l.unlock.missing)} בקנייה בסניף והמבצע חל
                      </span>
                    )}
                    {l.suggestion && onAddUnits && (
                      <button
                        className="link small promo-suggestion"
                        onClick={() => onAddUnits(l.productId, l.suggestion!.quantity)}
                      >
                        {l.suggestion.quantity === 1 ? "עוד אחת" : `עוד ${l.suggestion.quantity}`} ב-
                        {money(l.suggestion.extraCost)} ({l.suggestion.promotion})
                      </button>
                    )}
                  </span>
                  <span>{money(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            {plan.stops.length > 1 && <p className="small subtotal">סה"כ בסופר הזה: {money(stop.subtotal)}</p>}
            {stop.unlockedDeals && stop.unlockedDeals.length > 0 && (
              <div className="unlocked">
                <p className="small">הקנייה כאן עוברת את המינימום של מבצעים נוספים:</p>
                <ul className="lines">
                  {stop.unlockedDeals.map((d) => (
                    <li key={d.productId} className="row between">
                      <span className="small">
                        {d.name} ב-{money(d.dealPrice)} <s className="muted">{money(d.regularPrice)}</s>
                        <span className="muted"> ({d.description})</span>
                      </span>
                      {onAddProduct && (
                        <button className="link small" onClick={() => onAddProduct(d.productId)}>
                          הוספה
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
    </article>
  );
}
