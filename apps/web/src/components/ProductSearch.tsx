import { useEffect, useState } from "react";
import { searchProducts, type Product } from "../api";
import { money, size, unitPrice } from "../format";

/** Search box with results that update as you type (debounced, stale requests cancelled). */
export function ProductSearch({ onAdd, inBasket }: { onAdd: (p: Product) => void; inBasket: Set<number> }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      searchProducts(q, controller.signal)
        .then(setResults)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  return (
    <section className="card">
      <label className="label" htmlFor="search">
        מה צריך לקנות?
      </label>
      <input
        id="search"
        className="input"
        type="search"
        placeholder="למשל: חלב 3%, לחם, קוטג'"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {loading && <p className="muted small">מחפש…</p>}
      {results.length > 0 && (
        <ul className="results" aria-label="תוצאות חיפוש">
          {results.map((p) => (
            <li key={p.id}>
              <button
                className="result"
                disabled={inBasket.has(p.id)}
                onClick={() => {
                  onAdd(p);
                  setQuery("");
                }}
              >
                <span className="result-name">
                  {p.name}
                  {p.manufacturer && <span className="muted"> · {p.manufacturer}</span>}
                  {size(p.quantity, p.unit) && <span className="muted"> · {size(p.quantity, p.unit)}</span>}
                </span>
                <span className="result-meta">
                  {p.minPrice === p.maxPrice ? money(p.minPrice) : `${money(p.minPrice)}–${money(p.maxPrice)}`}
                  {p.unitPrice && <span className="muted small">{unitPrice(p.unitPrice)}</span>}
                  <span className="muted small">
                    {p.chains.length === 1 ? `רק ב${p.chains[0]}` : `ב-${p.chains.length} רשתות`}
                  </span>
                </span>
                <span className="add" aria-hidden>
                  {inBasket.has(p.id) ? "✓" : "+"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && !loading && results.length === 0 && (
        <p className="muted small">לא נמצאו מוצרים. נסו מילה אחרת או ברקוד.</p>
      )}
    </section>
  );
}
