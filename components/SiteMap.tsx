'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type * as L from 'leaflet';
import { BASEMAPS, LAYER_STYLE, DEFAULT_VIS, type LayerVis, type BasemapKey } from '@/lib/mapStyle';
import { inAustralia } from '@/lib/geo';
import DrawTools, { type DrawMode } from '@/components/DrawTools';
import {
  importGeoJSON, featureToString, polygonAreaM2, pathLengthM,
  formatArea, formatLength, type LatLng, type Ring, type Rings,
} from '@/lib/geojson';

/** Rebuilt on the architecture the US build proved out.
 *
 *  The first attempt drew NOTHING — a satellite tile with a search box — so
 *  the hazard answers lived only in a side panel and the map was decoration.
 *  This draws every layer as real geometry on the parcel, which is the whole
 *  point of a site map.
 *
 *  Two carried-over lessons from the US build:
 *   - The subject lot is CASED: a dark halo underneath, a bright amber line
 *     on top, so it reads on pale tiles and dark aerial alike.
 *   - The container is sized by flex AFTER Leaflet initialises, so its cached
 *     dimensions are stale: tiles come up blank and fitBounds lands on the
 *     wrong zoom. invalidateSize() before every fit.
 *
 *  DRAWING (restored from the legacy tool: polygon / line / edit / delete /
 *  clear, plus GeoJSON in and out). The drawn site lives in its OWN layer
 *  group, deliberately not in `groups`, because the layer-draw effect clears
 *  every group in there whenever `shapes` changes — a drawn boundary has to
 *  survive a re-query. It is cased like the subject lot but drawn in cyan,
 *  never amber: a hand-drawn boundary is not cadastre and must not look like
 *  it. Every area figure comes from lib/geojson.ts and is geodesic.
 */

export type SiteShapes = Record<string, [number, number][][][]>;

/** Cyan reads on both pale street tiles and dark aerial, and cannot be
 *  confused with the amber subject lot or the blue flood layer. */
const DRAW_COLOR = '#22d3ee';

