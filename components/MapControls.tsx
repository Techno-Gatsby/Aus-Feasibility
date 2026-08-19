'use client';
import { formatArea } from '@/lib/geojson';
import { formatSiteDate, type SavedSite } from '@/lib/overlays';

/** The map's head bar and action row, ported from the single-file build:
 *  the jurisdiction label and coordinate readout that track the map as it
 *  moves, FIT SITE, REFRESH DATA, and the saved-site shelf.
 *
 *  Holds no Leaflet and no geometry — SiteMap owns the map and hands this
 *  finished values, so the whole control surface renders in a test without a
 *  map instance.
 */

export default function MapControls({
  jurisdiction, coords, zoom, live,
  canFit, onFit, onRefresh, refreshing,
  canSave, onSave,
  sites, activeId, onRestore, onDelete,
}: {
  jurisdiction: string;
  /** Null until the pointer has been over the map — an empty readout is
   *  honest, a 0,0 readout is not. */
  coords: { lat: number; lng: number } | null;
  zoom: number;
  live: string;
  canFit: boolean;
  onFit: () => void;
  onRefresh: () => void;
  refreshing: boolean;
  canSave: boolean;
  onSave: () => void;
  sites: SavedSite[];
  activeId: string | null;
  onRestore: (s: SavedSite) => void;
  onDelete: (id: string) => void;
}) {
  const active = sites.find((s) => s.id === activeId) ?? null;

  return (
    <>
      <div className="map-head">
        <span className="mh-juris">{jurisdiction}</span>
        <span className="mh-live">{live}</span>
        <span className="mh-spacer" />
        <span className="mh-coords">
          {coords
            ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
            : 'move the pointer over the map'}
        </span>
        <span className="mh-zoom">z{zoom.toFixed(1)}</span>
      </div>

      <div className="map-acts">
        <button type="button" onClick={onFit} disabled={!canFit}
                title={canFit ? 'Zoom to the drawn or selected site'
                              : 'Draw, import or restore a site first'}>
          Fit site
        </button>
        <button type="button" onClick={onRefresh} disabled={refreshing}
                title="Drop every cached response and re-query each active overlay for the current view">
          {refreshing ? 'Refreshing…' : 'Refresh data'}
        </button>
        <button type="button" onClick={onSave} disabled={!canSave}
                title={canSave ? 'Store this boundary in this browser'
                               : 'Draw or import a polygon first'}>
          Save as site
        </button>
        <button type="button" className="warn"
                onClick={() => active && onDelete(active.id)} disabled={!active}
                title={active ? `Delete “${active.name}”`
                              : 'Restore a saved site to delete it'}>
          Delete saved site
        </button>
      </div>

      {sites.length > 0 && (
        <div className="site-list">
          <span className="sl-label">Saved sites</span>
          {sites.map((s) => (
            <span key={s.id} className={`sl-item${s.id === activeId ? ' on' : ''}`}>
              <button type="button" className="sl-open" onClick={() => onRestore(s)}
                      title={`Restore ${s.name} — ${formatArea(s.areaM2)}`}>
                {s.name}
                <em>{formatArea(s.areaM2)}</em>
                <i>{formatSiteDate(s.created)}</i>
              </button>
              <button type="button" className="sl-del" onClick={() => onDelete(s.id)}
                      aria-label={`Delete ${s.name}`} title={`Delete ${s.name}`}>×</button>
            </span>
          ))}
        </div>
      )}
    </>
  );
}
