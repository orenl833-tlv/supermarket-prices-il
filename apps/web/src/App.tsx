import { useEffect, useMemo, useState } from "react";
import { compare, productsByIds, status, type BasketEntry, type ChainStatus, type CompareResult, type Product } from "./api";
import { Basket } from "./components/Basket";
import { ProductSearch } from "./components/ProductSearch";
import { Results } from "./components/Results";
import { PLACES, Settings, type SearchSettings } from "./components/Settings";
import { age, storage } from "./format";
import { decodeList } from "./share";
import { VeggieRow } from "./components/Veggies";

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
  const [freshness, setFreshness] = useState<ChainStatus[]>([]);
  const online = useOnline();

  useEffect(() => storage.set("basket", basket), [basket]);
  useEffect(() => storage.set("settings", settings), [settings]);
  useEffect(() => {
    status().then(setFreshness).catch(() => {});
  }, []);

  // Opening a shared list (?list=...): load its products, then drop the
  // parameter so a reload does not import it again.
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("list");
    if (!param) return;
    window.history.replaceState(null, "", window.location.pathname);
    const items = decodeList(param);
    if (items.length === 0) return;
    productsByIds(items.map((i) => i.productId))
      .then((products) => {
        const byId = new Map(products.map((p) => [p.id, p]));
        const shared: BasketEntry[] = items.flatMap((i) => {
          const product = byId.get(i.productId);
          return product ? [{ product, quantity: i.quantity, importance: i.importance, anyBrand: i.anyBrand }] : [];
        });
        setBasket((current) =>
          current.length === 0 || window.confirm("לפתוח את הרשימה ששותפה במקום הרשימה הנוכחית?") ? shared : current,
        );
      })
      .catch(() => setError("לא הצלחנו לפתוח את הרשימה ששותפה."));
  }, []);

  // Any change to the basket or settings makes old results stale, unless the
  // change came from the results themselves (taking up a deal): then compare again.
  const [recompare, setRecompare] = useState(false);
  useEffect(() => {
    setResult(null);
    if (recompare) {
      setRecompare(false);
      void run();
    }
    // run reads the latest basket; it is not a dependency on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basket, settings]);

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
        <VeggieRow />
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
        {result && (
          <Results
            result={result}
            origin={settings.location}
            updatedAt={Object.fromEntries(freshness.map((f) => [f.chain, f.updatedAt]))}
            onAddUnits={(productId, units) => {
              setRecompare(true);
              setBasket((b) => b.map((e) => (e.product.id === productId ? { ...e, quantity: e.quantity + units } : e)));
            }}
          />
        )}
      </main>

      <footer className="muted small">
        <p>
          מחירים רגילים, בלי מבצעים, מתוך הקבצים שהרשתות מפרסמות לפי חוק המזון.
          {updated && <> המחירים הישנים ביותר עודכנו {age(updated)}.</>}
        </p>
        {freshness.length > 0 && <DataPanel chains={freshness} />}
      </footer>
    </div>
  );
}

/** What the daily pipeline loaded, per chain: shows the data is real and current. */
function DataPanel({ chains }: { chains: ChainStatus[] }) {
  const total = (key: "branches" | "products") => chains.reduce((sum, c) => sum + c[key], 0);
  return (
    <details className="data-panel">
      <summary>
        {chains.length} רשתות · {total("branches")} סניפים בתל אביב · על הנתונים
      </summary>
      <table>
        <thead>
          <tr>
            <th scope="col">רשת</th>
            <th scope="col">סניפים</th>
            <th scope="col">מוצרים</th>
            <th scope="col">עודכן</th>
          </tr>
        </thead>
        <tbody>
          {chains.map((c) => (
            <tr key={c.chain}>
              <th scope="row">{c.chain}</th>
              <td>{c.branches}</td>
              <td>{c.products.toLocaleString("he-IL")}</td>
              <td>{c.updatedAt ? age(c.updatedAt) : "עוד לא"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        הנתונים נטענים כל בוקר אוטומטית מהקבצים שהרשתות מפרסמות.{" "}
        <a href="https://github.com/orenl833-tlv/supermarket-prices-il">קוד המקור</a>
      </p>
    </details>
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
