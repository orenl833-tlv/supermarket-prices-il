export interface Location {
  label: string;
  lat: number;
  lon: number;
}

export interface SearchSettings {
  location: Location;
  radiusKm: number;
  maxStores: 1 | 2;
  extraStopCost: number;
}

export const PLACES: Location[] = [
  { label: "מרכז העיר (דיזנגוף סנטר)", lat: 32.0753, lon: 34.7755 },
  { label: "הצפון הישן (כיכר רבין)", lat: 32.0809, lon: 34.7806 },
  { label: "לב העיר (רוטשילד)", lat: 32.0636, lon: 34.7735 },
  { label: "פלורנטין", lat: 32.0557, lon: 34.7676 },
  { label: "יפו (שעון יפו)", lat: 32.0549, lon: 34.7561 },
  { label: "רמת אביב", lat: 32.1131, lon: 34.7983 },
  { label: "יד אליהו", lat: 32.0607, lon: 34.7931 },
];

export function Settings({
  value,
  onChange,
}: {
  value: SearchSettings;
  onChange: (next: SearchSettings) => void;
}) {
  const set = (patch: Partial<SearchSettings>) => onChange({ ...value, ...patch });
  const isPreset = PLACES.some((p) => p.label === value.location.label);

  function useMyLocation() {
    navigator.geolocation?.getCurrentPosition(
      (pos) => set({ location: { label: "המיקום שלי", lat: pos.coords.latitude, lon: pos.coords.longitude } }),
      () => alert("לא הצלחנו לקבל מיקום. אפשר לבחור אזור מהרשימה."),
      { timeout: 10_000 },
    );
  }

  return (
    <section className="card">
      <h2 className="h2">איפה ואיך קונים</h2>

      <label className="label" htmlFor="place">
        מאיפה יוצאים
      </label>
      <div className="row gap">
        <select
          id="place"
          className="input"
          value={isPreset ? value.location.label : ""}
          onChange={(e) => {
            const place = PLACES.find((p) => p.label === e.target.value);
            if (place) set({ location: place });
          }}
        >
          {!isPreset && <option value="">{value.location.label}</option>}
          {PLACES.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={useMyLocation}>
          המיקום שלי
        </button>
      </div>

      <label className="label" htmlFor="radius">
        מרחק הליכה: עד {value.radiusKm} ק"מ
      </label>
      <input
        id="radius"
        type="range"
        min={0.5}
        max={3}
        step={0.5}
        value={value.radiusKm}
        onChange={(e) => set({ radiusKm: Number(e.target.value) })}
      />

      <label className="check">
        <input
          type="checkbox"
          checked={value.maxStores === 2}
          onChange={(e) => set({ maxStores: e.target.checked ? 2 : 1 })}
        />
        מוכן לעבור בשני סופרים אם זה חוסך מספיק
      </label>
      {value.maxStores === 2 && (
        <>
          <label className="label" htmlFor="stop">
            סופר נוסף שווה לי רק אם הוא חוסך לפחות {value.extraStopCost} ₪
          </label>
          <input
            id="stop"
            type="range"
            min={0}
            max={50}
            step={5}
            value={value.extraStopCost}
            onChange={(e) => set({ extraStopCost: Number(e.target.value) })}
          />
        </>
      )}
    </section>
  );
}
