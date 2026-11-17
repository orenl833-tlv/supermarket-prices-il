import { useEffect, useState } from "react";
import { searchProducts, type Product, type SearchResult } from "../api";
import { money, size, unitPrice } from "../format";
import { chosenOption, matchOptions, splitList, type ListMatch, type ListOption } from "../listInput";

/** Search box with results that update as you type (debounced, stale requests cancelled). */
export function ProductSearch({
  onAdd,
  inBasket,
}: {
  onAdd: (p: Product, options?: { anyBrand: boolean }) => void;
  inBasket: Set<number>;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [suggestion, setSuggestion] = useState<SearchResult["suggestion"]>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [listMatches, setListMatches] = useState<ListMatch[] | null>(null);

  useEffect(() => {
    const q = query.trim();
    // "חלב, אורז, ביצים": a whole list, one match per item.
    const items = splitList(q);
    setListMatches(null);
    if (items) {
      setResults([]);
      setSuggestion(null);
      const controller = new AbortController();
      const timer = setTimeout(() => {
        setLoading(true);
        setFailed(false);
        Promise.all(items.map((term) => searchProducts(term, controller.signal).then((r) => matchOptions(term, r))))
          .then(setListMatches)
          .catch((err: unknown) => {
            if (!(err instanceof DOMException && err.name === "AbortError")) setFailed(true);
          })
          .finally(() => setLoading(false));
      }, 400);
      return () => {
        clearTimeout(timer);
        controller.abort();
      };
    }
    if (q.length < 2) {
      setResults([]);
      setSuggestion(null);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setLoading(true);
      setFailed(false);
      searchProducts(q, controller.signal)
        .then((r) => {
          setResults(r.products);
          setSuggestion(r.suggestion);
        })
        .catch((err: unknown) => {
          // An aborted request was replaced by a newer one; anything else is a real failure.
          if (!(err instanceof DOMException && err.name === "AbortError")) {
            setResults([]);
            setSuggestion(null);
            setFailed(true);
          }
        })
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
        placeholder="מוצר אחד, או רשימה עם פסיקים: חלב, לחם, ביצים"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        autoComplete="off"
      />
      {loading && <p className="muted small">מחפש…</p>}
      {listMatches && (
        <ListPreview
          matches={listMatches}
          inBasket={inBasket}
          onChoose={(i, chosen) =>
            setListMatches((ms) => ms && ms.map((m, j) => (j === i ? { ...m, chosen } : m)))
          }
          onAddAll={(toAdd) => {
            for (const o of toAdd) onAdd(o.product, { anyBrand: o.anyBrand });
            setQuery("");
          }}
        />
      )}
      {suggestion && !inBasket.has(suggestion.product.id) && (
        <button
          className="suggestion"
          onClick={() => {
            onAdd(suggestion.product, { anyBrand: true });
            setQuery("");
          }}
        >
          <span>
            <strong>{suggestion.category}, כל מותג</strong>
            <span className="muted small"> · הזול בכל סניף, למשל {suggestion.product.name}</span>
          </span>
          <span className="add" aria-hidden>
            +
          </span>
        </button>
      )}
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
                    {p.chains.length === 1
                      ? `רק ב${p.chains[0]}`
                      : p.cheapestChain
                        ? `הכי זול ב${p.cheapestChain}`
                        : `ב-${p.chains.length} רשתות`}
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
      {failed && <p className="warn small">החיפוש לא זמין כרגע. נסו שוב בעוד רגע.</p>}
      {query.trim().length >= 2 && !loading && !failed && !listMatches && results.length === 0 && (
        <p className="muted small">לא נמצאו מוצרים. נסו מילה אחרת או ברקוד.</p>
      )}
    </section>
  );
}

/**
 * What each item of a typed list matched. Each item has a menu to pick
 * another product (or the whole category) or to leave it out, then one
 * button adds them all.
 */
function ListPreview({
  matches,
  inBasket,
  onChoose,
  onAddAll,
}: {
  matches: ListMatch[];
  inBasket: Set<number>;
  onChoose: (index: number, chosen: number | null) => void;
  onAddAll: (toAdd: ListOption[]) => void;
}) {
  const toAdd = matches
    .map(chosenOption)
    .filter((o): o is ListOption => o !== null && !inBasket.has(o.product.id));
  return (
    <div className="list-preview" aria-label="רשימה שהוקלדה">
      <ul>
        {matches.map((m, i) => {
          const chosen = chosenOption(m);
          return (
            <li key={m.term}>
              <label className="list-term" htmlFor={`list-item-${i}`}>
                {m.term}
              </label>
              {m.options.length > 0 ? (
                <select
                  id={`list-item-${i}`}
                  className="input"
                  value={m.chosen ?? "skip"}
                  onChange={(e) => onChoose(i, e.target.value === "skip" ? null : Number(e.target.value))}
                >
                  {m.options.map((o, k) => (
                    <option key={k} value={k}>
                      {o.label}
                      {o.anyBrand ? "" : ` · ${money(o.product.minPrice)}`}
                    </option>
                  ))}
                  <option value="skip">לא להוסיף</option>
                </select>
              ) : (
                <span className="muted">לא נמצא, נסו מילה אחרת</span>
              )}
              {chosen && inBasket.has(chosen.product.id) && <span className="muted small">כבר ברשימה</span>}
            </li>
          );
        })}
      </ul>
      <button className="primary" disabled={toAdd.length === 0} onClick={() => onAddAll(toAdd)}>
        הוספת {toAdd.length} מוצרים לרשימה
      </button>
    </div>
  );
}