export default function SiteMap({
  onPick, shapes, center, onShape,
}: {
  onPick?: (p: { lat: number; lng: number }) => void;
  shapes?: SiteShapes | null;
  center?: { lat: number; lng: number } | null;
  /** Fires whenever the drawn site changes. Rings are Leaflet order
   *  ([lat, lng], outer ring first then holes) and the area is geodesic m².
   *  Null when there is no drawn site. The page decides what to do with it —
   *  wiring this into the model from here would couple the map to the engine. */
  onShape?: (rings: [number, number][][] | null, areaM2: number | null) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const Lref = useRef<typeof L | null>(null);
  const groups = useRef<Record<string, L.LayerGroup>>({});
  const tile = useRef<L.TileLayer | null>(null);
  const [ready, setReady] = useState(false);
  const [base, setBase] = useState<BasemapKey>('satellite');
  const [vis, setVis] = useState<LayerVis>(DEFAULT_VIS);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // ── drawing state ────────────────────────────────────────────────────────
  const draw = useRef<L.LayerGroup | null>(null);     // NOT part of `groups`
  const band = useRef<L.Polyline | null>(null);       // rubber band to cursor
  const [mode, setMode] = useState<DrawMode>('none');
  const [draft, setDraft] = useState<Ring>([]);       // vertices being placed
  const [rings, setRings] = useState<Rings | null>(null);
  const [line, setLine] = useState<Ring | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Leaflet handlers are registered once, so they read live values through
  // refs rather than closing over the first render's state.
  const modeRef = useRef(mode);
  const draftRef = useRef(draft);
  const ringsRef = useRef(rings);
  const onPickRef = useRef(onPick);
  const onShapeRef = useRef(onShape);
  const finishRef = useRef<() => void>(() => {});
  /** A click on a vertex marker reaches the map handler too. Marker handlers
   *  stamp this and the map handler ignores anything inside the window. */
  const swallow = useRef(0);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { ringsRef.current = rings; }, [rings]);
  useEffect(() => { onPickRef.current = onPick; onShapeRef.current = onShape; });

  const drafting = mode === 'polygon' || mode === 'line';

  const addVertex = useCallback((lat: number, lng: number) => {
    setDraft((d) => {
      const last = d[d.length - 1];
      // The second click of a double-click lands on the same pixel, so it
      // arrives as an identical latlng. Drop it, otherwise every closed
      // polygon carries a duplicate corner that looks broken in edit mode.
      if (last && Math.abs(last[0] - lat) < 1e-12 && Math.abs(last[1] - lng) < 1e-12) return d;
      return [...d, [lat, lng] as LatLng];
    });
  }, []);

  const finish = useCallback(() => {
    const d = draftRef.current;
    const md = modeRef.current;
    if (md === 'line') {
      if (d.length < 2) return;
      setLine(d);
      setDraft([]); setMode('none');
      setNote(`Measured ${formatLength(pathLengthM(d))} over ${d.length} points.`);
      return;
    }
    if (md !== 'polygon' || d.length < 3) return;
    setRings([d]);
    setDraft([]); setMode('none'); setErr(null);
    setNote(`Site drawn — ${formatArea(polygonAreaM2([d]))}. Use Edit to nudge a corner.`);
  }, []);
  useEffect(() => { finishRef.current = finish; });

  // init
  useEffect(() => {
    let dead = false;
    (async () => {
      const leaflet = (await import('leaflet')).default ?? (await import('leaflet'));
      if (dead || !host.current || map.current) return;
      Lref.current = leaflet as unknown as typeof L;
      const m = leaflet.map(host.current, {
        center: [-33.8688, 151.2093], zoom: 12, zoomControl: true,
      });
      tile.current = leaflet.tileLayer(BASEMAPS.satellite.url, {
        attribution: BASEMAPS.satellite.attribution, maxZoom: BASEMAPS.satellite.max,
      }).addTo(m);
      (Object.keys(LAYER_STYLE) as (keyof LayerVis)[]).forEach((k) => {
        groups.current[k] = leaflet.layerGroup().addTo(m);
      });
      // drawn geometry sits above every data layer
      draw.current = leaflet.layerGroup().addTo(m);

      m.on('click', (e: any) => {
        if (Date.now() - swallow.current < 350) return;      // a vertex handled it
        const md = modeRef.current;
        if (md === 'polygon' || md === 'line') { addVertex(e.latlng.lat, e.latlng.lng); return; }
        if (md === 'edit' || md === 'delete') return;        // don't re-analyse mid-edit
        onPickRef.current?.({ lat: e.latlng.lat, lng: e.latlng.lng });
      });
      m.on('mousemove', (e: any) => {
        const b = band.current, d = draftRef.current;
        if (!b || !d.length) return;
        b.setLatLngs([d[d.length - 1], [e.latlng.lat, e.latlng.lng]] as any);
      });
      m.on('dblclick', () => {
        const md = modeRef.current;
        if (md === 'polygon' || md === 'line') finishRef.current();
      });

      map.current = m;
      setReady(true);
      setTimeout(() => m.invalidateSize(), 60);
    })();
    return () => { dead = true; map.current?.remove(); map.current = null; };
  }, [addVertex]);

  // double-click must place-and-close, not zoom, while a shape is being drawn
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    if (drafting) m.doubleClickZoom.disable(); else m.doubleClickZoom.enable();
  }, [drafting, ready]);

  // Esc cancels the shape in progress, Enter closes it
  useEffect(() => {
    if (!drafting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDraft([]); setMode('none'); }
      else if (e.key === 'Enter') finishRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drafting]);

  // basemap switch
  useEffect(() => {
    const m = map.current, leaflet = Lref.current;
    if (!m || !leaflet || !tile.current) return;
    tile.current.remove();
    const b = BASEMAPS[base];
    tile.current = leaflet.tileLayer(b.url, { attribution: b.attribution, maxZoom: b.max }).addTo(m);
    tile.current.bringToBack();
  }, [base]);

  // draw
  useEffect(() => {
    const m = map.current, leaflet = Lref.current;
    if (!m || !leaflet || !ready) return;
    Object.values(groups.current).forEach((g) => g.clearLayers());
    if (!shapes) return;

    (Object.keys(LAYER_STYLE) as (keyof LayerVis)[]).forEach((key) => {
      if (!vis[key]) return;
      const st = LAYER_STYLE[key];
      const polys = shapes[key] ?? [];
      polys.forEach((rings) => {
        if (!rings?.length) return;
        if (key === 'parcel') {
          // cased: halo first, then the bright line on top
          leaflet.polygon(rings as any, {
            color: '#1c1917', weight: 5, opacity: 0.55, fill: false,
          }).addTo(groups.current[key]);
        }
        leaflet.polygon(rings as any, {
          color: st.color, weight: key === 'parcel' ? 2.5 : 1.5,
          opacity: 1, fillColor: st.color, fillOpacity: st.fill,
        }).addTo(groups.current[key]);
      });
    });

    const parcel = shapes.parcel?.[0];
    if (parcel?.length) {
      m.invalidateSize();                      // flex sizing lands after init
      m.fitBounds(leaflet.polygon(parcel as any).getBounds(), { padding: [40, 40], maxZoom: 18 });
    } else if (center) {
      m.setView([center.lat, center.lng], 17);
    }
  }, [shapes, vis, ready, center]);

  // ── render the drawn geometry ────────────────────────────────────────────
  useEffect(() => {
    const m = map.current, leaflet = Lref.current, g = draw.current;
    if (!m || !leaflet || !g || !ready) return;
    g.clearLayers();
    band.current = null;

    // committed site: cased the same way as the subject lot
    if (rings?.length) {
      const halo = leaflet.polygon(rings as any, {
        color: '#1c1917', weight: 6, opacity: 0.5, fill: false, interactive: false,
      }).addTo(g);
      const poly = leaflet.polygon(rings as any, {
        color: DRAW_COLOR, weight: 2.5, opacity: 1,
        fillColor: DRAW_COLOR, fillOpacity: 0.14, interactive: false,
      }).addTo(g);
      poly.bindTooltip(formatArea(polygonAreaM2(rings)), {
        permanent: true, direction: 'center', className: 'area-tip',
      });

      if (mode === 'edit' || mode === 'delete') {
        // a live copy so a drag repaints at pointer speed without a React
        // round-trip; state is only written on dragend
        let live: Rings = rings.map((r) => r.slice());
        rings.forEach((ring, ri) => ring.forEach((pt, pi) => {
          if (mode === 'edit') {
            const mk = leaflet.marker(pt as any, {
              draggable: true, keyboard: false,
              icon: leaflet.divIcon({ className: 'vtx', iconSize: [14, 14], iconAnchor: [7, 7] }),
            }).addTo(g);
            mk.on('dragstart', () => { live = (ringsRef.current ?? rings).map((r) => r.slice()); });
            mk.on('drag', (ev: any) => {
              const ll = ev.target.getLatLng();
              live[ri][pi] = [ll.lat, ll.lng];
              halo.setLatLngs(live as any);
              poly.setLatLngs(live as any);
              poly.setTooltipContent(formatArea(polygonAreaM2(live)));
            });
            mk.on('dragend', () => {
              swallow.current = Date.now();
              const next = live.map((r) => r.slice());
              setRings(next);
              // the "Site drawn — …" note would otherwise still quote the
              // area from before the drag, next to a shape that has changed
              setNote(`Corner moved — ${formatArea(polygonAreaM2(next))}.`);
            });
          } else {
            const cm = leaflet.circleMarker(pt as any, {
              radius: 6, color: '#1c1917', weight: 1.5,
              fillColor: '#ef4444', fillOpacity: 1, className: 'vtx-del',
            }).addTo(g);
            cm.bindTooltip('Remove this corner');
            cm.on('click', () => {
              swallow.current = Date.now();
              const cur = ringsRef.current;
              if (!cur) return;
              if (cur[ri].length <= 3) {
                setErr('A polygon needs at least three corners — use Clear to remove it entirely.');
                return;
              }
              setErr(null);
              const next = cur.map((r, i) => (i === ri ? r.filter((_, j) => j !== pi) : r.slice()));
              setRings(next);
              setNote(`Corner removed — ${formatArea(polygonAreaM2(next))}.`);
            });
          }
        }));
      }
    }

    // committed measure line
    if (line?.length) {
      leaflet.polyline(line as any, { color: '#1c1917', weight: 6, opacity: 0.45, interactive: false }).addTo(g);
      const pl = leaflet.polyline(line as any, {
        color: DRAW_COLOR, weight: 2.5, dashArray: '8 5', interactive: false,
      }).addTo(g);
      pl.bindTooltip(formatLength(pathLengthM(line)), {
        permanent: true, direction: 'center', className: 'area-tip',
      });
      line.forEach((pt) => leaflet.circleMarker(pt as any, {
        radius: 4, color: '#1c1917', weight: 1.5, fillColor: '#fff', fillOpacity: 1, interactive: false,
      }).addTo(g));
    }

    // the shape in progress
    if (draft.length) {
      if (draft.length > 1) {
        leaflet.polyline(draft as any, { color: '#1c1917', weight: 5, opacity: 0.45, interactive: false }).addTo(g);
        leaflet.polyline(draft as any, { color: DRAW_COLOR, weight: 2.5, dashArray: '6 5', interactive: false }).addTo(g);
      }
      if (mode === 'polygon' && draft.length >= 3) {
        leaflet.polygon(draft as any, {
          color: DRAW_COLOR, weight: 0, fillColor: DRAW_COLOR, fillOpacity: 0.1, interactive: false,
        }).addTo(g);
        leaflet.polyline([draft[draft.length - 1], draft[0]] as any, {
          color: DRAW_COLOR, weight: 1.5, dashArray: '3 6', opacity: 0.75, interactive: false,
        }).addTo(g);
      }
      if (drafting) {
        band.current = leaflet.polyline([draft[draft.length - 1], draft[draft.length - 1]] as any, {
          color: DRAW_COLOR, weight: 1.5, dashArray: '4 6', opacity: 0.8, interactive: false,
        }).addTo(g);
      }
      draft.forEach((pt, i) => {
        const first = i === 0;
        const closable = first && mode === 'polygon' && draft.length >= 3;
        const cm = leaflet.circleMarker(pt as any, {
          radius: first ? 7 : 5, color: '#1c1917', weight: 1.5,
          fillColor: first ? DRAW_COLOR : '#fff', fillOpacity: 1,
          interactive: closable, className: closable ? 'vtx-close' : undefined,
        }).addTo(g);
        if (closable) {
          cm.bindTooltip('Click to close the boundary');
          cm.on('click', () => { swallow.current = Date.now(); finishRef.current(); });
        }
      });
    }
  }, [rings, draft, line, mode, ready, drafting]);

  // hand the drawn site upward
  useEffect(() => {
    onShapeRef.current?.(rings, rings ? polygonAreaM2(rings) : null);
  }, [rings]);

  const doImport = useCallback((text: string, sourceName?: string) => {
    const res = importGeoJSON(text);
    if (!res.ok) {
      setErr(sourceName ? `${sourceName} — ${res.error}` : res.error);
      setNote(null);
      return;
    }
    setErr(null);
    setRings(res.rings);
    setDraft([]); setLine(null); setMode('none');

    const m = map.current, leaflet = Lref.current;
    if (m && leaflet) {
      m.invalidateSize();                       // same stale-size trap as the parcel fit
      m.fitBounds(leaflet.polygon(res.rings as any).getBounds(), { padding: [40, 40], maxZoom: 18 });
    }
    const [lat, lng] = res.rings[0][0];
    setNote([
      sourceName ? `Imported ${sourceName}` : 'Imported',
      res.name ? `“${res.name}”` : null,
      `— ${formatArea(res.areaM2)}, ${res.rings[0].length} corners.`,
      res.note,
      inAustralia({ lat, lng }) ? null : 'Note: this boundary is outside Australia.',
    ].filter(Boolean).join(' '));
  }, []);

  const doExport = useCallback(() => {
    const r = ringsRef.current;
    if (!r) return;
    const text = featureToString(r, { name: 'Drawn site' });
    const url = URL.createObjectURL(new Blob([text], { type: 'application/geo+json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `site-${new Date().toISOString().slice(0, 10)}.geojson`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    setErr(null);
    setNote(`Exported ${a.download} — ${formatArea(polygonAreaM2(r))}.`);
  }, []);

  const clearDrawn = useCallback(() => {
    setDraft([]); setRings(null); setLine(null); setMode('none');
    setErr(null); setNote(null);
  }, []);

  const changeMode = useCallback((next: DrawMode) => {
    setErr(null);
    setDraft([]);                     // never carry a half-drawn shape across modes
    setMode(next);
  }, []);

  const search = useCallback(async () => {
    const m = map.current;
    if (!m || !ready) { setMsg('Map is still loading.'); return; }
    const term = q.trim(); if (term.length < 3) return;
    setBusy(true); setMsg(null);
    try {
      const j = await (await fetch(`/api/geocode?q=${encodeURIComponent(term)}`)).json();
      const hit = j.hits?.[0];
      if (!hit) { setMsg(j.error ?? 'No match in Australia.'); return; }
      if (!inAustralia(hit)) { setMsg('Result is outside Australia — ignored.'); return; }
      m.setView([hit.lat, hit.lng], 17);
      setMsg(hit.label);
      onPick?.({ lat: hit.lat, lng: hit.lng });
    } catch (e: any) { setMsg(`Search failed: ${e?.message ?? e}`); }
    finally { setBusy(false); }
  }, [q, ready, onPick]);

  const count = (k: keyof LayerVis) => (shapes?.[k]?.length ?? 0);

  // Live readout: the shape in progress wins over the committed one, so the
  // figure on screen is always the thing under the cursor.
  const liveArea =
    mode === 'polygon' && draft.length >= 3 ? polygonAreaM2([draft])
    : rings ? polygonAreaM2(rings)
    : null;
  const liveLen =
    mode === 'line' && draft.length >= 2 ? pathLengthM(draft)
    : liveArea == null && line ? pathLengthM(line)
    : null;
  const liveVerts =
    drafting ? draft.length
    : rings && liveArea != null ? rings[0].length
    : line ? line.length : 0;

  return (
    <div className="map-wrap">
      <div className="map-bar">
        <input value={q} onChange={(e) => setQ(e.target.value)}
               onKeyDown={(e) => e.key === 'Enter' && search()}
               placeholder="Address, suburb, or lat,lng" aria-label="Search for a site" />
        <button onClick={search} disabled={busy || !ready} className="primary">
          {busy ? 'Searching…' : 'Find'}
        </button>
        <div className="seg">
          {(Object.keys(BASEMAPS) as BasemapKey[]).map((k) => (
            <button key={k} onClick={() => setBase(k)} aria-pressed={base === k}>
              {BASEMAPS[k].label}
            </button>
          ))}
        </div>
      </div>

      <DrawTools
        mode={mode} onMode={changeMode}
        areaM2={liveArea} lengthM={liveLen} vertices={liveVerts}
        drafting={drafting} hasShape={!!rings || !!line}
        onUndo={() => setDraft((d) => d.slice(0, -1))}
        onFinish={() => finishRef.current()}
        onClear={clearDrawn}
        onImport={doImport} onExport={doExport}
        note={note} error={err}
      />

      <div className="legend">
        {(Object.keys(LAYER_STYLE) as (keyof LayerVis)[]).map((k) => {
          const n = count(k);
          return (
            <button key={k} className={`chip${vis[k] ? ' on' : ''}${n ? '' : ' empty'}`}
                    onClick={() => setVis((v) => ({ ...v, [k]: !v[k] }))}
                    aria-pressed={vis[k]} disabled={!n}>
              <i style={{ background: LAYER_STYLE[k].color }} />
              {LAYER_STYLE[k].label}{n ? ` (${n})` : ''}
            </button>
          );
        })}
      </div>

      {msg && <div className="map-msg">{msg}</div>}
      {/* crosshair only while placing points — in edit/delete the pointer is
          aimed at handles, and a map-wide crosshair would lie about that */}
      <div ref={host} className={`map-canvas${drafting ? ' drawing' : ''}`} />
      <div className="map-foot">
        {mode === 'none'
          ? <>Click the map to analyse any point. A layer with no shapes is greyed out —
              that means nothing is mapped there, which is not the same as a clearance.</>
          : drafting
          ? <>Placing points, so clicking the map no longer re-analyses it.
              Esc cancels the shape in progress, Enter closes it.</>
          : <>{mode === 'edit' ? 'Editing' : 'Deleting'} corners, so clicking the map no longer
              re-analyses it. Leave this mode to go back to point analysis.</>}
      </div>
    </div>
  );
}
