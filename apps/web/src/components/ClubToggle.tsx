import { useEffect, useRef, useState } from "react";

/**
 * A small tab fixed to the right edge of the page: which chains' clubs the
 * user belongs to. Club deals count only for those chains; for the others the
 * results say what membership would save. Saved on the device with the
 * other settings.
 */
export function ClubToggle({
  chains,
  members,
  onChange,
}: {
  chains: string[];
  members: string[];
  onChange: (members: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  // Close on Escape or a click outside the panel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  if (chains.length === 0) return null;
  const toggle = (chain: string) =>
    onChange(members.includes(chain) ? members.filter((c) => c !== chain) : [...members, chain]);

  return (
    <div className={`club-toggle ${open ? "open" : ""}`} ref={panel}>
      <button
        className="club-tab"
        aria-expanded={open}
        aria-controls="club-panel"
        onClick={() => setOpen(!open)}
        title="כרטיסי מועדון"
      >
        <span aria-hidden="true">🎫</span>
        <span className="club-tab-label">מועדון</span>
        {members.length > 0 && <span className="club-count">{members.length}</span>}
      </button>
      {open && (
        <div className="club-panel" id="club-panel" role="group" aria-label="כרטיסי מועדון">
          <p className="h3">כרטיסי מועדון</p>
          <p className="muted small">מבצעי מועדון נכנסים לחישוב רק ברשתות שמסומנות.</p>
          <ul>
            {chains.map((chain) => (
              <li key={chain}>
                <label className="switch">
                  <input type="checkbox" role="switch" checked={members.includes(chain)} onChange={() => toggle(chain)} />
                  <span className="switch-track" aria-hidden="true" />
                  {chain}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
