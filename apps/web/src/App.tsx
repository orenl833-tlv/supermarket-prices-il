import { useEffect, useMemo, useState } from "react";
import { compare, status, type BasketEntry, type CompareResult, type Product } from "./api";
import { Basket } from "./components/Basket";
import { ProductSearch } from "./components/ProductSearch";
import { Results } from "./components/Results";
import { PLACES, Settings, type SearchSettings } from "./components/Settings";
import { age, storage } from "./format";

const DEFAULT_SETTINGS: SearchSettings = {
  location: PLACES[0]!,
  radiusKm: 1.5,
  maxStores: 1,
  extraStopCost: 15,
};

export function App() {
  const [basket, setBasket] = useState<BasketEntry[]>(() => storage.get("basket", []));
  const [settings, setSettings] = useState<SearchSettings>(() => storage.get("settings", DEFAULT_SETTINGS));
  const [result, setResult] = useState<CompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freshness, setFreshness] = useState<Array<{ chain: string; updatedAt: string | null }>>([]);
  const online = useOnline();

  useEffect(() => storage.set("basket", basket), [basket]);
  useEffect(() => storage.set("settings", settings), [settings]);
  useEffect(() => {
    status().then(setFreshness).catch(() => {});
  }, []);

  // Any change to the basket or settings makes old results stale.
  useEffect(() => setResult(null), [basket, settings]);

  const inBasket = useMemo(() => new Set(basket.map((e) => e.product.id)), [basket]);

  const add = (product: Product, options?: { anyBrand: boolean }) =>
    setBasket((b) => [...b, { product, quantity: 1, importance: "normal", anyBrand: options?.anyBrand ?? false }]);
  const change = (id: number, patch: Partial<BasketEntry>) =>
    setBasket((b) => b.map((e) => (e.product.id === id ? { ...e, ...patch } : e)));
  const remove = (id: number) => setBasket((b) => b.filter((e) => e.product.id !== id));

  async function run() {
    setLoading(true);
    setError(null);
    try {
      setResult(
        await compare({
          items: basket.map((e) => ({
            productId: e.product.id,
            quantity: e.quantity,
            importance: e.importance,
            anyBrand: e.anyBrand ?? false,
          })),
          lat: settings.location.lat,
          lon: settings.location.lon,
          radiusKm: settings.radiusKm,
          maxStores: settings.maxStores,
          extraStopCost: settings.extraStopCost,
        }),
      );
    } catch {
      setError("משהו השתבש בהשוואה. נסו שוב בעוד רגע.");
    } finally {
      setLoading(false);
    }
  }

  const updated = freshness
    .map((f) => f.updatedAt)
    .filter((t): t is string => t !== null)
    .sort()
    .at(0);

  return (
    <div className="page">
      <header className="top">
        <h1>הסל הזול</h1>
        <p>איפה הכי זול לקנות את כל הרשימה, בסופרים שקרובים אליכם בתל אביב.</p>
      </header>

      <main>
        <ProductSearch onAdd={add} inBasket={inBasket} />
        <Basket entries={basket} onChange={change} onRemove={remove} onClear={() => setBasket([])} />
        <Settings value={settings} onChange={setSettings} />

        {!online && (
          <p className="warn" role="status">
            אין חיבור לאינטרנט. הרשימה שמורה, וההשוואה תחזור כשיהיה חיבור.
          </p>
        )}
        <button className="primary" disabled={basket.length === 0 || loading || !online} onClick={run}>
          {loading ? "משווה…" : "איפה הכי זול?"}
        </button>
        {error && <p className="warn">{error}</p>}
        {result && <Results result={result} />}
      </main>

      <footer className="muted small">
        <p>
          מחירים רגילים, בלי מבצעים, מתוך הקבצים שהרשתות מפרסמות לפי חוק המזון.
          {updated && <> המחירים הישנים ביותר עודכנו {age(updated)}.</>}
        </p>
        <p>{freshness.map((f) => f.chain).join(" · ")}</p>
      </footer>
    </div>
  );
}

/** Tracks the browser's online/offline state. */
function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  return online;
}
