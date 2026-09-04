'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { computeYield, DEFAULTS, type Assumptions } from '@/lib/yield';
import { LAYER_STYLE, type LayerVis } from '@/lib/mapStyle';

const SiteMap = dynamic(() => import('@/components/SiteMap'), { ssr: false });
const Terrain3D = dynamic(() => import('@/components/Terrain3D'), { ssr: false });
const StreetView = dynamic(() => import('@/components/StreetView'), { ssr: false });

const EXAMPLES = [
  { label: 'Prosper — 190 ac', propId: 2950861 },
  { label: 'Melissa — 324 ac', propId: 460174 },
  { label: 'Celina — 110 ac', propId: 964772 },
];

const TABS = ['Summary', 'Yield', 'Ground', 'Utilities', 'Market', 'Context'] as const;
type Tab = typeof TABS[number];

const n2 = (v: number) => v.toLocaleString(undefined, {
  minimumFractionDigits: 2, maximumFractionDigits: 2,
});
const money = (v?: number | null) =>
  v == null ? '—' : '$' + Math.round(v).toLocaleString();

export default function Page() {
  const [q, setQ] = useState('');
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [a, setA] = useState<Assumptions>(DEFAULTS);
  const [tab, setTab] = useState<Tab>('Summary');
  const [basemap, setBasemap] = useState<'map' | 'satellite' | 'terrain'>('satellite');
  const [view, setView] = useState<'2d' | '3d' | 'street'>('2d');
  const [exag, setExag] = useState(3);
  const [vis, setVis] = useState<LayerVis>({
    neighbours: true, parcel: true, sfha: true, water: true, wetlands: true,
    streams: true, pipelines: true, wells: true, grid: false,
  });

  const [sugs, setSugs] = useState<any[]>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const [hi, setHi] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  // Typeahead over owner names and situs addresses. Debounced, and every
  // response is checked against the latest keystroke so a slow earlier
  // request cannot overwrite a newer one.
  const seq = useRef(0);
  useEffect(() => {
    const s = q.trim();
    if (s.length < 3) { setSugs([]); return; }
    const mine = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/suggest?q=${encodeURIComponent(s)}`);
        const d = await r.json();
        if (mine === seq.current) { setSugs(d.suggestions ?? []); setHi(-1); }
      } catch { /* typing again will retry */ }
    }, 220);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setSugOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(s: any) {
    setSugOpen(false);
    setQ(s.label);
    if (s.propId != null) run(`propId=${s.propId}`);
    else if (s.latlon) run(`latlon=${s.latlon}`);
  }

  function onKey(e: React.KeyboardEvent) {
    if (!sugOpen || !sugs.length) {
      if (e.key === 'Enter') search();
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, sugs.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, -1)); }
    else if (e.key === 'Escape') setSugOpen(false);
    else if (e.key === 'Enter') {
      e.preventDefault();
      hi >= 0 ? pick(sugs[hi]) : search();
    }
  }

  // Clicking a neighbouring parcel replaces the whole analysis, so without a
  // history you get stranded on whatever you last tapped with no way back.
  const [history, setHistory] = useState<{ params: string; label: string }[]>([]);

  async function run(params: string, opts: { push?: boolean } = {}) {
    const push = opts.push !== false;
    if (push && data) {
      setHistory((h) => [
        ...h.slice(-9),
        { params: `propId=${data.parcel.propId}`, label: data.parcel.owner ?? 'Parcel' },
      ]);
    }
    setLoading(true); setErr(null); setData(null); setSugOpen(false);
    try {
      const res = await fetch(`/api/site?${params}`);
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error ?? 'Lookup failed');
      setData(d); setTab('Summary');
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function goBack() {
    const prev = history[history.length - 1];
    if (!prev) return;
    setHistory((h) => h.slice(0, -1));
    setQ(prev.label);
    run(prev.params, { push: false });
  }

  function clearAll() {
    setData(null); setErr(null); setQ(''); setHistory([]); setSugs([]);
  }

  function search() {
    const s = q.trim();
    if (!s) return;
    if (/^\d+$/.test(s)) return run(`propId=${s}`);
    if (/^-?\d+\.?\d*\s*,\s*-?\d+\.?\d*$/.test(s)) {
      return run(`latlon=${encodeURIComponent(s.replace(/\s/g, ''))}`);
    }
    return run(`address=${encodeURIComponent(s)}`);
  }

  const y = useMemo(
    () => (data ? computeYield(data.grid, data.parcel.grossAcres, a) : null),
    [data, a],
  );

  const p = data?.parcel;
  const reg = data?.regulatory;
  const ctx = data?.context;

  // Padded bbox of the parcel, for the 3D terrain sample window.
  const bbox3d = useMemo<[number, number, number, number] | null>(() => {
    if (!data?.parcel?.rings?.length) return null;
    const pts = (data.parcel.rings as [number, number][][]).flat();
    const xs = pts.map((v) => v[0]);
    const ys = pts.map((v) => v[1]);
    const pad = Math.max(
      (Math.max(...xs) - Math.min(...xs)) * 0.15,
      (Math.max(...ys) - Math.min(...ys)) * 0.15,
      0.0015,
    );
    return [Math.min(...xs) - pad, Math.min(...ys) - pad,
            Math.max(...xs) + pad, Math.max(...ys) + pad];
  }, [data]);

  const centre = data ? { lat: data.input.lat, lon: data.input.lon } : null;

  function openReport() {
    if (!p) return;
    const qs = new URLSearchParams({
      propId: String(p.propId),
      ...Object.fromEntries(Object.entries(a).map(([k, v]) => [k, String(v)])),
    });
    window.open(`/report?${qs}`, '_blank');
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Land Intel</h1>
          <span className="sub">Collin County, TX</span>
        </div>
        <div className="search" ref={boxRef}>
          <div className="sugwrap">
            <input
              value={q}
              placeholder="Owner name, address, property id, or lat,lon"
              autoComplete="off"
              onChange={(e) => { setQ(e.target.value); setSugOpen(true); }}
              onFocus={() => setSugOpen(true)}
              onKeyDown={onKey}
            />
            {sugOpen && sugs.length > 0 && (
              <ul className="sugs">
                {sugs.map((s, i) => (
                  <li key={`${s.propId}-${i}`}
                      className={i === hi ? 'on' : ''}
                      onMouseEnter={() => setHi(i)}
                      onMouseDown={(e) => { e.preventDefault(); pick(s); }}>
                    <span className={`tag ${s.kind}`}>{s.kind}</span>
                    <span className="sl">
                      <b>{s.label}</b>
                      {s.sub && <em>{s.sub}</em>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <button onClick={search} disabled={loading}>
            {loading ? 'Analysing…' : 'Analyse'}
          </button>
        </div>
        <div className="examples">
          {EXAMPLES.map((e) => (
            <button key={e.propId} className="chip"
                    onClick={() => { setQ(String(e.propId)); run(`propId=${e.propId}`); }}>
              {e.label}
            </button>
          ))}
        </div>
      </header>

      <div className="body">
        <section className="mapwrap">
          {/* All five stay visible and enabled at all times. Hiding the 2D
              buttons while in 3D/Street left no way back, and disabling
              3D/Street before a tract is chosen just looked broken — the
              views themselves explain what to do. */}
          <div className="basemap">
            {(['map', 'satellite', 'terrain'] as const).map((b) => (
              <button key={b}
                      className={view === '2d' && basemap === b ? 'on' : ''}
                      onClick={() => { setBasemap(b); setView('2d'); }}>
                {b === 'map' ? 'Map' : b === 'satellite' ? 'Satellite' : 'Relief'}
              </button>
            ))}
            <button className={view === '3d' ? 'on' : ''}
                    onClick={() => setView('3d')}
                    title="3D terrain from USGS elevation">
              3D
            </button>
            <button className={view === 'street' ? 'on' : ''}
                    onClick={() => setView('street')}
                    title="Google Street View">
              Street
            </button>
          </div>

          {view === 'street' ? (
            <StreetView lat={centre?.lat ?? null} lon={centre?.lon ?? null} />
          ) : view === '3d' ? (
            <Terrain3D
              bbox={bbox3d}
              rings={data?.parcel.rings ?? []}
              verticalExaggeration={exag}
            />
          ) : (
            <SiteMap
              data={data} vis={vis} basemap={basemap}
              streamBufferFt={a.streamBufferFt} maxSlopePct={a.maxSlopePct}
              onPickParcel={(id) => { setQ(String(id)); run(`propId=${id}`); }}
            />
          )}

          {view === 'street' ? null : view === '3d' ? (
            <div className="legend">
              <label className="exag">
                Vertical exaggeration <b>{exag}×</b>
                <input type="range" min={1} max={10} step={1} value={exag}
                       onChange={(e) => setExag(Number(e.target.value))} />
              </label>
              <span className="fine">
                Real ground shape from USGS 3DEP — not photography.
              </span>
            </div>
          ) : (
          <div className="legend">
            {Object.entries(LAYER_STYLE).map(([k, s]) => (
              <label key={k}>
                <input type="checkbox" checked={vis[k as keyof LayerVis]}
                       onChange={(e) =>
                         setVis({ ...vis, [k]: e.target.checked } as LayerVis)} />
                <i style={{ background: s.color }} />
                {s.label}
              </label>
            ))}
          </div>
          )}
        </section>

        <aside className="panel">
          {err && <div className="err">{err}</div>}
          {loading && (
            <div className="note">
              Querying public map services and sampling USGS elevation.
              First look at a tract takes 30–90 s; repeats are cached and
              return in seconds.
            </div>
          )}

          {!data && !loading && !err && (
            <div className="empty">
              <p>Search a tract, or pick an example above.</p>
              <p className="fine">
                Zoom past street level and every surrounding parcel is drawn —
                hover for owner and acreage, click to analyse it.
              </p>
              <p className="fine">
                <b>Coverage:</b> parcels, ownership and zoning are wired to
                Collin County only. Wetlands, soils, elevation and flood are
                already nationwide — parcels are the county-by-county part.
              </p>
              <p className="fine">
                All free and public: Collin CAD, Town of Prosper, Collin County,
                FEMA NFHL, USFWS wetlands, USDA soils, USGS elevation, Texas
                PUC water/sewer CCN, Texas Railroad Commission.
              </p>
            </div>
          )}

          {p && y && (
            <>
              <div className="phead">
                <div className="navbar">
                  <button className="ghost" onClick={goBack}
                          disabled={!history.length}
                          title={history.length
                            ? `Back to ${history[history.length - 1].label}`
                            : 'No previous parcel'}>
                    ← Back
                  </button>
                  <button className="ghost" onClick={clearAll}>Clear</button>
                  {history.length > 0 && (
                    <span className="crumb">
                      from {history[history.length - 1].label}
                    </span>
                  )}
                </div>
                <h2>{p.owner ?? 'Parcel'}</h2>
                <p className="legal">{p.legal}</p>
                <div className="headline">
                  <div><b>{n2(p.grossAcres)}</b><span>gross ac</span></div>
                  <div><b>{n2(y.netDevelopableAcres)}</b><span>net dev ac</span></div>
                  <div><b>{y.indicativeUnits}</b><span>units</span></div>
                </div>
                <button className="report" onClick={openReport}>
                  Generate Investment Note →
                </button>
                {centre && (
                  <div className="extlinks">
                    <a target="_blank" rel="noopener noreferrer"
                       href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${centre.lat},${centre.lon}`}>
                      Street View ↗
                    </a>
                    <a target="_blank" rel="noopener noreferrer"
                       href={`https://earth.google.com/web/@${centre.lat},${centre.lon},0a,1200d,35y,0h,55t,0r`}>
                      Google Earth 3D ↗
                    </a>
                  </div>
                )}
              </div>

              <nav className="tabs">
                {TABS.map((t) => (
                  <button key={t} className={tab === t ? 'on' : ''}
                          onClick={() => setTab(t)}>{t}</button>
                ))}
              </nav>

              {tab === 'Summary' && (
                <>
                  <dl className="kv">
                    <dt>Property id</dt><dd>{p.propId ?? '—'}</dd>
                    <dt>Source</dt><dd>{p.source}</dd>
                    <dt>City limits</dt><dd>{reg.cityLimits ?? 'unincorporated'}</dd>
                    <dt>School district</dt><dd>{reg.schoolDistrict ?? '—'}</dd>
                    <dt>Zoning</dt>
                    <dd>{reg.zoning
                      ? `${reg.zoning.zone ?? '—'}${reg.zoning.pd ? ` · ${reg.zoning.pd}` : ''}`
                      : reg.zoningStatus === 'outside-city'
                        ? 'unincorporated — no zoning'
                        : 'not published as GIS'}</dd>
                    {reg.zoning?.class && (
                      <>
                        <dt>District</dt><dd>{reg.zoning.class}</dd>
                      </>
                    )}
                    {reg.zoningSource && (
                      <>
                        <dt>Zoning source</dt><dd>{reg.zoningSource}</dd>
                      </>
                    )}
                    <dt>Future land use</dt><dd>{reg.futureLandUse ?? '—'}</dd>
                    {p.cadMarketValue != null && (
                      <>
                        <dt>CAD market value</dt><dd>{money(p.cadMarketValue)}</dd>
                      </>
                    )}
                  </dl>
                  {p.cadMarketValue != null && (
                    <p className="warn">
                      Assessed value, <b>not</b> a sale price. Texas is a
                      non-disclosure state — sale prices are not public record.
                    </p>
                  )}
                  {p.cadAgExemptAcres ? (
                    <p className="warn">
                      {n2(p.cadAgExemptAcres)} ac under agricultural exemption.
                      Ag rollback tax (3 years plus interest) triggers on change
                      of use — price it in.
                    </p>
                  ) : null}
                  {reg.zoning?.pd && (
                    <p className="warn">
                      Planned Development {reg.zoning.pd}
                      {reg.zoning.ordinances?.length
                        ? ` (ord. ${reg.zoning.ordinances.join(', ')})` : ''}.
                      Each PD carries its own negotiated setbacks, lot mix and
                      density — no zoning API exposes them. Read the ordinance.
                    </p>
                  )}
                  {!reg.zoning && reg.zoningStatus === 'not-published' && (
                    <p className="warn">
                      <b>{reg.cityLimits} does not publish zoning as GIS.</b>{' '}
                      Treat this as <b>unknown</b>, not unzoned — the tract is
                      inside city limits and is almost certainly zoned. Request
                      the shapefile by Public Information Request (10-day
                      statutory response), or read the adopted zoning map.
                    </p>
                  )}
                  {!reg.zoning && reg.zoningStatus === 'outside-city' && (
                    <p className="warn">
                      Unincorporated — <b>Texas counties have no zoning
                      authority</b>, so there is genuinely nothing to look up.
                      Development is governed by county subdivision/plat rules,
                      city ETJ platting authority, and recorded deed
                      restrictions instead.
                    </p>
                  )}
                </>
              )}

              {tab === 'Yield' && (
                <>
                  <p className="fine">
                    Every control below recomputes instantly — no re-query.
                  </p>
                  {([
                    ['streamBufferFt', 'Stream buffer', 0, 200, 5, 'ft'],
                    ['maxSlopePct', 'Max buildable slope', 5, 30, 1, '%'],
                    ['rowPct', 'Street / ROW take', 0, 40, 1, '%'],
                    ['openSpacePct', 'Open space dedication', 0, 40, 1, '%'],
                    ['density', 'Density', 0.5, 12, 0.1, ' units/ac'],
                  ] as const).map(([k, label, min, max, step, unit]) => (
                    <label key={k} className="slider">
                      <span>{label}<b>{a[k]}{unit}</b></span>
                      <input type="range" min={min} max={max} step={step}
                             value={a[k]}
                             onChange={(e) =>
                               setA({ ...a, [k]: Number(e.target.value) })} />
                    </label>
                  ))}

                  <h3>Constraints</h3>
                  <table className="tbl">
                    <tbody>
                      {y.perLayer.map((l) => (
                        <tr key={l.key}>
                          <td>
                            <i style={{
                              background: LAYER_STYLE[
                                l.key === 'sfha' ? 'sfha'
                                  : l.key === 'wetland' ? 'wetlands'
                                  : l.key === 'stream' ? 'streams'
                                  : l.key === 'steep' ? 'grid' : 'water'
                              ].color,
                            }} />
                            {l.label}
                          </td>
                          <td className="num">{n2(l.acres)} ac</td>
                        </tr>
                      ))}
                      <tr className="strong">
                        <td>Combined (union)</td>
                        <td className="num">{n2(y.unionAcres)} ac</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="fine">
                    Layers overlap — summing them would give{' '}
                    {n2(y.sumIfDoubleCounted)} ac. The union is what comes off
                    gross.
                  </p>
                  {Object.entries(data.coverage).some(
                    ([, v]) => v === 'NO COVERAGE') && (
                    <p className="warn">
                      One or more layers have no coverage here. Treat those as
                      <b> unknown</b>, not zero.
                    </p>
                  )}

                  <h3>Net developable</h3>
                  <table className="tbl">
                    <tbody>
                      <tr><td>Gross</td><td className="num">{n2(y.grossAcres)} ac</td></tr>
                      {y.deductions.map((d) => (
                        <tr key={d.item} className="ded">
                          <td>less {d.item}</td>
                          <td className="num">−{n2(d.acres)} ac</td>
                        </tr>
                      ))}
                      <tr className="total">
                        <td>Net developable</td>
                        <td className="num">{n2(y.netDevelopableAcres)} ac</td>
                      </tr>
                      <tr>
                        <td>Efficiency</td>
                        <td className="num">{y.efficiencyPct.toFixed(1)}%</td>
                      </tr>
                      <tr className="total">
                        <td>Indicative units</td>
                        <td className="num">{y.indicativeUnits}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="fine">
                    Indicative only. Actual yield is governed by the controlling
                    ordinance lot mix, not a blended density.
                  </p>
                </>
              )}

              {tab === 'Ground' && (
                <>
                  <h3>Soils</h3>
                  <p>
                    Shrink-swell: <b>{data.soils.shrinkSwell}</b>
                    {data.soils.maxLep != null && ` (max LEP ${data.soils.maxLep}%)`}
                  </p>
                  <ul className="list">
                    {[...new Map(
                      data.soils.units.map((u: any) => [u.mapUnit, u]),
                    ).values()].slice(0, 10).map((u: any) => (
                      <li key={u.mapUnit}>
                        {u.mapUnit}
                        {u.plasticityIndex ? ` · PI ${Math.round(u.plasticityIndex)}` : ''}
                        {u.hydroGroup ? ` · HSG ${u.hydroGroup}` : ''}
                      </li>
                    ))}
                  </ul>
                  {['high', 'very high'].includes(data.soils.shrinkSwell) && (
                    <p className="warn">
                      High shrink-swell clay. Drives foundation design and cost —
                      get a geotechnical report before pricing.
                    </p>
                  )}
                  {data.terrain?.reliefFt != null && (
                    <>
                      <h3>Terrain</h3>
                      <dl className="kv">
                        <dt>Relief</dt><dd>{n2(data.terrain.reliefFt)} ft</dd>
                        <dt>Mean slope</dt><dd>{data.terrain.meanSlopePct.toFixed(2)}%</dd>
                        <dt>p90 slope</dt><dd>{data.terrain.p90SlopePct.toFixed(2)}%</dd>
                        <dt>Samples</dt>
                        <dd>{data.terrain.samples} @ ~{data.terrain.sampleSpacingFt} ft</dd>
                      </dl>
                      <p className="fine">
                        Screening resolution — localised steep creek banks are
                        smoothed out at this spacing.
                      </p>
                    </>
                  )}
                </>
              )}

              {tab === 'Utilities' && (
                <>
                  <h3>Water &amp; sewer (PUC CCN)</h3>
                  <p className="fine">
                    A CCN is the legal right <b>and obligation</b> to serve. In
                    exurban Texas this question kills more deals than anything
                    else on the map.
                  </p>
                  {(['water', 'sewer'] as const).map((k) => {
                    const u = data.utilities[k];
                    return (
                      <div key={k}>
                        <dl className="kv">
                          <dt style={{ textTransform: 'capitalize' }}>{k}</dt>
                          <dd>
                            {u.status === 'QUERY FAILED' ? 'query failed'
                              : u.holders.length
                                ? u.holders.map((h: any) => h.utility).join(', ')
                                : 'none'}
                          </dd>
                        </dl>
                        {u.status === 'ok' && u.holders.length === 0 && (
                          <p className="warn">
                            <b>No {k} CCN over this tract.</b> No retail provider
                            is obligated to serve it. Expect to extend service,
                            petition for a CCN, or go on-site — a material cost
                            and timing item, not a footnote.
                          </p>
                        )}
                        {u.holders.length > 1 && (
                          <p className="warn">
                            {u.holders.length} overlapping {k} CCNs — confirm
                            which actually serves the tract.
                          </p>
                        )}
                        {u.status === 'QUERY FAILED' && (
                          <p className="warn">
                            {k} CCN query failed — verify manually rather than
                            reading this as “none”.
                          </p>
                        )}
                      </div>
                    );
                  })}

                  <h3>Mineral estate</h3>
                  <p className="fine">
                    In Texas the mineral estate is <b>dominant</b> — a severed
                    mineral owner may enter and drill over the surface owner.
                  </p>
                  <dl className="kv">
                    <dt>Pipelines crossing</dt><dd>{ctx.pipelinesCrossing.length}</dd>
                    <dt>Pipelines ≤ 0.5 mi</dt><dd>{ctx.pipelinesWithinHalfMile}</dd>
                    <dt>Wells ≤ 0.5 mi</dt><dd>{ctx.wells.length}</dd>
                  </dl>
                  {ctx.pipelinesCrossing.map((pp: any, i: number) => (
                    <p key={i} className="warn">
                      {pp.operator} · {pp.commodity} · {pp.diameterIn}″ · {pp.status}
                    </p>
                  ))}
                  {(ctx.wellQueryFailed?.length || ctx.pipelineQueryFailed) && (
                    <p className="warn">
                      Some Railroad Commission queries failed — verify manually
                      rather than reading this as zero.
                    </p>
                  )}
                  <p className="fine">
                    Shows what is permitted and mapped, not who owns the
                    minerals. That is a title question.
                  </p>
                </>
              )}

              {tab === 'Market' && (
                <>
                  <h3>Traffic (TxDOT AADT)</h3>
                  {data.traffic.status === 'QUERY FAILED' ? (
                    <p className="warn">
                      TxDOT query failed — verify manually rather than reading
                      this as no traffic data.
                    </p>
                  ) : data.traffic.routes.length ? (
                    <>
                      <table className="tbl">
                        <tbody>
                          {data.traffic.routes.map((r: any) => (
                            <tr key={r.route}>
                              <td>{r.route}</td>
                              <td className="num">
                                {r.aadt.toLocaleString()} vpd
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="fine">
                        Annual average daily traffic on routes within ~0.5 mi,
                        busiest reading per route. Frontage volume drives retail
                        viability and access/deceleration-lane requirements.
                      </p>
                    </>
                  ) : (
                    <p className="fine">
                      No TxDOT-counted routes within ~0.5 mi. TxDOT counts
                      state-maintained roads and many county roads, but not
                      every local street — absence here is not zero traffic.
                    </p>
                  )}

                  <h3>Demographics (Census ACS)</h3>
                  {data.demographics.status !== 'ok' ? (
                    <p className="warn">{data.demographics.message}</p>
                  ) : (
                    <>
                      <p className="fine">
                        {data.demographics.tract} · {data.demographics.county}
                      </p>
                      <table className="tbl">
                        <tbody>
                          {[
                            ['Population (tract)', data.demographics.tractStats.population?.toLocaleString()],
                            ['Median household income', money(data.demographics.tractStats.medianHouseholdIncome)],
                            ['Median home value', money(data.demographics.tractStats.medianHomeValue)],
                            ['Median gross rent', money(data.demographics.tractStats.medianGrossRent)],
                            ['Median age', data.demographics.tractStats.medianAge],
                            ['Owner-occupied', data.demographics.ownerOccupiedPct != null ? `${data.demographics.ownerOccupiedPct}%` : '—'],
                            ['Vacancy', data.demographics.vacancyPct != null ? `${data.demographics.vacancyPct}%` : '—'],
                            ["Bachelor's+", data.demographics.bachelorsPct != null ? `${data.demographics.bachelorsPct}%` : '—'],
                          ].map(([k, v]) => (
                            <tr key={String(k)}>
                              <td>{k}</td><td className="num">{v ?? '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <h3>County benchmark</h3>
                      <table className="tbl">
                        <tbody>
                          <tr>
                            <td>County population</td>
                            <td className="num">
                              {data.demographics.countyStats.population?.toLocaleString() ?? '—'}
                            </td>
                          </tr>
                          <tr>
                            <td>Change since 2018</td>
                            <td className="num">
                              {data.demographics.countyPopulationChangePct != null
                                ? `${data.demographics.countyPopulationChangePct > 0 ? '+' : ''}${data.demographics.countyPopulationChangePct}%`
                                : '—'}
                            </td>
                          </tr>
                          <tr>
                            <td>County median income</td>
                            <td className="num">
                              {money(data.demographics.countyStats.medianHouseholdIncome)}
                            </td>
                          </tr>
                          <tr>
                            <td>County median home value</td>
                            <td className="num">
                              {money(data.demographics.countyStats.medianHomeValue)}
                            </td>
                          </tr>
                        </tbody>
                      </table>
                      <p className="fine">
                        ACS 5-year estimates — a rolling average, so they lag a
                        fast-growing exurb. Median home value is self-reported
                        by households, not a transaction price.
                      </p>
                    </>
                  )}
                </>
              )}

              {tab === 'Context' && (
                <>
                  <dl className="kv">
                    <dt>Thoroughfare crossing site</dt>
                    <dd>{ctx.thoroughfareCrossing}</dd>
                    <dt>Outer Loop within 2 mi</dt>
                    <dd>{ctx.outerLoopWithin2mi}</dd>
                  </dl>
                  <h3>Nearby applications ({ctx.nearbyDevelopments.length})</h3>
                  {ctx.nearbyDevelopments.length ? (
                    <ul className="list">
                      {ctx.nearbyDevelopments.slice(0, 20).map((d: any, i: number) => (
                        <li key={i}>
                          {Object.values(d).find((v) => typeof v === 'string') as string}
                        </li>
                      ))}
                    </ul>
                  ) : <p className="fine">None mapped within ~1 mile.</p>}
                </>
              )}
            </>
          )}
        </aside>
      </div>
    </div>
  );
}
