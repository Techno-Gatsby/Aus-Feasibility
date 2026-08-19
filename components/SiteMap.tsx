'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import type * as L from 'leaflet';
import { BASEMAPS, LAYER_STYLE, DEFAULT_VIS, type LayerVis, type BasemapKey } from '@/lib/mapStyle';
import { inAustralia } from '@/lib/geo';
import DrawTools, { type DrawMode } from '@/components/DrawTools';
import LiveOverlays, { type OverlayStatus } from '@/components/LiveOverlays';
import MapControls from '@/components/MapControls';
import {
  importGeoJSON, featureToString, polygonAreaM2, pathLengthM,
  formatArea, formatLength, type LatLng, type Ring, type Rings,
} from '@/lib/geojson';
import {
  OVERLAY_ORDER, OVERLAY_META, ZONE_COLOR, CONTOUR_PAINT,
  loadAbsOverlay, loadZoning, loadContours, buildRamp,
  jurisdictionAt, jurisdictionLabel, clearOverlayCaches,
  listSavedSites, saveSite as persistSite, deleteSavedSite, formatSiteDate,
  type OverlayKey, type Box, type Jurisdiction, type SavedSite,
  type GeoFeature, type ZoneCategory,
} from '@/lib/overlays';

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

  // ── live overlays ────────────────────────────────────────────────────────
  /** Overlay groups live OUTSIDE `groups` for the same reason the drawn site
   *  does: the layer-draw effect calls clearLayers() on everything in `groups`
   *  whenever `shapes` changes, and a live overlay must survive a re-query of
   *  the parcel. They also get their own pane, so they always sit under the
   *  cadastre and the drawn boundary no matter what order anything is added
   *  in — an overlay painting over the subject lot would be the same failure
   *  the casing exists to prevent. */
  const ovGroups = useRef<Partial<Record<OverlayKey, L.LayerGroup>>>({});
  /** Viewport each overlay was last fetched for, so a small pan does not
   *  re-query a service that already covers the view. */
  const ovView = useRef<Partial<Record<OverlayKey, { bbox: Box; zoom: number }>>>({});
  const [ovStatus, setOvStatus] = useState<Record<OverlayKey, OverlayStatus>>(
    () => Object.fromEntries(OVERLAY_ORDER.map((k) => [k, { on: false }])) as Record<OverlayKey, OverlayStatus>,
  );
  const [zoom, setZoom] = useState(12);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [juris, setJuris] = useState<Jurisdiction | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [sites, setSites] = useState<SavedSite[]>([]);
  const [activeSite, setActiveSite] = useState<string | null>(null);

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

  /** The map's own handlers are bound once, so everything they read has to
   *  come through a ref — closing over the first render's overlay state would
   *  freeze the refresh list at "nothing is on". */
  const ovOnRef = useRef<Partial<Record<OverlayKey, boolean>>>({});
  const loadOneRef = useRef<(k: OverlayKey, force: boolean) => void>(() => {});
  const jurisRef = useRef<Jurisdiction | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jurisTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const jurisSeq = useRef(0);
  const coordTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingLatLng = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { ringsRef.current = rings; }, [rings]);
  useEffect(() => { onPickRef.current = onPick; onShapeRef.current = onShape; });
  useEffect(() => { jurisRef.current = juris; }, [juris]);
  useEffect(() => {
    ovOnRef.current = Object.fromEntries(
      OVERLAY_ORDER.map((k) => [k, !!ovStatus[k].on]),
    ) as Partial<Record<OverlayKey, boolean>>;
  }, [ovStatus]);

  const setOv = useCallback((k: OverlayKey, patch: Partial<OverlayStatus>) => {
    setOvStatus((s) => ({ ...s, [k]: { ...s[k], ...patch } }));
  }, []);

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

  // ── live overlays: paint ─────────────────────────────────────────────────
  /** One styler per layer, matching the single-file build's paint. The fills
   *  are deliberately weak: an overlay is context for the site, and if it
   *  competes with the cadastre for attention it has stopped being context. */
  const paintVector = useCallback((key: OverlayKey, features: GeoFeature[]) => {
    const leaflet = Lref.current, g = ovGroups.current[key];
    if (!leaflet || !g) return;
    g.clearLayers();
    if (!features.length) return;

    const ramp = (key === 'population' || key === 'age' || key === 'income')
      ? buildRamp(key, features) : null;

    const style = (f: any) => {
      const p = f?.properties ?? {};
      if (ramp) {
        return { color: ramp.stroke, weight: 0.55, opacity: 0.8,
                 fillColor: ramp.color(p.__value), fillOpacity: 0.48 };
      }
      if (key === 'zoning') {
        return { color: '#5D6D80', weight: 0.65, opacity: 0.8,
                 fillColor: ZONE_COLOR[(p.__category as ZoneCategory) ?? 'other'] ?? ZONE_COLOR.other,
                 fillOpacity: 0.36 };
      }
      if (key === 'poa') {
        return { color: '#3974BA', weight: 0.8, opacity: 0.8, fillColor: '#5A8FD1', fillOpacity: 0.055 };
      }
      // states: a boundary, not a fill — the whole point is the line
      return { color: '#315E92', weight: 1.6, opacity: 0.8, fillColor: '#ffffff', fillOpacity: 0.01 };
    };

    // Tooltips are worth their cost on a readable number of shapes and are a
    // hit-test tax on a thousand of them.
    const label = features.length <= 400;
    const layer = leaflet.geoJSON({ type: 'FeatureCollection', features } as any, {
      pane: 'ausfeas-overlays',
      style: style as any,
      onEachFeature: label ? (f: any, l: any) => {
        const p = f?.properties ?? {};
        const name = String(p.__label ?? '');
        const v = p.__value;
        const val = Number.isFinite(Number(v))
          ? key === 'income' ? `A$${Number(v).toLocaleString('en-AU')} p.a.`
            : key === 'age' ? `${Number(v)} years median`
            : Number(v).toLocaleString('en-AU')
          : null;
        const text = [name, val, p.__sub].filter(Boolean).join(' · ');
        if (text) l.bindTooltip(text, { sticky: true });
      } : undefined,
    });
    layer.addTo(g);
  }, []);

  const paintContours = useCallback((lines: { level: 0 | 1; elevation: number; latlngs: [number, number][] }[]) => {
    const leaflet = Lref.current, g = ovGroups.current.contours;
    if (!leaflet || !g) return;
    g.clearLayers();
    for (const c of lines) {
      const index = c.level === 1;
      const pl = leaflet.polyline(c.latlngs as any, {
        pane: 'ausfeas-overlays',
        color: CONTOUR_PAINT.color,
        weight: index ? CONTOUR_PAINT.major : CONTOUR_PAINT.minor,
        opacity: CONTOUR_PAINT.opacity,
        // only index contours carry a height label and earn a hit-test;
        // making every minor line interactive makes the map feel sticky
        interactive: index,
      } as any).addTo(g);
      if (index) pl.bindTooltip(`${c.elevation} m`, { sticky: true });
    }
  }, []);

  // ── live overlays: load ──────────────────────────────────────────────────
  const loadOne = useCallback(async (key: OverlayKey, force: boolean) => {
    const m = map.current;
    if (!m || !ovGroups.current[key]) return;
    const meta = OVERLAY_META[key];
    const z = m.getZoom();

    // The floor. Below it the layer is NOT requested and NOT drawn: at
    // national zoom the viewport bbox is the continent, the service answers
    // with hundreds of kilometres of polygon per feature, and the map dies —
    // which is exactly what the original build did before this existed.
    if (z < meta.minZoom) {
      ovGroups.current[key]!.clearLayers();
      delete ovView.current[key];
      setOv(key, { busy: false, error: null, withheld: true, note: null });
      return;
    }

    const b = m.getBounds();
    const view: Box = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()];
    const prev = ovView.current[key];
    const contains = (a: Box, c: Box) => a[0] <= c[0] && a[1] <= c[1] && a[2] >= c[2] && a[3] >= c[3];
    if (!force && prev && contains(prev.bbox, view) && Math.abs(prev.zoom - z) < 2) {
      setOv(key, { withheld: false });
      return;
    }

    // Fetch a little wider than the screen so a nudge of the map does not
    // expose an unpainted margin. Demographic layers get a tighter pad: their
    // polygons are large and the payload grows fast.
    const pad = key === 'zoning' ? 0.08
      : (key === 'population' || key === 'age' || key === 'income') ? 0.025 : 0.10;
    const dx = (view[2] - view[0]) * pad, dy = (view[3] - view[1]) * pad;
    const bbox: Box = [view[0] - dx, view[1] - dy, view[2] + dx, view[3] + dy];

    setOv(key, { busy: true, error: null, withheld: false });
    try {
      if (key === 'contours') {
        const { lines, note } = await loadContours(
          { west: bbox[0], south: bbox[1], east: bbox[2], north: bbox[3] }, z);
        paintContours(lines);
        ovView.current[key] = { bbox, zoom: z };
        setOv(key, { busy: false, error: null, note });
      } else if (key === 'zoning') {
        const c = m.getCenter();
        const res = await loadZoning(bbox, z, { lng: c.lng, lat: c.lat }, jurisRef.current);
        paintVector(key, res.geojson.features);
        ovView.current[key] = { bbox, zoom: z };
        setOv(key, { busy: false, error: null, note: res.note });
      } else {
        const res = await loadAbsOverlay(key, bbox, z);
        paintVector(key, res.geojson.features);
        ovView.current[key] = { bbox, zoom: z };
        setOv(key, { busy: false, error: null, note: res.note });
      }
    } catch (e: any) {
      // A failed query is NOT an empty layer. Say so on the chip, and leave
      // whatever was drawn alone rather than blanking it to look clean.
      delete ovView.current[key];
      setOv(key, { busy: false, error: String(e?.message ?? e), note: null });
    }
  }, [paintVector, paintContours, setOv]);
  useEffect(() => { loadOneRef.current = (k, f) => { void loadOne(k, f); }; });

  const toggleOverlay = useCallback((key: OverlayKey) => {
    const on = !ovStatus[key].on;
    setOv(key, { on, error: null, note: null, withheld: false, busy: on });
    if (!on) {
      ovGroups.current[key]?.clearLayers();
      delete ovView.current[key];
      setOv(key, { busy: false });
      return;
    }
    void loadOne(key, true);
  }, [ovStatus, loadOne, setOv]);

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

      // Live overlays get a pane BELOW the default overlay pane (400), so
      // context can never paint over the cadastre or the drawn boundary
      // whatever order things are added in.
      const pane = m.createPane('ausfeas-overlays');
      pane.style.zIndex = '380';
      OVERLAY_ORDER.forEach((k) => { ovGroups.current[k] = leaflet.layerGroup().addTo(m); });

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
        // coordinate readout, throttled: React does not need 60 updates a
        // second and the readout is unreadable at that rate anyway
        pendingLatLng.current = { lat: e.latlng.lat, lng: e.latlng.lng };
        if (!coordTimer.current) {
          coordTimer.current = setTimeout(() => {
            coordTimer.current = null;
            if (pendingLatLng.current) setCoords(pendingLatLng.current);
          }, 90);
        }
        const b = band.current, d = draftRef.current;
        if (!b || !d.length) return;
        b.setLatLngs([d[d.length - 1], [e.latlng.lat, e.latlng.lng]] as any);
      });
      m.on('dblclick', () => {
        const md = modeRef.current;
        if (md === 'polygon' || md === 'line') finishRef.current();
      });

      // Panning re-queries whatever overlays are on, once the map settles.
      m.on('moveend', () => {
        setZoom(m.getZoom());
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          for (const k of OVERLAY_ORDER) if (ovOnRef.current[k]) loadOneRef.current(k, false);
        }, 650);

        if (jurisTimer.current) clearTimeout(jurisTimer.current);
        jurisTimer.current = setTimeout(async () => {
          const c = m.getCenter();
          const seq = ++jurisSeq.current;
          const j = await jurisdictionAt(c.lng, c.lat);
          // a slower earlier lookup must not overwrite a newer one
          if (seq === jurisSeq.current && j) setJuris(j);
        }, 420);
      });

      map.current = m;
      setReady(true);
      setZoom(m.getZoom());
      setTimeout(() => m.invalidateSize(), 60);
    })();
    return () => {
      dead = true;
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      if (jurisTimer.current) clearTimeout(jurisTimer.current);
      if (coordTimer.current) clearTimeout(coordTimer.current);
      map.current?.remove();
      map.current = null;
      ovGroups.current = {};
    };
  }, [addVertex]);

  // saved sites are read once on mount — localStorage is not available during
  // the server render, so this cannot be an initialiser
  useEffect(() => { setSites(listSavedSites()); }, []);

  // first jurisdiction label, without waiting for the user to move the map
  useEffect(() => {
    const m = map.current;
    if (!m || !ready) return;
    let dead = false;
    const c = m.getCenter();
    jurisdictionAt(c.lng, c.lat).then((j) => { if (!dead && j) setJuris(j); });
    return () => { dead = true; };
  }, [ready]);

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

  // ── FIT SITE / REFRESH DATA / saved sites ────────────────────────────────
  /** Whatever counts as "the site" right now, in priority order: the drawn
   *  boundary, then a measured line, then the queried subject lot. */
  const fitTarget = useCallback((): [number, number][][] | null => {
    const r = ringsRef.current;
    if (r?.length) return r;
    if (line?.length) return [line];
    const parcel = shapes?.parcel?.[0];
    if (parcel?.length) return parcel;
    return null;
  }, [line, shapes]);

  const fitSite = useCallback(() => {
    const m = map.current, leaflet = Lref.current;
    if (!m || !leaflet) return;
    const target = fitTarget();
    if (!target) return;
    // The container is flex-sized AFTER Leaflet initialises, so its cached
    // dimensions are stale until it is told otherwise — fitting against them
    // lands the wrong zoom and leaves tiles blank. Same trap as the parcel fit.
    m.invalidateSize();
    m.fitBounds(leaflet.polygon(target as any).getBounds(), { padding: [50, 50], maxZoom: 18 });
  }, [fitTarget]);

  const refreshData = useCallback(async () => {
    const m = map.current;
    if (!m) return;
    setRefreshing(true);
    clearOverlayCaches();
    ovView.current = {};
    const on = OVERLAY_ORDER.filter((k) => ovStatus[k].on);
    // sequential-ish: the ABS services rate-limit a burst and answer a queue
    await Promise.all(on.map((k, i) => new Promise<void>((res) => {
      setTimeout(() => { void loadOne(k, true).then(() => res()); }, i * 80);
    })));
    const c = m.getCenter();
    const j = await jurisdictionAt(c.lng, c.lat);
    if (j) setJuris(j);
    setRefreshing(false);
  }, [ovStatus, loadOne]);

  const saveCurrent = useCallback(() => {
    const r = ringsRef.current;
    if (!r?.length) return;
    const lats = r[0].map((p) => p[0]), lngs = r[0].map((p) => p[1]);
    const centre: [number, number] = [
      (Math.min(...lats) + Math.max(...lats)) / 2,
      (Math.min(...lngs) + Math.max(...lngs)) / 2,
    ];
    const base = juris?.lga || juris?.state || 'Site';
    const n = listSavedSites().filter((s) => s.name.startsWith(base)).length + 1;
    const next = persistSite({
      name: `${base} ${n}`,
      areaM2: polygonAreaM2(r),
      rings: r.map((ring) => ring.map((p) => [p[0], p[1]] as [number, number])),
      centre,
    });
    setSites(next);
    setActiveSite(next[0]?.id ?? null);
    setErr(null);
    setNote(`Saved “${next[0]?.name}” — ${formatArea(polygonAreaM2(r))}. It stays in this browser.`);
  }, [juris]);

  const restoreSite = useCallback((s: SavedSite) => {
    const m = map.current, leaflet = Lref.current;
    setRings(s.rings);
    setDraft([]); setLine(null); setMode('none'); setErr(null);
    setActiveSite(s.id);
    setNote(`Restored “${s.name}” — ${formatArea(s.areaM2)}, saved ${formatSiteDate(s.created)}.`);
    if (m && leaflet) {
      m.invalidateSize();                     // same stale-size trap as the parcel fit
      m.fitBounds(leaflet.polygon(s.rings as any).getBounds(), { padding: [50, 50], maxZoom: 18 });
    }
  }, []);

  const removeSite = useCallback((id: string) => {
    const next = deleteSavedSite(id);
    setSites(next);
    setActiveSite((cur) => (cur === id ? null : cur));
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

  const ovBusy = OVERLAY_ORDER.some((k) => ovStatus[k].busy);
  const liveText = ovBusy
    ? 'Loading live data'
    : base === 'satellite' ? 'Satellite + live Australian data' : 'OSM + live Australian data';

  /** Surfaced in full under the chips, not just in a tooltip: a service that
   *  did not answer has to be legible without hovering, because the wrong
   *  reading of a blank layer is "nothing here". */
  const ovIssues = OVERLAY_ORDER
    .filter((k) => ovStatus[k].on && ovStatus[k].error)
    .map((k) => `${OVERLAY_META[k].label}: ${ovStatus[k].error}`);
  const ovHeld = OVERLAY_ORDER
    .filter((k) => ovStatus[k].on && ovStatus[k].withheld)
    .map((k) => `${OVERLAY_META[k].label} (zoom ${OVERLAY_META[k].minZoom}+)`);

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

      <LiveOverlays status={ovStatus} zoom={zoom} onToggle={toggleOverlay} />

      <MapControls
        jurisdiction={jurisdictionLabel(juris)}
        coords={coords}
        zoom={zoom}
        live={liveText}
        canFit={!!(rings?.length || line?.length || shapes?.parcel?.[0]?.length)}
        onFit={fitSite}
        onRefresh={() => { void refreshData(); }}
        refreshing={refreshing}
        canSave={!!rings?.length}
        onSave={saveCurrent}
        sites={sites}
        activeId={activeSite}
        onRestore={restoreSite}
        onDelete={removeSite}
      />

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

      {ovHeld.length > 0 && (
        <div className="map-msg">
          Held back until you zoom in: {ovHeld.join(', ')}. At wider views the query
          covers hundreds of kilometres and the shapes carry no site-level meaning.
        </div>
      )}
      {ovIssues.length > 0 && (
        <div className="map-msg bad">
          {ovIssues.join(' · ')} — the service was asked and did not answer.
          That is not a clearance.
        </div>
      )}
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
