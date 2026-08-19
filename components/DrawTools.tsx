'use client';
import { useCallback, useRef, useState } from 'react';
import { formatArea, formatLength } from '@/lib/geojson';
import { Menu } from '@/components/MapControls';

/** Toolbar for the site drawing tools. Presentational on purpose: it owns no
 *  geometry and imports no Leaflet, so it can be reasoned about (and rendered)
 *  without a map. SiteMap owns the state machine; this owns the buttons.
 *
 *  Mirrors the legacy tool's set — POLYGON / LINE / EDIT / DELETE / CLEAR —
 *  because that is what the surveyors using it already have in their hands.
 *  The difference is that the four modes now live together inside one "Draw"
 *  menu instead of spreading across the bar, and the GeoJSON import textarea
 *  opens over the map rather than adding a fifth row above it. Whatever is
 *  needed WHILE drawing — the active mode, Undo, Finish, Clear and the live
 *  measurement — stays on the bar, because that is the moment you need it.
 */

export type DrawMode = 'none' | 'polygon' | 'line' | 'edit' | 'delete';

const MODES: { key: DrawMode; label: string; hint: string }[] = [
  { key: 'polygon', label: 'Polygon', hint: 'Click each corner. Double-click, or click the first corner, to close.' },
  { key: 'line',    label: 'Line',    hint: 'Click along the line to measure a distance. Double-click to finish.' },
  { key: 'edit',    label: 'Edit',    hint: 'Drag any corner to move it.' },
  { key: 'delete',  label: 'Delete',  hint: 'Click a corner to remove it. A polygon keeps at least three.' },
];

export default function DrawTools({
  mode, onMode, areaM2, lengthM, vertices, drafting, hasShape,
  onUndo, onFinish, onClear, onImport, onExport, note, error,
}: {
  mode: DrawMode;
  onMode: (m: DrawMode) => void;
  areaM2: number | null;
  lengthM: number | null;
  vertices: number;
  drafting: boolean;
  hasShape: boolean;
  onUndo: () => void;
  onFinish: () => void;
  onClear: () => void;
  onImport: (text: string, sourceName?: string) => void;
  onExport: () => void;
  note: string | null;
  error: string | null;
}) {
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const readFile = useCallback(async (f: File) => {
    try {
      const t = await f.text();
      onImport(t, f.name);
    } catch (e) {
      onImport('', f.name);        // surfaces as a parse error upstream
      console.error(e);
    }
  }, [onImport]);

  const drop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f) { void readFile(f); return; }
    const t = e.dataTransfer.getData('text');
    if (t) { setText(t); onImport(t); }
  }, [readFile, onImport]);

  const active = MODES.find((m) => m.key === mode) ?? null;

  const readout =
    areaM2 != null
      ? { v: formatArea(areaM2), s: `${vertices} corner${vertices === 1 ? '' : 's'}${drafting ? ' so far' : ''}` }
      : lengthM != null
        ? { v: formatLength(lengthM), s: `${vertices} point${vertices === 1 ? '' : 's'}` }
        : null;

  const hint = active
    ? active.hint
    : 'Areas are geodesic — true ground area, not scaled off the screen.';

  return (
    <div
      className={`draw${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="draw-bar">
        <span className="draw-lbl">Site boundary</span>

        <Menu label={active ? active.label : 'Draw'}
              title="Polygon, line, edit and delete — the four drawing modes">
          {MODES.map((m) => (
            <button key={m.key} type="button"
                    className={`menu-item${mode === m.key ? ' on' : ''}`}
                    aria-pressed={mode === m.key}
                    onClick={() => onMode(mode === m.key ? 'none' : m.key)}
                    disabled={(m.key === 'edit' || m.key === 'delete') && !hasShape}>
              {m.label}
              <em>{(m.key === 'edit' || m.key === 'delete') && !hasShape
                ? 'Draw or import a boundary first'
                : m.hint}</em>
            </button>
          ))}
          <button type="button" className="menu-item warn" onClick={() => onMode('none')}
                  disabled={mode === 'none'}>
            Stop drawing
            <em>Clicking the map goes back to analysing the point under it</em>
          </button>
        </Menu>

        {active && (
          <span className="draw-mode" title={active.hint}>
            <i aria-hidden="true">✎</i>{active.label}
          </span>
        )}

        {drafting && (
          <>
            <button type="button" className="mc-btn" onClick={onUndo} disabled={!vertices}>
              Undo point
            </button>
            <button type="button" className="mc-btn primary" onClick={onFinish}
                    disabled={vertices < (mode === 'line' ? 2 : 3)}>
              Finish
            </button>
          </>
        )}

        <button type="button" className="mc-btn" onClick={onClear} disabled={!hasShape && !drafting}>
          Clear
        </button>

        <span className="draw-live" role="status" title={readout ? undefined : hint}>
          {readout
            ? <><b>{readout.v}</b><span>{readout.s}</span></>
            : <span className="draw-hint">{hint}</span>}
        </span>

        <Menu label="GeoJSON" align="right" title="Import or export the site boundary">
          <div className="draw-import">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
              placeholder='Paste a Feature, FeatureCollection or bare Polygon geometry — or drop a .geojson file anywhere on this bar. Coordinates must be [lng, lat].'
              aria-label="GeoJSON to import"
            />
            <div className="draw-import-act">
              <button type="button" className="mc-btn primary"
                      onClick={() => onImport(text)} disabled={!text.trim()}>
                Import
              </button>
              <button type="button" className="mc-btn" onClick={() => file.current?.click()}>
                Choose file…
              </button>
              <button type="button" className="mc-btn" onClick={() => setText('')} disabled={!text}>
                Clear box
              </button>
              <button type="button" className="mc-btn" onClick={onExport} disabled={!hasShape}>
                Export
              </button>
              <input ref={file} type="file"
                     accept=".json,.geojson,application/geo+json,application/json" hidden
                     onChange={(e) => {
                       const f = e.target.files?.[0];
                       if (f) void readFile(f);
                       e.target.value = '';
                     }} />
            </div>
          </div>
        </Menu>
      </div>

      {/* Both stay on their own line: a parse failure and a provenance note
          are the two things a person must not have to hover to read. */}
      {error && <div className="draw-err">⚠ {error}</div>}
      {note && !error && <div className="draw-note">{note}</div>}
    </div>
  );
}
