// Kept free of any Leaflet import. The page imports these constants, and
// Leaflet touches `window` at module scope -- pulling it into the server
// bundle breaks prerendering even though the map itself is ssr:false.

export interface LayerVis {
  neighbours: boolean;
  parcel: boolean;
  sfha: boolean;
  water: boolean;
  wetlands: boolean;
  streams: boolean;
  pipelines: boolean;
  wells: boolean;
  grid: boolean;
}

export const LAYER_STYLE: Record<string, { color: string; label: string }> = {
  neighbours: { color: '#9aa3af', label: 'Nearby parcels (zoom in)' },
  // Amber, cased in white — the only colour that survives both a pale street
  // basemap and dark satellite imagery.
  parcel: { color: '#f59e0b', label: 'Subject parcel' },
  sfha: { color: '#2563eb', label: 'FEMA flood zone' },
  water: { color: '#0891b2', label: 'Ponds & lakes' },
  wetlands: { color: '#059669', label: 'Wetlands (NWI)' },
  streams: { color: '#38bdf8', label: 'Streams' },
  pipelines: { color: '#dc2626', label: 'Pipelines' },
  wells: { color: '#b45309', label: 'Wells' },
  grid: { color: '#9333ea', label: 'Unbuildable cells' },
};
