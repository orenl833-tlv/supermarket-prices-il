import { Vegetable } from "./Veggies";
import type { BasketEntry, Importance } from "../api";
import { useState } from "react";
import { size } from "../format";
import { shareUrl } from "../share";
import { PriceHistory } from "./PriceHistory";

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
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // The product whose price history is open (one at a time keeps the list short).
  const [historyOf, setHistoryOf] = useState<number | null>(null);

  /**
   * Shares the list as a link: the phone's share sheet where there is one
   * (WhatsApp and the like), otherwise the clipboard. The link is also shown,
   * so it can always be copied by hand.
   */
  async function share() {
    const url = shareUrl(entries);
    setLink(url);
    setCopied(false);
    try {
      if (navigator.share) {
        await navigator.share({ title: "הרשימה שלי", text: "רשימת קניות מהסל הזול", url });
      } else {
        await navigator.clipboard.writeText(url);
        setCopied(true);
      }
    } catch {
      /* the share sheet was closed, or the clipboard is blocked: the link is shown */
    }
  }

  if (entries.length === 0) {
    return (
      <section className="card empty">
        <Vegetable kind="pepper" size={56} className="empty-veg" />
        <p>הסל ריק. חפשו מוצרים והוסיפו אותם לרשימה.</p>
      </section>
    );
  }

  return (
    <section className="card">
      <div className="row between">
        <h2 className="h2">הרשימה שלי ({entries.length})</h2>
        <div className="row gap">
          <button className="link" onClick={share}>
            שיתוף
          </button>
          <button className="link" onClick={onClear}>
            ניקוי
          </button>
        </div>
      </div>
      {link && (
        <div className="share-box" role="status">
          <span className="small">{copied ? "הקישור הועתק. אפשר להדביק בווטסאפ." : "הקישור לרשימה:"}</span>
          <input
            className="input small"
            dir="ltr"
            readOnly
            value={link}
            aria-label="קישור לרשימה"
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}
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
              <button
                className="link small history-toggle"
                aria-expanded={historyOf === product.id}
                onClick={() => setHistoryOf(historyOf === product.id ? null : product.id)}
              >
                {historyOf === product.id ? "הסתרת היסטוריית המחיר" : "היסטוריית מחיר"}
              </button>
              {historyOf === product.id && <PriceHistory productId={product.id} />}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
