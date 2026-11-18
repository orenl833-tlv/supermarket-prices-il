import { useState } from "react";
import { geocodeAddress, reverseGeocode } from "../api";
import { distance } from "../format";
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

  const [status, setStatus] = useState<string | null>(null);
  /** What "my location" resolved to, so the user can check it. */
  const [found, setFound] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [searching, setSearching] = useState(false);

  function useMyLocation() {
    if (!navigator.geolocation) {
      setStatus("הדפדפן לא תומך במיקום. אפשר להקליד כתובת.");
      return;
    }
    setStatus("מאתר מיקום…");
    setFound(null);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude: lat, longitude: lon, accuracy } = pos.coords;
        const near = isNearTelAviv({ lat, lon });
        setStatus(near ? null : "המיקום שלך רחוק מתל אביב, ולכן לא יימצאו סופרים קרובים.");
        const accuracyNote =
          accuracy > 300
            ? ` · דיוק נמוך (כ-${Math.round(accuracy)} מ'), אם הכתובת לא נכונה כדאי להקליד אותה`
            : ` · דיוק של כ-${Math.round(accuracy)} מ'`;
        let address: string | null = null;
        try {
          address = await reverseGeocode(lat, lon);
        } catch {
          /* the coordinates are still usable without a street name */
        }
        set({ location: { label: address ? `המיקום שלי: ${address}` : "המיקום שלי", lat, lon } });
        setFound(`${address ? `זוהתה הכתובת ${address}` : "המיקום התקבל, אבל לא מצאנו לו כתובת"}${accuracyNote}`);
      },
      (err) => setStatus(LOCATION_ERRORS[err.code] ?? LOCATION_ERRORS[0]!),
      // A location from the last 10 minutes is fine; desktops without GPS can be slow.
      { timeout: 20_000, maximumAge: 600_000 },
    );
  }

  async function searchAddress(e: React.FormEvent) {
    e.preventDefault();
    if (address.trim().length < 2) return;
    setSearching(true);
    setStatus(null);
    try {
      const place = await geocodeAddress(address.trim());
      if (place) {
        set({ location: place });
        setFound(null);
      }
      else setStatus("לא מצאנו את הכתובת בתל אביב. נסו רחוב ומספר, למשל: דיזנגוף 50.");
    } catch {
      setStatus("חיפוש הכתובת לא זמין כרגע. אפשר לבחור אזור מהרשימה.");
    } finally {
      setSearching(false);
    }
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
            if (place) {
        set({ location: place });
        setFound(null);
      }
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
      <form className="row gap address" onSubmit={searchAddress}>
        <input
          className="input"
          type="search"
          aria-label="כתובת יציאה"
          placeholder="או כתובת, למשל: דיזנגוף 50"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
        <button className="secondary" type="submit" disabled={searching}>
          {searching ? "מחפש…" : "חיפוש"}
        </button>
      </form>
      {found && (
        <p className="note small" role="status">
          {found}
        </p>
      )}
      {status && (
        <p className="warn small" role="status">
          {status}
        </p>
      )}

      <label className="label" htmlFor="radius">
        מרחק בקו אווירי: עד {distance(value.radiusKm)}
      </label>
      <input
        id="radius"
        type="range"
        min={0.2}
        max={3}
        step={0.1}
        value={value.radiusKm}
        onChange={(e) => set({ radiusKm: Math.round(Number(e.target.value) * 10) / 10 })}
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
            step={1}
            value={value.extraStopCost}
            onChange={(e) => set({ extraStopCost: Number(e.target.value) })}
          />
        </>
      )}
    </section>
  );
}

/** Why the browser gave no location, by GeolocationPositionError code. */
const LOCATION_ERRORS: Record<number, string> = {
  0: "לא הצלחנו לקבל מיקום. אפשר להקליד כתובת או לבחור אזור מהרשימה.",
  1: "הגישה למיקום חסומה בדפדפן. אפשר לאשר אותה בסמל המנעול שליד כתובת האתר, או להקליד כתובת.",
  2: "המכשיר לא מצליח לאתר מיקום (במחשב: בדקו ששירותי המיקום של Windows פועלים). אפשר להקליד כתובת.",
  3: "איתור המיקום לקח יותר מדי זמן. נסו שוב או הקלידו כתובת.",
};

/** Roughly within 15 km of central Tel Aviv: beyond that no branch is in walking range. */
function isNearTelAviv(p: { lat: number; lon: number }): boolean {
  const dLat = (p.lat - 32.08) * 111;
  const dLon = (p.lon - 34.78) * 94;
  return Math.hypot(dLat, dLon) < 15;
}
