import { setPrefs, TEXT_SCALES, usePrefs } from "../prefs.ts";

/** "Aa" menu: text size and the print-in effect. */
export function PrefsMenu() {
  const { textScale, printIn } = usePrefs();
  const index = TEXT_SCALES.indexOf(textScale);
  const step = (by: number) => setPrefs({ textScale: TEXT_SCALES[Math.min(Math.max(index + by, 0), TEXT_SCALES.length - 1)]! });
  return (
    <details className="prefs">
      <summary aria-label="Display settings">Aa</summary>
      <div className="prefs__body">
        <div className="prefs__row">
          <span>Text size</span>
          <button type="button" className="link-button" disabled={index <= 0} onClick={() => step(-1)} aria-label="Smaller text">
            A−
          </button>
          <button type="button" className="link-button" disabled={index >= TEXT_SCALES.length - 1} onClick={() => step(1)} aria-label="Larger text">
            A+
          </button>
        </div>
        <label className="prefs__row">
          <input type="checkbox" checked={printIn} onChange={(e) => setPrefs({ printIn: e.target.checked })} />
          <span>Print text in</span>
        </label>
      </div>
    </details>
  );
}
