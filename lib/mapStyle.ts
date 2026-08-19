/** Kept free of any Leaflet import. The page imports these constants, and
 *  Leaflet touches `window` at module scope — pulling it into the server
 *  bundle breaks prerendering even though the map itself is ssr:false. */

export interface LayerVis {
  parcel: boolean;
  zoning: boolean;
  flood: boolean;
  bushfire: boolean;
  landslide: boolean;
  biodiversity: boolean;
}

export const DEFAULT_VIS: LayerVis = {
  parcel: true, zoning: false, flood: true,
  bushfire: true, landslide: true, biodiversity: true,
};

/** Colours are chosen to survive BOTH a pale street basemap and dark
 *  satellite imagery. A flat grey or mid-blue vanishes on aerial. */
export const LAYER_STYLE: Record<keyof LayerVis, { color: string; label: string; fill: number }> = {
  // Amber cased in white — the subject parcel must never be lost.
  parcel:       { color: '#f59e0b', label: 'Subject lot',        fill: 0.07 },
  zoning:       { color: '#7c3aed', label: 'Zoning',             fill: 0.12 },
  flood:        { color: '#2563eb', label: 'Flood planning',     fill: 0.22 },
  // Australian convention: bushfire is orange-red, and it is the layer most
  // likely to change what you can build.
  bushfire:     { color: '#ea580c', label: 'Bush fire prone',    fill: 0.26 },
  landslide:    { color: '#b45309', label: 'Landslide risk',     fill: 0.22 },
  biodiversity: { color: '#059669', label: 'Biodiversity values', fill: 0.24 },
};

export const BASEMAPS = {
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Imagery',
    max: 19,
  },
  street: {
    label: 'Map',
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: 'OpenStreetMap',
    max: 19,
  },
  // Shows the shape of the ground. On raw land that tells you where water
  // goes, which no street map will.
  terrain: {
    label: 'Terrain',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri World Hillshade',
    max: 16,
  },
} as const;

export type BasemapKey = keyof typeof BASEMAPS;
