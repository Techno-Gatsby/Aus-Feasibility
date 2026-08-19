'use client';
import { useEffect, useState } from 'react';
// Type-only imports: lib/terrain reaches for node:zlib and lib/poi does
// network work, so neither may be bundled into the client. `import type` is
// erased at compile time, which is the whole point of it here.
import type { TerrainResult } from '@/lib/terrain';
import type { PoiResult, PoiCategory } from '@/lib/poi';

type Terrain = TerrainResult & { verdict?: string };

/** SITE INTELLIGENCE — terrain and neighbourhood, ported from the single-file
 *  build's `analyzeSite` / `aumap_site_intelligence` panel.
 *
 *  Two independent readings that fail independently: terrain can be ready
 *  while Overpass is timing out, so the panel has a partial state rather than
 *  an all-or-nothing spinner. Nothing here is presented as survey-grade and
 *  no slope figure is ever printed without the resolution it was measured at.
 */
export default function SiteIntel({
  point, halfM = 100, radiusM = 2000,
}: {
  point: { lat: number; lng: number } | null;
  /** Half-width of the sampled square, metres. 100 → a 200 m footprint. */
  halfM?: number;
  radiusM?: number;
}) {
  const [terrain, setTerrain] = useState<Terrain | null>(null);
  const [poi, setPoi] = useState<PoiResult | null>(null);
  const [tBusy, setTBusy] = useState(false);
  const [pBusy, setPBusy] = useState(false);
  const [tErr, setTErr] = useState<string | null>(null);
  const [pErr, setPErr] = useState<string | null>(null);

  useEffect(() => {
    if (!point) return;
    let dead = false;
    setTerrain(null); setPoi(null); setTErr(null); setPErr(null);
    setTBusy(true); setPBusy(true);

    fetch(`/api/terrain?lat=${point.lat}&lng=${point.lng}&half=${halfM}&n=6`)
      .then((r) => r.json())
      .then((j) => { if (!dead) setTerrain(j); })
      .catch((e) => { if (!dead) setTErr(String(e?.message ?? e)); })
      .finally(() => { if (!dead) setTBusy(false); });

    fetch(`/api/poi?lat=${point.lat}&lng=${point.lng}&radius=${radiusM}&limit=4`)
      .then((r) => r.json())
      .then((j) => { if (!dead) setPoi(j); })
      .catch((e) => { if (!dead) setPErr(String(e?.message ?? e)); })
      .finally(() => { if (!dead) setPBusy(false); });

    return () => { dead = true; };
  }, [point, halfM, radiusM]);

  if (!point)
    return (
      <aside className="panel">
        <h2>Site intelligence <span className="pill">Waiting</span></h2>
        <p className="muted">Pick a point on the map to sample terrain and search
          the surrounding neighbourhood.</p>
      </aside>
    );

  const busy = tBusy || pBusy;
  const terrainOk = !!terrain?.ok;
  const poiOk = !!poi?.queried;
  const status = busy ? 'Working'
    : terrainOk && poiOk ? 'Ready'
    : terrainOk || poiOk ? 'Partial'
    : 'Unavailable';
  const pill = status === 'Ready' ? 'pill ok'
    : status === 'Unavailable' ? 'pill bad' : 'pill';

  return (
    <aside className="panel">
      <h2>Site intelligence <span className={pill}>{status}</span></h2>
      {busy && (
        <p className="muted">
          {tBusy && pBusy ? 'Sampling elevation and searching OpenStreetMap…'
            : tBusy ? 'Sampling elevation…' : 'Searching OpenStreetMap…'}
        </p>
      )}

      <h3>Terrain and slope</h3>
      {tErr ? (
        <p className="bad">Terrain request failed: {tErr}. No slope figure is shown —
          an unmeasured site is not a flat one.</p>
      ) : tBusy && !terrain ? (
        <p className="muted">Sampling a 6 × 6 grid across the footprint…</p>
      ) : !terrain ? null : !terrain.ok ? (
        <>
          <Row k="Elevation source" v={terrain.sourceLabel} />
          <p className="alert"><b>No slope figure.</b> {terrain.reason}</p>
          <p className="note">{terrain.resolutionNote}</p>
        </>
      ) : (
        <>
          <Row k="Fall across site"
               v={`${terrain.fallM!.toFixed(1)} m over ${Math.round(terrain.spanM!)} m`} />
          <Row k="Average slope"
               v={`${terrain.slopePct!.toFixed(1)}%`}
               cls={terrain.slopePct! >= 8 ? 'bad' : terrain.slopePct! < 3 ? 'ok' : undefined} />
          <Row k="Grade" v={cap(terrain.grade!)} />
          <Row k="Cross-fall (fall ÷ diagonal)" v={`${terrain.crossFallPct!.toFixed(1)}%`} />
          <Row k="Falls toward"
               v={terrain.aspect ? `${terrain.aspect} (${Math.round(terrain.aspectDeg!)}°)` : 'no consistent direction'} />
          <Row k="Elevation range"
               v={`${terrain.minM!.toFixed(0)} – ${terrain.maxM!.toFixed(0)} m AHD approx.`} />
          <Row k="Mean elevation" v={`${terrain.meanM!.toFixed(1)} m`} />
          <Row k="Samples"
               v={`${terrain.samples} of ${terrain.requested} (${terrain.gridN} × ${terrain.gridN} grid)`} />
          <Row k="Sample spacing" v={`${terrain.sampleSpacingM!.toFixed(0)} m`} />
          <Row k="Source resolution"
               v={terrain.resolutionM ? `~${terrain.resolutionM.toFixed(0)} m` : 'not reported'} />
          <Row k="Elevation source" v={terrain.sourceLabel} />

          {terrain.verdict && (
            <p className={terrain.slopePct! >= 8 ? 'alert' : 'note'}>
              <b>{cap(terrain.grade!)} — {terrain.slopePct!.toFixed(1)}%.</b> {terrain.verdict}
            </p>
          )}

          {terrain.fallbackFrom && (
            <p className="note"><b>Fell back.</b> {terrain.fallbackFrom}. The figures above come
              from {terrain.sourceLabel} instead.</p>
          )}
          {terrain.warnings.map((w, i) => <p className="note" key={i}>{w}</p>)}

          {/* Resolution is not a footnote. It is the bound on every number above. */}
          <p className="note">
            <b>Resolution bounds this.</b> {terrain.resolutionNote}
            {' '}Sampled over a {Math.round(terrain.spanM!)} m diagonal at {terrain.sampleSpacingM!.toFixed(0)} m
            spacing, so anything smaller than that — a batter, a gully, a cut driveway —
            is invisible to it.
          </p>
        </>
      )}

      <h3>Nearby (OpenStreetMap, {poi ? fmtRadius(poi.radiusM) : fmtRadius(radiusM)})</h3>
      {pErr ? (
        <p className="bad">Overpass request failed: {pErr}. This is a service failure —
          it says nothing about what is or is not nearby.</p>
      ) : pBusy && !poi ? (
        <p className="muted">Querying Overpass (up to 15 s, then it degrades rather than hangs)…</p>
      ) : !poi ? null : !poi.queried ? (
        <>
          <p className="alert"><b>Overpass did not answer.</b> {poi.error}</p>
          <p className="note">Overpass is rate-limited and frequently slow, and it was given
            15 s across {poi.attempts.length} mirror{poi.attempts.length === 1 ? '' : 's'}.
            <b> No result is not the same as nothing nearby</b> — try again in a minute.</p>
        </>
      ) : (
        <>
          {poi.categories.map((c) => <Category key={c.kind} c={c} radiusM={poi.radiusM} />)}
          <p className="note">
            Answered by {hostOf(poi.endpoint)} in {(poi.elapsedMs / 1000).toFixed(1)} s.
            OpenStreetMap is contributor-maintained: coverage is dense in Australian cities
            and patchy on the fringe, so a category with nothing in it means nothing is
            <i> mapped</i> here, not that nothing is here. Distances are straight-line from
            the sampled point, not walking or driving.
          </p>
        </>
      )}
    </aside>
  );
}

function Category({ c, radiusM }: { c: PoiCategory; radiusM: number }) {
  if (c.status === 'unavailable')
    return <Row k={c.label} v="not returned" cls="bad" />;

  if (c.status === 'empty')
    return (
      <>
        <Row k={c.label} v={`none mapped within ${fmtRadius(radiusM)}`} />
      </>
    );

  return (
    <>
      <Row k={c.label}
           v={`${c.total} within ${fmtRadius(radiusM)}`} cls="ok" />
      {c.items.map((p, i) => (
        <div className="row" key={`${p.lat},${p.lng},${i}`}>
          <span style={{ paddingLeft: 12, color: 'var(--mute)' }}>
            {p.name}{p.type ? ` · ${p.type.replace(/_/g, ' ')}` : ''}
          </span>
          <b>{p.distanceM < 1000 ? `${p.distanceM} m` : `${(p.distanceM / 1000).toFixed(1)} km`}</b>
        </div>
      ))}
    </>
  );
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="row"><span>{k}</span><b className={cls}>{v}</b></div>;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const fmtRadius = (m: number) => (m < 1000 ? `${m} m` : `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km`);
const hostOf = (u: string | null) => { try { return u ? new URL(u).host : 'Overpass'; } catch { return 'Overpass'; } };
