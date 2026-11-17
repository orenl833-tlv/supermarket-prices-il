/**
 * Decorative vegetables, drawn only in shades of yellow (the --veg-* colours),
 * so they suit the mustard theme in light and dark mode. Purely decorative:
 * hidden from screen readers.
 */
type Veg = "corn" | "pepper" | "squash" | "potato" | "onion" | "tomato";

const V = {
  light: "var(--veg-light)",
  mid: "var(--veg-mid)",
  main: "var(--veg-main)",
  deep: "var(--veg-deep)",
  dark: "var(--veg-dark)",
};

function Shape({ kind }: { kind: Veg }) {
  switch (kind) {
    case "corn":
      return (
        <>
          <path d="M32 58c-9-6-14-18-12-30 6 6 9 14 12 30z" fill={V.deep} />
          <path d="M32 58c9-6 14-18 12-30-6 6-9 14-12 30z" fill={V.dark} />
          <ellipse cx="32" cy="27" rx="9" ry="21" fill={V.mid} />
          {[12, 18, 24, 30, 36, 42].map((y) =>
            [27, 32, 37].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="2.1" fill={V.light} />),
          )}
        </>
      );
    case "pepper":
      return (
        <>
          <path d="M32 14c4-6 9-6 11-4-4 0-7 2-8 6z" fill={V.dark} />
          <path
            d="M18 26c0-8 7-11 14-9 7-2 14 1 14 9 0 12-4 26-9 28-2 1-3-2-5-2s-3 3-5 2c-5-2-9-16-9-28z"
            fill={V.main}
          />
          <path d="M23 26c0-4 3-6 6-5-2 4-3 12-2 20-3-4-4-10-4-15z" fill={V.light} />
          <path d="M32 18c-1 10-1 22 0 34" stroke={V.deep} strokeWidth="2" fill="none" />
        </>
      );
    case "squash":
      return (
        <>
          <path
            d="M44 10c3 4 2 10-2 14-5 6-3 13-6 21-3 9-15 11-20 5-5-6 0-15 8-18 7-3 9-9 11-15 2-5 6-9 9-7z"
            fill={V.mid}
          />
          <path d="M44 10c1-3 4-5 7-4" stroke={V.dark} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path d="M22 40c4-3 8-4 12-3" stroke={V.light} strokeWidth="3" strokeLinecap="round" fill="none" />
        </>
      );
    case "potato":
      return (
        <>
          <path d="M14 34c-2-12 8-20 20-20 11 0 18 7 17 17-1 12-11 19-22 18-9-1-14-7-15-15z" fill={V.light} />
          <path d="M14 34c-2-12 8-20 20-20" stroke={V.deep} strokeWidth="2" fill="none" opacity="0.5" />
          {[
            [26, 26],
            [38, 24],
            [33, 37],
            [22, 40],
            [42, 36],
          ].map(([x, y]) => (
            <ellipse key={`${x}-${y}`} cx={x} cy={y} rx="2" ry="1.3" fill={V.deep} />
          ))}
        </>
      );
    case "onion":
      return (
        <>
          <path d="M32 6c2 5 1 9 0 12-1-3-2-7 0-12z" fill={V.deep} />
          <path d="M32 16c13 4 19 14 15 26-3 9-10 13-15 13s-12-4-15-13c-4-12 2-22 15-26z" fill={V.main} />
          <path d="M32 18c-5 8-7 22-2 36M32 18c5 8 7 22 2 36" stroke={V.deep} strokeWidth="1.8" fill="none" />
          <path d="M27 56c2 3 8 3 10 0" stroke={V.dark} strokeWidth="2" strokeLinecap="round" fill="none" />
        </>
      );
    case "tomato":
      return (
        <>
          <circle cx="32" cy="36" r="18" fill={V.mid} />
          <path d="M22 30c2-6 7-9 12-9" stroke={V.light} strokeWidth="3" strokeLinecap="round" fill="none" />
          <path
            d="M32 20l-6-4 3 7-8 1 7 3m4-7l6-4-3 7 8 1-7 3M32 20v-7"
            stroke={V.dark}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            fill="none"
          />
        </>
      );
  }
}

export function Vegetable({ kind, size = 48, className }: { kind: Veg; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true" focusable="false">
      <Shape kind={kind} />
    </svg>
  );
}

/** A row of vegetables for the page header. */
export function VeggieRow() {
  const row: Veg[] = ["corn", "pepper", "onion", "squash", "tomato", "potato"];
  return (
    <div className="veggie-row" aria-hidden="true">
      {row.map((kind, i) => (
        <Vegetable key={kind} kind={kind} size={i % 2 ? 50 : 60} className={`veg veg-${i}`} />
      ))}
    </div>
  );
}
