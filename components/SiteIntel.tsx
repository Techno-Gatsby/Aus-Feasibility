'use client';
// Type-only imports: lib/terrain reaches for node:zlib and lib/poi does
// network work, so neither may be bundled into the client. `import type` is
// erased at compile time, which is the whole point of it here.
import type { TerrainResult } from '@/lib/terrain';
import type { PoiResult, PoiCategory } from '@/lib/poi';
import {
  Fact, Failed, Waiting, ShowAll, Detail, useJson, type Async,
} from '@/components/SiteTabs';

export type Terrain = TerrainResult & { verdict?: string };

/** SITE INTELLIGENCE — terrain and neighbourhood, ported from the single-file
 *  build's `analyzeSite` / `aumap_site_intelligence` panel.
 *
 *  This file no longer renders a panel of its own. Terrain and the OSM
 *  neighbourhood search are now two tabs of the one site panel (see
 *  SitePanel.tsx), because three stacked panels made the reader scroll several
 *  screens past blocks that had nothing to do with each other. What lives here
 *  is the data — two readings that fail independently — and the sections that
 *  draw it.
 *
 *  Nothing here is presented as survey-grade and no slope figure is ever
 *  printed without the sample count, spacing and source resolution beside it.
 */

/* ------------------------------------------------------------------ data */

export function useTerrain(point: { lat: number; lng: number } | null, halfM = 100): Async<Terrain> {
  return useJson<Terrain>(
    point ? `/api/terrain?lat=${point.lat}&lng=${point.lng}&half=${halfM}&n=6` : null,
  );
}

export function usePoi(point: { lat: number; lng: number } | null, radiusM = 2000): Async<PoiResult> {
  return useJson<PoiResult>(
    point ? `/api/poi?lat=${point.lat}&lng=${point.lng}&radius=${radiusM}&limit=8` : null,
  );
}

/** One word for the tab strip: the answer someone opens the tab to get. Words
 *  first — the tone only ever reinforces what the badge already says. */
export function terrainBadge(t: Async<Terrain>): { badge: string | null; tone: 'ok' | 'bad' | null } {
  if (t.busy) return { badge: '…', tone: null };
  if (t.err) return { badge: 'not returned', tone: 'bad' };
  if (t.data && !t.data.ok) return { badge: 'no figure', tone: 'bad' };
  if (!t.data?.ok || t.data.slopePct == null) return { badge: null, tone: null };
  return {
    badge: `${t.data.slopePct.toFixed(1)}%`,
    tone: t.data.slopePct >= 8 ? 'bad' : t.data.slopePct < 3 ? 'ok' : null,
  };
}

export function poiBadge(p: Async<PoiResult>): { badge: string | null; tone: 'ok' | 'bad' | null } {
  if (p.busy) return { badge: '…', tone: null };
  if (p.err || (p.data && !p.data.queried)) return { badge: 'not returned', tone: 'bad' };
  return { badge: null, tone: null };
}

/* --------------------------------------------------------------- terrain */

export function TerrainSection({ t, halfM = 100 }: { t: Async<Terrain>; halfM?: number }) {
  const terrain = t.data;

  if (t.err)
    return (
      <Failed what="The elevation service" why={t.err}>
        No slope figure is shown, because an unmeasured site is not a flat one.
      </Failed>
    );

  if (t.busy && !terrain)
    return <Waiting what="the elevation service for a 6 × 6 grid across the footprint" />;
  if (!terrain) return null;

  if (!terrain.ok)
    return (
      <>
        <p className="alert"><b>⚠ No slope figure.</b> {terrain.reason}</p>
        <Fact k="Elevation source" v={terrain.sourceLabel} />
        <p className="note">{terrain.resolutionNote}</p>
      </>
    );

  const slope = terrain.slopePct!;

  return (
    <>
      {/* The answer, first. */}
      <div className="answer">
        <div className="ans-k">Average slope</div>
        <div className={`ans-v${slope >= 8 ? ' bad' : slope < 3 ? ' ok' : ''}`}>
          {slope >= 8 ? '▲ ' : slope < 3 ? '▪ ' : '◣ '}{slope.toFixed(1)}%
        </div>
        <div className="ans-s">
          {cap(terrain.grade!)} · {terrain.fallM!.toFixed(1)} m of fall over{' '}
          {Math.round(terrain.spanM!)} m
          {terrain.aspect ? `, falling ${terrain.aspect}` : ''}
        </div>
      </div>

      {terrain.verdict && (
        <p className={slope >= 8 ? 'alert' : 'note'}>
          <b>{cap(terrain.grade!)} — {slope.toFixed(1)}%.</b> {terrain.verdict}
        </p>
      )}

      {/* Resolution is not a footnote. It is the bound on every number here,
          so it sits with the headline and not at the foot of a long list. */}
      <p className="note">
        <b>A sampled reading, not a survey.</b> {terrain.samples} of{' '}
        {terrain.requested} points on a {terrain.gridN} × {terrain.gridN} grid at{' '}
        {terrain.sampleSpacingM!.toFixed(0)} m spacing, from {terrain.sourceLabel}
        {terrain.resolutionM ? ` at ~${terrain.resolutionM.toFixed(0)} m resolution` : ''}.
        Anything smaller than the spacing — a batter, a gully, a cut driveway — is
        invisible to it.
      </p>

      <Detail label="Measurements">
        <Fact k="Fall across site"
              v={`${terrain.fallM!.toFixed(1)} m over ${Math.round(terrain.spanM!)} m`} />
        <Fact k="Average slope (plane fit)" v={`${slope.toFixed(1)}%`}
              tone={slope >= 8 ? 'bad' : slope < 3 ? 'ok' : undefined} />
        <Fact k="Cross-fall (fall ÷ diagonal)" v={`${terrain.crossFallPct!.toFixed(1)}%`} />
        <Fact k="Grade" v={cap(terrain.grade!)} />
        <Fact k="Falls toward"
              v={terrain.aspect ? `${terrain.aspect} (${Math.round(terrain.aspectDeg!)}°)` : undefined}
              state={terrain.aspect ? 'ok' : 'empty'} />
        <Fact k="Elevation range"
              v={`${terrain.minM!.toFixed(0)} – ${terrain.maxM!.toFixed(0)} m AHD approx.`} />
        <Fact k="Mean elevation" v={`${terrain.meanM!.toFixed(1)} m`} />
        <Fact k="Sampled footprint" v={`${halfM * 2} m square`} />
      </Detail>

      <Detail label="Provenance and limits">
        <Fact k="Samples returned"
              v={`${terrain.samples} of ${terrain.requested} (${terrain.gridN} × ${terrain.gridN})`} />
        <Fact k="Sample spacing" v={`${terrain.sampleSpacingM!.toFixed(0)} m`} />
        <Fact k="Source resolution"
              v={terrain.resolutionM ? `~${terrain.resolutionM.toFixed(0)} m` : undefined}
              state={terrain.resolutionM ? 'ok' : 'unavailable'}
              sub={terrain.resolutionM ? undefined : 'the source did not report one'} />
        <Fact k="Elevation source" v={terrain.sourceLabel} />
        <Fact k="Vertical datum" v={terrain.datum ?? undefined}
              state={terrain.datum ? 'ok' : 'unavailable'} />
        <p className="note">{terrain.resolutionNote}</p>
        {terrain.fallbackFrom && (
          <p className="note"><b>Fell back.</b> {terrain.fallbackFrom}. The figures above come
            from {terrain.sourceLabel} instead.</p>
        )}
        {terrain.warnings.map((w, i) => <p className="note" key={i}>{w}</p>)}
      </Detail>
    </>
  );
}

