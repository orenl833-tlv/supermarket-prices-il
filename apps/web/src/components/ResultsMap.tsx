import "leaflet/dist/leaflet.css";
import { useEffect, useRef } from "react";
import type { Plan } from "../api";

/**
 * A small map of the starting point and the stores in the results: the
 * recommended plan's stores stand out, the others are quieter. Leaflet is
 * loaded only when results are shown, so the first page stays light.
 * Circle markers avoid Leaflet's default image icons, which bundlers break.
 */
export function ResultsMap({ origin, plans }: { origin: { lat: number; lon: number }; plans: Plan[] }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let disposed = false;
    let map: import("leaflet").Map | undefined;

    import("leaflet").then((L) => {
      if (disposed || !container.current) return;
      map = L.map(container.current, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);

      const accent = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0f766e";
      const points: Array<[number, number]> = [[origin.lat, origin.lon]];

      L.circleMarker([origin.lat, origin.lon], { radius: 7, color: "#1d4ed8", fillColor: "#3b82f6", fillOpacity: 1, weight: 2 })
        .bindTooltip("נקודת היציאה", { direction: "top" })
        .addTo(map);

      // Draw other plans first so the recommended stores sit on top.
      const seen = new Set<number>();
      [...plans].reverse().forEach((plan, reversedIndex) => {
        const isBest = reversedIndex === plans.length - 1;
        for (const { store } of plan.stops) {
          if (seen.has(store.id) && !isBest) continue;
          seen.add(store.id);
          points.push([store.lat, store.lon]);
          L.circleMarker([store.lat, store.lon], {
            radius: isBest ? 9 : 6,
            color: isBest ? accent : "#64748b",
            fillColor: isBest ? accent : "#94a3b8",
            fillOpacity: isBest ? 0.9 : 0.6,
            weight: 2,
          })
            .bindTooltip(`${store.chain} ${store.name}`, { direction: "top", permanent: isBest })
            .addTo(map!);
        }
      });

      map.fitBounds(L.latLngBounds(points), { padding: [28, 28], maxZoom: 16 });
    });

    return () => {
      disposed = true;
      map?.remove();
    };
  }, [origin.lat, origin.lon, plans]);

  // dir="ltr": Leaflet's controls are laid out for left-to-right pages.
  return <div ref={container} className="results-map" dir="ltr" role="img" aria-label="מפת הסניפים בתוצאות" />;
}
