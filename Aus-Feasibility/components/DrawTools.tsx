'use client';
import { useCallback, useRef, useState } from 'react';
import { formatArea, formatLength } from '@/lib/geojson';

/** Toolbar for the site drawing tools. Presentational on purpose: it owns no
 *  geometry and imports no Leaflet, so it can be reasoned about (and rendered)
 *  without a map. SiteMap owns the state machine; this owns the buttons and
 *  the import surface.
 *
 *  Mirrors the legacy tool's set — POLYGON / LINE / EDIT / DELETE / CLEAR —
 *  because that is what the surveyors using it already have in their hands. */

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
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [over, setOver] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const readFile = useCallback(async (f: File) => {
    try {
      const t = await f.text();
      onImport(t, f.name);
      setOpen(true);
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
    if (t) { setText(t); onImport(t); setOpen(true); }
  }, [readFile, onImport]);

  const active = mode !== 'none';

  return (
    <div
      className={`draw${over ? ' over' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
    >
      <div className="draw-bar">
        <span className="draw-lbl">Site boundary</span>

        <div className="seg draw-seg">
          {MODES.map((m) => (
            <button key={m.key}
                    onClick={() => onMode(mode === m.key ? 'none' : m.key)}
                    aria-pressed={mode === m.key}
                    // the hint is a title, so name the button explicitly —
                    // otherwise the accessible name becomes the whole sentence
                    aria-label={m.label}
                    title={m.hint}
                    disabled={(m.key === 'edit' || m.key === 'delete') && !hasShape}>
              {m.label}
            </button>
          ))}
        </div>

        {drafting && (
          <>
            <button onClick={onUndo} disabled={!vertices}>Undo point</button>
            <button onClick={onFinish} className="primary" disabled={vertices < (mode === 'line' ? 2 : 3)}>
              Finish
            </button>
          </>
        )}

        <button onClick={onClear} disabled={!hasShape && !drafting}>Clear</button>

        <div className="draw-io">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? 'Hide import' : 'Import GeoJSON'}
          </button>
          <button onClick={onExport} disabled={!hasShape}>Export GeoJSON</button>
        </div>
      </div>

      <div className="draw-read" role="status">
        {areaM2 != null ? (
          <><b>{formatArea(areaM2)}</b>
            <span>{vertices} corner{vertices === 1 ? '' : 's'}{drafting ? ' so far' : ''}</span></>
        ) : lengthM != null ? (
          <><b>{formatLength(lengthM)}</b><span>{vertices} point{vertices === 1 ? '' : 's'}</span></>
        ) : (
          <span className="draw-hint">
            {active
              ? MODES.find((m) => m.key === mode)?.hint
              : 'Draw the boundary, or import one, to measure the site. Areas are geodesic — true ground area, not scaled off the screen.'}
          </span>
        )}
      </div>

      {error && <div className="draw-err">{error}</div>}
      {note && !error && <div className="draw-note">{note}</div>}

      {open && (
        <div className="draw-import">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            placeholder='Paste a Feature, FeatureCollection or bare Polygon geometry — or drop a .geojson file anywhere on this bar. Coordinates must be [lng, lat].'
            aria-label="GeoJSON to import"
          />
          <div className="draw-import-act">
            <button className="primary" onClick={() => onImport(text)} disabled={!text.trim()}>
              Import
            </button>
            <button onClick={() => file.current?.click()}>Choose file…</button>
            <button onClick={() => setText('')} disabled={!text}>Clear box</button>
            <input ref={file} type="file" accept=".json,.geojson,application/geo+json,application/json"
                   hidden
                   onChange={(e) => { const f = e.target.files?.[0]; if (f) void readFile(f); e.target.value = ''; }} />
          </div>
        </div>
      )}
    </div>
  );
}
