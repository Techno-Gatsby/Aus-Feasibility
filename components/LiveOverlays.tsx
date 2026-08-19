'use client';
import { OVERLAY_ORDER, OVERLAY_META, type OverlayKey } from '@/lib/overlays';

/** The LIVE OVERLAYS chip row from the single-file build.
 *
 *  Presentational on purpose — it holds no Leaflet, no fetches and no
 *  geometry, so the whole row can be reasoned about (and rendered) without a
 *  map. SiteMap owns the loading state machine; this owns the buttons.
 *
 *  Each chip carries THREE distinct states that must not collapse into one,
 *  because they mean different things to someone assessing a site:
 *    on + data      — the layer is drawn and this is what it found
 *    on + withheld  — asked for, but below the layer's minimum zoom, so it was
 *                     never requested (NOT "nothing here")
 *    on + failed    — the service was asked and did not answer
 *  A silent empty chip would read as a clearance, which is the one reading it
 *  must never give.
 */

export type OverlayStatus = {
  on: boolean;
  busy?: boolean;
  /** Set when the service errored — shown as a red chip and in the tooltip. */
  error?: string | null;
  /** Set when the map is below the layer's minZoom. */
  withheld?: boolean;
  /** Provenance / count once loaded. */
  note?: string | null;
};

export default function LiveOverlays({
  status, zoom, onToggle,
}: {
  status: Record<OverlayKey, OverlayStatus>;
  zoom: number;
  onToggle: (k: OverlayKey) => void;
}) {
  return (
    <div className="ov-row">
      <span className="ov-label">Live overlays</span>
      {OVERLAY_ORDER.map((k) => {
        const st = status[k];
        const meta = OVERLAY_META[k];
        const below = zoom < meta.minZoom;
        const cls = [
          'chip', 'ov-chip',
          st.on ? 'on' : '',
          st.busy ? 'busy' : '',
          st.error ? 'bad' : '',
          st.on && below ? 'held' : '',
        ].filter(Boolean).join(' ');
        const title = st.error
          ? `${meta.source} — ${st.error}`
          : below
            ? `${meta.label} is withheld below zoom ${meta.minZoom} — at wider views the query covers hundreds of kilometres and the shapes mean nothing. ${meta.source}`
            : st.note || meta.source;
        return (
          <button key={k} type="button" className={cls} title={title}
                  aria-pressed={st.on} onClick={() => onToggle(k)}>
            <i style={{ background: meta.swatch }} />
            {meta.label}
            {st.busy ? <em className="ov-tag">…</em>
              : st.error ? <em className="ov-tag bad">failed</em>
              : st.on && below ? <em className="ov-tag">z{meta.minZoom}+</em>
              : null}
          </button>
        );
      })}
    </div>
  );
}
