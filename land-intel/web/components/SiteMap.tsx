'use client';

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import type { GridCell } from '@/lib/yield';
import { LAYER_STYLE, type LayerVis } from '@/lib/mapStyle';

export type { LayerVis };
export { LAYER_STYLE };

export interface MapData {
  parcel: { rings: [number, number][][] };
  geometry: {
    sfha: [number, number][][][];
    water: [number, number][][][];
    wetlands: [number, number][][][];
    streams: [number, number][][];
    pipelines: [number, number][][];
  };
  grid: GridCell[];
  context: { wells: { lat: number; lon: number; type: string; kind: string }[] };
}

export type Basemap = 'map' | 'satellite' | 'terrain';

const TILES: Record<Basemap, { url: string; attr: string; max: number }> = {
  terrain: {
    // Esri World Hillshade — free, no key. Shows the shape of the ground,
    // which on raw land tells you where water goes.
    url: 'https://services.arcgisonline.com/arcgis/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    attr: 'Hillshade &copy; Esri, USGS',
    max: 16,
  },
  map: {
    url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png',
    attr: '&copy; OpenStreetMap &copy; CARTO',
    max: 19,
  },
  satellite: {
    // Esri World Imagery — free, no key, global sub-metre in most US metros.
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    max: 19,
  },
};

// Below this zoom the viewport covers too much ground to draw every parcel.
const PARCEL_ZOOM = 15;

const toLatLng = (ring: [number, number][]) =>
  ring.map(([lo, la]) => [la, lo] as [number, number]);

const money = (v: unknown) =>
  typeof v === 'number' ? '$' + Math.round(v).toLocaleString() : null;

