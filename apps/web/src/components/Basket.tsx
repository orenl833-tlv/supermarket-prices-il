import type { BasketEntry, Importance } from "../api";
import { size } from "../format";

const IMPORTANCE: Array<{ value: Importance; label: string; hint: string }> = [
  { value: "must", label: "חובה", hint: "רק חנויות שיש בהן את המוצר" },
  { value: "normal", label: "רגיל", hint: "אם חסר, נחשב כמה יעלה לקנות אותו במקום אחר" },
  { value: "optional", label: "אם יש", hint: "לא נורא אם חסר" },
];

export function Basket({
  entries,
  onChange,
  onRemove,
  onClear,
}: {
  entries: BasketEntry[];
  onChange: (id: number, patch: Partial<BasketEntry>) => void;
  onRemove: (id: number) => void;
  onClear: () => void;
}) {
  if (entries.length === 0) {
    return (
      <section className="card empty">
        <p>הסל ריק. חפשו מוצרים והוסיפו אותם לרשימה.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="row between">
        <h2 className="h2">הרשימה שלי ({entries.length})</h2>
        <button className="link" onClick={onClear}>
          ניקוי
        </button>
      </div>
      <ul className="basket">
        {entries.map(({ product, quantity, importance, anyBrand }) => {
          const step = product.isWeighted ? 0.5 : 1;
          return (
            <li key={product.id} className="basket-item">
              <div className="row between">
                <span className="item-name">
                  {product.name}
                  {size(product.quantity, product.unit) && (
                    <span className="muted small"> · {size(product.quantity, product.unit)}</span>
                  )}
                </span>
                <button className="icon" aria-label={`הסרת ${product.name}`} onClick={() => onRemove(product.id)}>
                  ×
                </button>
              </div>
              <div className="row between wrap">
                <div className="stepper" aria-label="כמות">
                  <button
                    aria-label="הפחתה"
                    onClick={() => onChange(product.id, { quantity: Math.max(step, quantity - step) })}
                  >
                    −
                  </button>
                  <span>
                    {quantity}
                    {product.isWeighted ? ' ק"ג' : ""}
                  </span>
                  <button aria-label="הוספה" onClick={() => onChange(product.id, { quantity: quantity + step })}>
                    +
                  </button>
                </div>
                {product.category && (
                  <label className="check small inline" title={`כל ${product.category} דומה מתאים, והזול ייבחר`}>
                    <input
                      type="checkbox"
                      checked={anyBrand ?? false}
                      onChange={(e) => onChange(product.id, { anyBrand: e.target.checked })}
                    />
                    גם מותג אחר
                  </label>
                )}
                <div className="segmented" role="radiogroup" aria-label="חשיבות">
                  {IMPORTANCE.map((opt) => (
                    <button
                      key={opt.value}
                      role="radio"
                      aria-checked={importance === opt.value}
                      title={opt.hint}
                      className={importance === opt.value ? "on" : ""}
                      onClick={() => onChange(product.id, { importance: opt.value })}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
