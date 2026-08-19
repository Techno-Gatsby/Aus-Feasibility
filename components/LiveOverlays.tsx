'use client';
import { OVERLAY_ORDER, OVERLAY_META, type OverlayKey } from '@/lib/overlays';
import { Menu } from '@/components/MapControls';

/** The LIVE OVERLAYS chip row from the single-file build.
 *
 *  Presentational on purpose — it holds no Leaflet, no fetches and no
 *  geometry, so the whole row can be reasoned about (and rendered) without a
 *  map. SiteMap owns the loading state machine; this owns the buttons.
 *
 *  All seven chips used to sit on the bar at once and wrapped onto two lines
 *  at most window widths. Now only the chips that are actually SAYING
 *  something stay out — the ones that are on, and the ones that failed — and
 *  the rest live behind an "Add layer" menu with a count. A failed chip can
 *  never be the one that got folded away, because that is precisely the
 *  reading that must not be lost.
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
  // Out on the bar: anything on, anything loading, anything that failed.
  // Behind the menu: the layers that are simply not switched on.
  const shown = OVERLAY_ORDER.filter(
    (k) => status[k].on || status[k].busy || status[k].error,
  );
  const hidden = OVERLAY_ORDER.filter((k) => !shown.includes(k));
  const failed = OVERLAY_ORDER.filter((k) => status[k].error).length;

  return (
    <div className="ov-row">
      <span className="ov-label">Live overlays</span>

      {shown.map((k) => <Chip key={k} k={k} st={status[k]} zoom={zoom} onToggle={onToggle} />)}

      {shown.length === 0 && (
        <span className="ov-none">none on — the basemap only</span>
      )}

      <Menu label={`Add layer${hidden.length ? ` (${hidden.length})` : ''}`}
            disabled={hidden.length === 0}
            title="The overlays that are not switched on">
        {hidden.map((k) => {
          const meta = OVERLAY_META[k];
          return (
            <button key={k} type="button" className="menu-item" onClick={() => onToggle(k)}>
              <span className="menu-swatch" style={{ background: meta.swatch }} aria-hidden="true" />
              {meta.label}
              <em>{meta.source} · drawn from zoom {meta.minZoom}</em>
            </button>
          );
        })}
      </Menu>

      {failed > 0 && (
        <span className="ov-failed" title="A layer that did not answer proves nothing either way">
          ⚠ {failed} did not answer
        </span>
      )}
    </div>
  );
}

function Chip({ k, st, zoom, onToggle }: {
  k: OverlayKey; st: OverlayStatus; zoom: number; onToggle: (k: OverlayKey) => void;
}) {
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
    <button type="button" className={cls} title={title}
            aria-pressed={st.on} onClick={() => onToggle(k)}>
      <i style={{ background: meta.swatch }} />
      {meta.label}
      {st.busy ? <em className="ov-tag">…</em>
        : st.error ? <em className="ov-tag bad">⚠ failed</em>
        : st.on && below ? <em className="ov-tag">z{meta.minZoom}+</em>
        : null}
    </button>
  );
}