/* ---------------------------------------------------------------- nearby */

export function PoiSection({ p, radiusM = 2000 }: { p: Async<PoiResult>; radiusM?: number }) {
  const poi = p.data;
  const r = poi ? poi.radiusM : radiusM;

  if (p.err)
    return (
      <Failed what="Overpass (OpenStreetMap)" why={p.err}>
        This is a service failure. It says nothing about what is or is not nearby.
      </Failed>
    );

  if (p.busy && !poi)
    return <Waiting what="Overpass (up to 15 s, then it degrades rather than hangs)" />;
  if (!poi) return null;

  if (!poi.queried)
    return (
      <Failed what="Overpass (OpenStreetMap)" why={poi.error ?? 'no endpoint responded.'}>
        It is rate-limited and frequently slow, and was given 15 s across{' '}
        {poi.attempts.length} mirror{poi.attempts.length === 1 ? '' : 's'}. Try again in a
        minute.
      </Failed>
    );

  return (
    <>
      {poi.categories.map((c) => <Category key={c.kind} c={c} radiusM={r} />)}

      <p className="note">
        OpenStreetMap is contributor-maintained: coverage is dense in Australian cities
        and patchy on the fringe. A category marked <b>○ none mapped</b> means nothing of
        that kind is <i>recorded</i> here, not that nothing is here. Distances are
        straight-line from the sampled point, not walking or driving.
      </p>
      <p className="note">
        Answered by {hostOf(poi.endpoint)} in {(poi.elapsedMs / 1000).toFixed(1)} s,
        within {fmtRadius(r)}.
      </p>
    </>
  );
}

function Category({ c, radiusM }: { c: PoiCategory; radiusM: number }) {
  // Three states, three renderings. `unavailable` is the query for this
  // category failing; `empty` is Overpass answering with nothing mapped.
  if (c.status === 'unavailable')
    return <Fact k={c.label} state="unavailable" sub="this category was not returned" />;

  if (c.status === 'empty')
    return <Fact k={c.label} state="empty" v={`none mapped within ${fmtRadius(radiusM)}`} />;

  return (
    <>
      <Fact k={c.label} v={`${c.total} within ${fmtRadius(radiusM)}`} tone="ok" glyph="● " />
      {/* The count above IS the answer; the nearest one is the useful
          example. Everything past it is supporting detail and folds. */}
      <ShowAll
        items={c.items}
        initial={1}
        noun={`${c.label.toLowerCase()} returned`}
        render={(p, i) => (
          <div className="row sub-row" key={`${p.lat},${p.lng},${i}`}>
            <span>{p.name}{p.type ? ` · ${p.type.replace(/_/g, ' ')}` : ''}</span>
            <b>{p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`}</b>
          </div>
        )}
      />
    </>
  );
}

/* ----------------------------------------------------------------- atoms */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const fmtRadius = (m: number) =>
  (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km`);
const hostOf = (u: string | null) => {
  try { return u ? new URL(u).host : 'Overpass'; } catch { return 'Overpass'; }
};

/** Kept so the page's existing three-panel markup still type-checks while the
 *  content lives in the tabbed panel. It renders nothing on purpose: SitePanel
 *  owns the whole side column now, and a second copy here would fetch
 *  everything twice and put the reader back on the long scroll. */
export default function SiteIntel(_props: { point: { lat: number; lng: number } | null }) {
  return null;
}
