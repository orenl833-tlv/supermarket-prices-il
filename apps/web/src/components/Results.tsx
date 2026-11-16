import { useState } from "react";
import type { CompareResult, Plan } from "../api";
import { distance, money } from "../format";

export function Results({ result }: { result: CompareResult }) {
  const name = (id: number) => result.productNames[id] ?? `מוצר ${id}`;
  const [best, ...rest] = result.plans;

  if (!best) {
    return (
      <section className="card">
        <p>לא נמצא סופר מתאים באזור. נסו להגדיל את מרחק ההליכה או לסמן פחות מוצרים כ"חובה".</p>
      </section>
    );
  }

  return (
    <section aria-label="תוצאות">
      <p className="muted small">
        נבדקו {result.storesConsidered} סניפים באזור.
        {result.unavailable.length > 0 && <> אין באזור: {result.unavailable.map(name).join(", ")}.</>}
      </p>
      <PlanCard plan={best} best name={name} />
      {rest.map((plan, i) => (
        <PlanCard key={i} plan={plan} name={name} diff={plan.score - best.score} />
      ))}
    </section>
  );
}

function PlanCard({
  plan,
  best = false,
  diff = 0,
  name,
}: {
  plan: Plan;
  best?: boolean;
  diff?: number;
  name: (id: number) => string;
}) {
  const [open, setOpen] = useState(best);
  const stores = plan.stops.map((s) => `${s.store.chain} ${s.store.name}`).join(" + ");
  const substitutes = plan.stops.flatMap((s) => s.lines).filter((l) => l.substituteFor !== undefined);

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

      <button className="link" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "הסתרת פירוט" : "פירוט לפי סופר"}
      </button>
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
                    {name(l.productId)}
                    {l.quantity !== 1 && <span className="muted"> × {l.quantity}</span>}
                    {l.substituteFor !== undefined && (
                      <span className="muted small"> (במקום {name(l.substituteFor)})</span>
                    )}
                  </span>
                  <span>{money(l.lineTotal)}</span>
                </li>
              ))}
            </ul>
            {plan.stops.length > 1 && <p className="small subtotal">סה"כ בסופר הזה: {money(stop.subtotal)}</p>}
          </div>
        ))}
    </article>
  );
}
