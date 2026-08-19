'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { formatArea } from '@/lib/geojson';
import { formatSiteDate, type SavedSite } from '@/lib/overlays';

/** The map's status and action bar, ported from the single-file build.
 *
 *  It used to be three stacked rows — the jurisdiction/coordinate readout, a
 *  four-button action row, and a saved-site shelf — on top of an overlay chip
 *  row and a two-row draw bar. Together they pushed the map itself more than
 *  340 px down the page. It is now ONE row: the readout on the left, the two
 *  actions people reach for on the right, and everything else behind a menu
 *  that opens over the map instead of shoving it further down.
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
    <div className="mapctl">
      <span className="mc-juris">{jurisdiction}</span>
      <span className="mc-live">{live}</span>

      <span className="mc-spacer" />

      <span className="mc-coords">
        {coords
          ? `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`
          : 'move the pointer over the map'}
      </span>
      <span className="mc-zoom">z{zoom.toFixed(1)}</span>

      <button type="button" className="mc-btn" onClick={onFit} disabled={!canFit}
              title={canFit ? 'Zoom to the drawn or selected site'
                            : 'Draw, import or restore a site first'}>
        Fit site
      </button>
      <button type="button" className="mc-btn" onClick={onSave} disabled={!canSave}
              title={canSave ? 'Store this boundary in this browser'
                             : 'Draw or import a polygon first'}>
        Save site
      </button>

      <Menu
        label={`Saved${sites.length ? ` (${sites.length})` : ''}`}
        title="Restore or delete a site saved in this browser"
        disabled={sites.length === 0}
        align="right"
      >
        {sites.length === 0 ? (
          <p className="menu-empty">○ Nothing saved in this browser yet. Draw a boundary
            and press <b>Save site</b>.</p>
        ) : (
          <div className="site-list">
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
      </Menu>

      <Menu label="More" title="Data refresh and destructive actions" align="right">
        <button type="button" className="menu-item" onClick={onRefresh} disabled={refreshing}>
          {refreshing ? 'Refreshing…' : 'Refresh data'}
          <em>Drop every cached response and re-query each active overlay for this view</em>
        </button>
        <button type="button" className="menu-item warn"
                onClick={() => active && onDelete(active.id)} disabled={!active}>
          Delete saved site
          <em>{active ? `Removes “${active.name}” from this browser`
                      : 'Restore a saved site first'}</em>
        </button>
      </Menu>
    </div>
  );
}

/* -------------------------------------------------------------- the menu */

/** A disclosure that opens OVER the map rather than pushing it down. Shared
 *  by the three map control bars, which is why it is exported from here.
 *
 *  Closes on Escape and on a click outside, and never traps focus — these are
 *  secondary controls and a person must be able to get out of them by
 *  clicking the map. */
export function Menu({ label, title, children, disabled, align = 'left', tone }: {
  label: ReactNode;
  title?: string;
  children: ReactNode;
  disabled?: boolean;
  align?: 'left' | 'right';
  tone?: 'bad';
}) {
  const [open, setOpen] = useState(false);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (host.current && !host.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="menu" ref={host}>
      <button type="button"
              className={`mc-btn menu-t${open ? ' on' : ''}${tone ? ` ${tone}` : ''}`}
              aria-expanded={open} disabled={disabled} title={title}
              onClick={() => setOpen((o) => !o)}>
        {label}<i aria-hidden="true" className="menu-caret">▾</i>
      </button>
      {open && (
        <div className={`menu-pop${align === 'right' ? ' right' : ''}`}
             /* Picking a menu item is a decision, so the menu closes behind
              * it. Controls that are meant to be used repeatedly inside a
              * popover — the GeoJSON box and its buttons — are not
              * .menu-item, so they leave it open. */
             onClick={(e) => {
               const el = (e.target as HTMLElement).closest('.menu-item');
               if (el && !(el as HTMLButtonElement).disabled) setOpen(false);
             }}>
          {children}
        </div>
      )}
    </div>
  );
}