export default function SiteMap({
  data, vis, streamBufferFt, maxSlopePct, basemap, onPickParcel,
}: {
  data: MapData | null;
  vis: LayerVis;
  streamBufferFt: number;
  maxSlopePct: number;
  basemap: Basemap;
  onPickParcel?: (propId: number) => void;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<Record<string, L.LayerGroup>>({});
  const tileRef = useRef<L.TileLayer | null>(null);
  const pickRef = useRef(onPickParcel);
  pickRef.current = onPickParcel;

  useEffect(() => {
    if (mapRef.current || !elRef.current) return;
    const map = L.map(elRef.current, { zoomControl: true }).setView(
      [33.24, -96.8], 11,
    );
    mapRef.current = map;
    for (const k of Object.keys(LAYER_STYLE)) {
      layersRef.current[k] = L.layerGroup().addTo(map);
    }
    layersRef.current.neighbours = L.layerGroup().addTo(map);

    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(elRef.current);

    // Load the surrounding ownership fabric on demand.
    let seq = 0;
    const loadParcels = async () => {
      const g = layersRef.current.neighbours;
      if (!g) return;
      if (map.getZoom() < PARCEL_ZOOM) { g.clearLayers(); return; }
      const b = map.getBounds();
      const bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]
        .map((v) => v.toFixed(6)).join(',');
      const mine = ++seq;
      try {
        const res = await fetch(`/api/parcels?bbox=${bbox}`);
        const d = await res.json();
        if (mine !== seq || !d.features) return;
        g.clearLayers();
        for (const p of d.features) {
          if (!p.rings?.length) continue;
          L.polygon(p.rings.map(toLatLng), {
            // Light, semi-transparent lines read on both the pale basemap and
            // dark satellite imagery; a flat grey disappears on aerial.
            color: '#ffffff', weight: 1.2, opacity: 0.75,
            fillOpacity: 0.04, fillColor: '#ffffff',
          })
            .on('click', () => pickRef.current?.(p.propId))
            .bindTooltip(
              `<b>${p.owner ?? 'Unknown owner'}</b>` +
              (p.acres ? `<br>${Number(p.acres).toFixed(2)} ac` : '') +
              (money(p.value) ? `<br>${money(p.value)} assessed` : '') +
              (p.situs ? `<br>${p.situs}` : '') +
              '<br><i>click to analyse</i>',
              { sticky: true },
            )
            .addTo(g);
        }
      } catch { /* transient; next moveend retries */ }
    };
    map.on('moveend zoomend', loadParcels);

    return () => {
      ro.disconnect();
      map.off('moveend zoomend', loadParcels);
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // basemap switch
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const t = TILES[basemap];
    tileRef.current = L.tileLayer(t.url, {
      attribution: t.attr, maxZoom: t.max,
    });
    tileRef.current.addTo(map);
    tileRef.current.bringToBack();
  }, [basemap]);

  // redraw analysis overlays
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !data) return;
    const G = layersRef.current;
    for (const k of Object.keys(LAYER_STYLE)) G[k]?.clearLayers();

    const st = (k: string, extra: L.PathOptions = {}) => ({
      color: LAYER_STYLE[k].color, weight: 2, ...extra,
    });

    data.geometry.sfha.forEach((rings) =>
      L.polygon(rings.map(toLatLng), st('sfha', { fillOpacity: 0.25 }))
        .bindPopup('FEMA Special Flood Hazard Area').addTo(G.sfha));
    data.geometry.wetlands.forEach((rings) =>
      L.polygon(rings.map(toLatLng), st('wetlands', { fillOpacity: 0.3 }))
        .bindPopup('NWI wetland').addTo(G.wetlands));
    data.geometry.water.forEach((rings) =>
      L.polygon(rings.map(toLatLng), st('water', { fillOpacity: 0.45 }))
        .bindPopup('Pond / lake').addTo(G.water));
    data.geometry.streams.forEach((path) =>
      L.polyline(toLatLng(path), st('streams', { weight: 2.5 }))
        .bindPopup('Stream').addTo(G.streams));
    data.geometry.pipelines.forEach((path) =>
      L.polyline(toLatLng(path), st('pipelines', { weight: 3, dashArray: '6 4' }))
        .bindPopup('Pipeline (RRC)').addTo(G.pipelines));

    data.context.wells.forEach((w) => {
      if (w.lat == null || w.lon == null) return;
      L.circleMarker([w.lat, w.lon], {
        radius: 6, color: LAYER_STYLE.wells.color, fillOpacity: 0.9, weight: 2,
      }).bindPopup(w.type || w.kind).addTo(G.wells);
    });

    data.grid.forEach((c) => {
      const bad = c.sfha || c.water || c.wetland ||
        c.dStream <= streamBufferFt || c.slope > maxSlopePct;
      if (!bad) return;
      const why = [
        c.sfha && 'flood', c.water && 'water', c.wetland && 'wetland',
        c.dStream <= streamBufferFt && `stream ${Math.round(c.dStream)}ft`,
        c.slope > maxSlopePct && `slope ${c.slope.toFixed(1)}%`,
      ].filter(Boolean).join(', ');
      L.circleMarker([c.lat, c.lon], {
        radius: 3, color: LAYER_STYLE.grid.color, weight: 0, fillOpacity: 0.55,
      }).bindPopup(why).addTo(G.grid);
    });

    // The subject parcel is the one thing that must never be lost against the
    // basemap. Draw it as a cased line -- a dark halo underneath, a bright
    // amber line on top -- so it reads on pale tiles and dark aerial alike.
    const latlngs = data.parcel.rings.map(toLatLng);
    L.polygon(latlngs, {
      color: '#ffffff', weight: 5, opacity: 0.95, fill: false,
      lineJoin: 'round',
    }).addTo(G.parcel);
    const parcel = L.polygon(latlngs, {
      color: LAYER_STYLE.parcel.color, weight: 2.5, opacity: 1,
      fillColor: LAYER_STYLE.parcel.color, fillOpacity: 0.07,
      lineJoin: 'round',
    }).addTo(G.parcel);

    // The container is sized by flex after Leaflet initialised, so its cached
    // dimensions are stale -- tiles come up blank and fitBounds lands on the
    // wrong zoom. Recompute before fitting.
    map.invalidateSize();
    map.fitBounds(parcel.getBounds(), { padding: [30, 30] });
  }, [data, streamBufferFt, maxSlopePct]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const [k, on] of Object.entries(vis)) {
      const g = layersRef.current[k];
      if (!g) continue;
      if (on && !map.hasLayer(g)) map.addLayer(g);
      if (!on && map.hasLayer(g)) map.removeLayer(g);
    }
  }, [vis]);

  return <div ref={elRef} className="map" />;
}
