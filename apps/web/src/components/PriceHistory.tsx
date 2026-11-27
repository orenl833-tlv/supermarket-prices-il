import { useEffect, useMemo, useRef, useState } from "react";
import { priceHistory, type PriceHistory as History } from "../api";
import { money } from "../format";
import { change, chainSlots, niceTicks, pointAt, priceRange, promoSegments, shortDate, stepPath } from "../history";

const W = 600;
const H = 220;
const M = { top: 12, right: 12, bottom: 26, left: 44 };
const RANGES = [30, 90] as const;

/**
 * A product's price per chain over time: a solid step line for the lowest
 * shelf price in each chain, and a dashed stretch beneath it while a
 * promotion made it cheaper. Hovering shows every chain's price on that day;
 * the same numbers are in the legend and in the table below the chart.
 */
export function PriceHistory({ productId }: { productId: number }) {
  const [days, setDays] = useState<(typeof RANGES)[number]>(90);
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState(false);
  const [hoverT, setHoverT] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    let live = true;
    setError(false);
    priceHistory(productId, days)
      .then((h) => live && setData(h))
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [productId, days]);

  const chart = useMemo(() => {
    if (!data || data.chains.length === 0) return null;
    // Start the axis where the data starts: the tracking began in November 2026.
    const first = Math.min(...data.chains.map((c) => Date.parse(c.points[0]!.at)));
    const start = Math.max(Date.parse(data.since), first);
    const end = Date.parse(data.now);
    const [lo, hi] = priceRange(data.chains);
    const x = (t: number) => M.left + ((t - start) / (end - start || 1)) * (W - M.left - M.right);
    const y = (price: number) => M.top + ((hi - price) / (hi - lo)) * (H - M.top - M.bottom);
    return { start, end, x, y, ticks: niceTicks(lo, hi) };
  }, [data]);

  if (error) return <p className="muted small">לא הצלחנו לטעון את היסטוריית המחיר.</p>;
  if (!data) return <p className="muted small">טוען…</p>;
  if (!chart) return <p className="muted small">אין עדיין נתוני מחיר למוצר הזה.</p>;

  const { start, end, x, y, ticks } = chart;
  const chains = data.chains;
  const slots = chainSlots(chains.map((c) => c.chain));
  const color = (chain: string) => `var(--series-${slots.get(chain)})`;
  const flat = chains.every((c) => c.points.length === 1 && c.points[0]!.best === c.points[0]!.regular);
  const cheapestNow = chains
    .map((c) => ({ chain: c.chain, price: c.points.at(-1)!.best }))
    .sort((a, b) => a.price - b.price)[0]!;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const box = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * W;
    const frac = (px - M.left) / (W - M.left - M.right);
    setHoverT(frac < 0 || frac > 1 ? null : start + frac * (end - start));
  }

  const readout =
    hoverT === null
      ? null
      : chains
          .map((c) => ({ chain: c.chain, point: pointAt(c.points, hoverT) }))
          .filter((r) => r.point)
          .sort((a, b) => a.point!.best - b.point!.best);

  return (
    <div className="history viz">
      <div className="row between wrap">
        <p className="small">
          הזול ביותר היום: <strong>{cheapestNow.chain}</strong> {money(cheapestNow.price)}
          {flat && <span className="muted"> · המחיר לא השתנה מאז {shortDate(start)}</span>}
        </p>
        <div className="segmented" role="radiogroup" aria-label="טווח זמן">
          {RANGES.map((d) => (
            <button key={d} role="radio" aria-checked={days === d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>
              {d} יום
            </button>
          ))}
        </div>
      </div>

      <div className="history-plot" dir="ltr">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={`מחיר ${data.name} לפי רשת, מ־${shortDate(start)} עד היום`}
          onPointerMove={onMove}
          onPointerDown={onMove}
          // A finger lifting also "leaves": on touch the readout stays until the next tap.
          onPointerLeave={(e) => e.pointerType === "mouse" && setHoverT(null)}
        >
          {ticks.map((v) => (
            <g key={v}>
              <line className="grid" x1={M.left} x2={W - M.right} y1={y(v)} y2={y(v)} />
              <text className="axis" x={M.left - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">
                {v}
              </text>
            </g>
          ))}
          <text className="axis" x={M.left} y={H - 8} textAnchor="start">
            {shortDate(start)}
          </text>
          <text className="axis" x={W - M.right} y={H - 8} textAnchor="end">
            היום
          </text>

          {chains.map((c) => (
            <g key={c.chain} style={{ color: color(c.chain) }}>
              {promoSegments(c.points, end).map((s) => (
                <line key={s.from} className="promo-line" x1={x(s.from)} x2={x(s.to)} y1={y(s.price)} y2={y(s.price)} />
              ))}
              <path
                className="price-line"
                d={stepPath(
                  c.points.map((p) => ({ at: p.at, price: p.regular })),
                  x,
                  y,
                  end,
                )}
              />
            </g>
          ))}

          {hoverT !== null && <line className="crosshair" x1={x(hoverT)} x2={x(hoverT)} y1={M.top} y2={H - M.bottom} />}
        </svg>

        {readout && hoverT !== null && (
          <div
            className="history-tip"
            dir="rtl"
            style={{ [x(hoverT) > W / 2 ? "right" : "left"]: `${(Math.min(x(hoverT), W - x(hoverT)) / W) * 100 + 2}%` }}
          >
            <div className="muted small">{shortDate(hoverT)}</div>
            {readout.map(({ chain, point }) => (
              <div key={chain} className="tip-row small">
                <span className="swatch" style={{ background: color(chain) }} /> <strong>{money(point!.best)}</strong> {chain}
                {point!.promotion && <div className="muted">במבצע: {point!.promotion}</div>}
              </div>
            ))}
          </div>
        )}
      </div>

      <ul className="history-legend small">
        {chains.map((c) => {
          const last = c.points.at(-1)!;
          const delta = change(c.points);
          return (
            <li key={c.chain} className="row gap">
              <span className="swatch" style={{ background: color(c.chain) }} />
              {c.chain} <strong>{money(last.regular)}</strong>
              {delta !== 0 && (
                <span className="muted">
                  {" "}
                  (<bdi dir="ltr">{`${delta > 0 ? "+" : "−"}${Math.abs(Math.round(delta * 100))}%`}</bdi>)
                </span>
              )}
              {last.best < last.regular && <span className="muted"> · במבצע {money(last.best)}</span>}
            </li>
          );
        })}
      </ul>
      <p className="muted small">
        קו רציף: המחיר הזול ביותר על המדף בסניפי הרשת בתל אביב. קו מקווקו: המחיר ליחידה במבצע לכל הלקוחות.
      </p>

      <details className="small">
        <summary>הצגה כטבלה</summary>
        <table className="history-table">
          <thead>
            <tr>
              <th>רשת</th>
              <th>מתאריך</th>
              <th>מחיר</th>
              <th>במבצע</th>
            </tr>
          </thead>
          <tbody>
            {chains.flatMap((c) =>
              c.points.map((p) => (
                <tr key={c.chain + p.at}>
                  <td>{c.chain}</td>
                  <td>{shortDate(p.at)}</td>
                  <td>{money(p.regular)}</td>
                  <td>{p.promotion ? `${money(p.best)} (${p.promotion})` : ""}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </details>
    </div>
  );
}
