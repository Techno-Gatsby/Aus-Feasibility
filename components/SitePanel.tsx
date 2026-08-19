'use client';
import { useMemo, useState } from 'react';
import {
  Fact, Failed, Waiting, ShowAll, Detail, SiteTabStrip,
  useJson, type Async, type TabDef, type FactState,
} from '@/components/SiteTabs';
import {
  useTerrain, usePoi, TerrainSection, PoiSection, terrainBadge, poiBadge, fmtRadius,
} from '@/components/SiteIntel';
import {
  useDemographics, useContamination, DemographicsSection, ContaminationSection,
  contamBadge, CONTAM_RADIUS_M,
} from '@/components/AreaPanel';

/** THE SITE PANEL — one panel, five tabs, beside the map.
 *
 *  It used to be three panels stacked in a column: Site, then Site
 *  intelligence, then Area. Populated, that column ran to about three and a
 *  half screens, and the reader had to scroll past terrain to reach
 *  contamination. It is now grouped the way someone actually asks the
 *  questions —
 *
 *      Parcel & planning · Hazard · Terrain · Neighbourhood · Value & sales
 *
 *  — with the answer (zone, area, hazard flags, slope) pinned above the tabs
 *  so it is legible without opening anything, and the supporting detail folded
 *  behind disclosures inside each tab.
 *
 *  Every reading is still fetched on the point change, not on the tab change:
 *  the tab badges have to be able to say "2 flagged" or "not returned" before
 *  you open them, and a hazard you never clicked on is exactly the one that
 *  must not stay hidden.
 */

type Pt = { lat: number; lng: number };

type Hazard = {
  flood?: boolean; bushfire?: boolean; bushfireCategory?: string | number | null;
  bushfireNearby?: boolean; landslide?: boolean; biodiversity?: boolean;
};

type Site = {
  state: string | null;
  stateName?: string | null;
  supported: boolean;
  message?: string;
  parcel: { lotId: string | null; areaM2: number | null; areaHa: number | null;
            urbanity: string | null; ownership: string } | null;
  zoning: string | null;
  zoningEpi: string | null;
  hazard?: Hazard;
  available?: string[];
  source?: string | null;
  coverage?: string[];
  errors?: Record<string, string>;
};

type StreetView =
  | { available: true; heading: number; distance: number; image: string; note: string }
  | { available: false; reason: string };

type ValueSeries = { at: string | null; value: number | null };
type Valuation =
  | { available: false; reason: string }
  | {
      available: true;
      propid: string | null;
      subject: { address: string | null; zone: string | null; areaM2: number | null;
                 basis: string | null; series: ValueSeries[] } | null;
      comparables: { address: string | null; price: number | null;
                     date: string | number | null; areaM2: number | null }[];
      comparableCount: number;
      medianRatePerM2: number | null;
      radiusM: number;
      note: string;
    };

const TERRAIN_HALF_M = 100;
const POI_RADIUS_M = 2000;

export default function SitePanel({ point }: { point: Pt | null }) {
  const [tab, setTab] = useState('parcel');

  const qs = point ? `lat=${point.lat}&lng=${point.lng}` : null;
  const site = useJson<Site>(qs ? `/api/site?${qs}` : null);
  const sv = useJson<StreetView>(qs ? `/api/streetview?${qs}` : null);
  const val = useJson<Valuation>(qs ? `/api/value?${qs}` : null);
  const terrain = useTerrain(point, TERRAIN_HALF_M);
  const poi = usePoi(point, POI_RADIUS_M);
  const demo = useDemographics(point);
  const contam = useContamination(point, CONTAM_RADIUS_M);

  const d = site.data;
  const errors = d?.errors ?? {};
  const available = d?.available ?? [];

  /** The four-state resolver every planning and hazard row goes through.
   *  Nothing may reach the screen without passing here, because this is the
   *  only place that knows the difference between "the layer said no" and
   *  "the layer never answered". */
  const stateOf = useMemo(() => (purpose: string, present: boolean | undefined): FactState => {
    if (errors[purpose]) return 'unavailable';
    if (d && !available.includes(purpose)) return 'na';
    if (!d) return 'unavailable';
    // Present and absent are BOTH real answers from a layer that replied.
    // Which of the two it is decides the glyph and tone at the call site.
    void present;
    return 'ok';
  }, [d, errors, available]);

  const h = d?.hazard ?? {};
  const HAZARDS: { purpose: string; label: string; on: boolean | undefined }[] = [
    { purpose: 'flood', label: 'Flood planning area', on: h.flood },
    { purpose: 'bushfire', label: 'Bush fire prone land', on: h.bushfire },
    { purpose: 'landslide', label: 'Landslide risk', on: h.landslide },
    { purpose: 'biodiversity', label: 'Biodiversity values', on: h.biodiversity },
  ];

  const flagged = HAZARDS.filter((x) => stateOf(x.purpose, x.on) === 'ok' && x.on);
  const unread = HAZARDS.filter((x) => stateOf(x.purpose, x.on) === 'unavailable');
  const notPublished = HAZARDS.filter((x) => stateOf(x.purpose, x.on) === 'na');

  const tb = terrainBadge(terrain);
  const pb = poiBadge(poi);
  const cb = contamBadge(contam);

  const zoneState: FactState =
    errors.zoning ? 'unavailable'
      : d?.zoning ? 'ok'
      : d && available.includes('zoning') ? 'empty'
      : d ? 'na' : 'unavailable';

  const hazardBadge =
    site.busy ? '…'
      : site.err ? 'not returned'
      : flagged.length ? `${flagged.length} flagged`
      : unread.length ? `${unread.length} not returned`
      : d ? 'none flagged' : null;

  const tabs: TabDef[] = [
    {
      id: 'parcel', label: 'Parcel & planning',
      badge: site.busy ? '…' : zoneState === 'ok' ? d!.zoning : zoneState === 'empty' ? 'no zone'
        : zoneState === 'unavailable' ? 'not returned' : null,
      tone: zoneState === 'unavailable' ? 'bad' : null,
    },
    {
      id: 'hazard', label: 'Hazard',
      badge: hazardBadge,
      tone: flagged.length || unread.length || site.err ? 'bad' : null,
    },
    { id: 'terrain', label: 'Terrain', badge: tb.badge, tone: tb.tone },
    {
      id: 'hood', label: 'Neighbourhood',
      badge: cb.tone === 'bad' ? cb.badge : pb.badge,
      tone: cb.tone ?? pb.tone,
    },
    {
      id: 'value', label: 'Value & sales',
      badge: val.busy ? '…'
        : val.err ? 'not returned'
        : val.data && !val.data.available ? 'NSW only'
        : val.data?.available && val.data.medianRatePerM2
          ? `$${Math.round(val.data.medianRatePerM2).toLocaleString('en-AU')}/m²`
          : null,
      tone: val.err ? 'bad' : null,
    },
  ];

  /* ------------------------------------------------------- nothing picked */

  if (!point)
    return (
      <aside className="panel site-panel">
        <div className="site-head">
          <h2>Site intelligence</h2>
          <p className="muted">Search for a site, or click the map. Every section below is
            read live from its own source, and each one reports separately whether it
            answered.</p>
        </div>
        <SiteTabStrip tabs={tabs.map((t) => ({ ...t, badge: null }))} active={tab} onSelect={setTab} />
        <ul className="waiting-list">
          <li><b>Parcel &amp; planning</b> — lot and plan, surveyed area, zone and the
            instrument it comes from, and a <b>Street View</b> photo of the frontage.</li>
          <li><b>Hazard</b> — flood planning, bush fire prone land, landslide and
            biodiversity values.</li>
          <li><b>Terrain</b> — a sampled slope reading with its grid, spacing and source
            resolution.</li>
          <li><b>Neighbourhood</b> — schools, shops, transport and hospitals within{' '}
            {fmtRadius(POI_RADIUS_M)}, ABS catchment demographics, and the NSW EPA
            contaminated-land register within {(CONTAM_RADIUS_M / 1000).toFixed(1)} km.</li>
          <li><b>Value &amp; sales</b> — Valuer General land value and recorded
            transactions nearby (NSW).</li>
        </ul>
      </aside>
    );

  /* --------------------------------------------------------- hard failures */

  if (site.err)
    return (
      <aside className="panel site-panel">
        <div className="site-head"><h2>Site intelligence</h2></div>
        <Failed what="The planning and hazard lookup" why={site.err} />
      </aside>
    );

  if (d && !d.supported)
    return (
      <aside className="panel site-panel">
        <div className="site-head"><h2>Site intelligence</h2></div>
        <p className="alert"><b>⚠ Not covered.</b> {d.message}</p>
      </aside>
    );

  /* ------------------------------------------------------------ the panel */

  const areaHa = d?.parcel?.areaHa ?? null;

  return (
    <aside className="panel site-panel">
      <div className="site-head">
        <h2>
          Site intelligence
          {site.busy && <span className="pill">Reading</span>}
        </h2>

        {/* The answer, above everything. Four facts, each with a word for its
            state — not a colour on its own. */}
        <div className="ans-strip">
          <AnsCell k="Zone"
                   v={zoneState === 'ok' ? d!.zoning!
                     : zoneState === 'empty' ? '○ none mapped'
                     : zoneState === 'na' ? '– not published'
                     : '⚠ not returned'}
                   tone={zoneState === 'unavailable' ? 'bad' : undefined} />
          <AnsCell k="Lot area"
                   v={areaHa != null ? `${areaHa.toFixed(3)} ha`
                     : errors.cadastre ? '⚠ not returned'
                     : d?.parcel ? '○ not stated'
                     : '○ no lot here'}
                   tone={errors.cadastre ? 'bad' : undefined} />
          <AnsCell k="Hazard"
                   v={flagged.length ? `⚠ ${flagged.length} flagged`
                     : unread.length ? `⚠ ${unread.length} not returned`
                     : d ? '✓ none flagged' : '…'}
                   tone={flagged.length || unread.length ? 'bad' : flagged.length === 0 && d ? 'ok' : undefined} />
          <AnsCell k="Slope"
                   v={terrain.busy ? '…'
                     : tb.badge === 'not returned' || tb.badge === 'no figure' ? `⚠ ${tb.badge}`
                     : tb.badge ?? '—'}
                   tone={tb.tone ?? undefined} />
        </div>

        <SiteTabStrip tabs={tabs} active={tab} onSelect={setTab} />
      </div>

      <div className="site-body" role="tabpanel">
        {site.busy && !d && <Waiting what="the state planning and hazard services" />}

        {tab === 'parcel' && d && (
          <>
            {d.parcel ? (
              <>
                <Fact k="Lot / plan" v={d.parcel.lotId ?? undefined}
                      state={d.parcel.lotId ? 'ok' : 'empty'} />
                <Fact k="Surveyed area"
                      v={areaHa != null ? `${areaHa.toFixed(3)} ha` : undefined}
                      state={areaHa != null ? 'ok' : 'empty'}
                      sub={areaHa != null ? `${Math.round(d.parcel.areaM2!).toLocaleString('en-AU')} m²` : undefined} />
              </>
            ) : errors.cadastre ? (
              <Fact k="Cadastral lot" state="unavailable" sub={errors.cadastre} />
            ) : (
              <Fact k="Cadastral lot" state="empty"
                    v="no lot at this point"
                    sub="road or water reserve, or outside the cadastre" />
            )}

            <Fact k="Zone"
                  v={zoneState === 'ok' ? d.zoning! : undefined}
                  state={zoneState}
                  sub={zoneState === 'unavailable' ? errors.zoning : undefined} />
            {d.zoningEpi && <Fact k="Instrument" v={d.zoningEpi} />}

            <StreetViewBlock sv={sv} />

            <p className="note">
              <b>Ownership is not public.</b> A title search is paid, per search, through the
              state land registry — this tool cannot tell you who owns the land.
              {d.parcel?.lotId ? <> Order it on <b>{d.parcel.lotId}</b> when you are ready to
                approach the owner.</> : null}
            </p>

            <Detail label="Which services answered">
              <ServiceLog d={d} />
            </Detail>
          </>
        )}

        {tab === 'hazard' && d && (
          <>
            {flagged.length === 0 && unread.length === 0 && notPublished.length === 0 && (
              <p className="note state-empty">
                <b>✓ Every hazard layer answered, and none of them place this point inside a
                  mapped area.</b> That is a statement about the mapped layers only. It is not
                a site investigation, and layers are amended.
              </p>
            )}

            {HAZARDS.map((x) => {
              const st = stateOf(x.purpose, x.on);
              if (st === 'unavailable')
                return <Fact key={x.purpose} k={x.label} state="unavailable"
                             sub={errors[x.purpose]} />;
              if (st === 'na')
                return <Fact key={x.purpose} k={x.label} state="na"
                             sub="no layer is published for this state" />;
              if (x.purpose === 'bushfire')
                return (
                  <Fact key={x.purpose} k={x.label}
                        v={x.on
                          ? `Yes${h.bushfireCategory != null ? ` — category ${h.bushfireCategory}` : ''}`
                          : h.bushfireNearby ? 'Not here, but mapped nearby'
                          : 'Outside the mapped area'}
                        tone={x.on ? 'bad' : h.bushfireNearby ? undefined : 'ok'}
                        glyph={x.on ? '⚠ ' : h.bushfireNearby ? '◐ ' : '✓ '} />
                );
              return (
                <Fact key={x.purpose} k={x.label}
                      v={x.on ? 'Yes' : 'Outside the mapped area'}
                      tone={x.on ? 'bad' : 'ok'}
                      glyph={x.on ? '⚠ ' : '✓ '} />
              );
            })}

            {unread.length > 0 && (
              <Failed
                what={`${unread.length} hazard layer${unread.length === 1 ? '' : 's'}`}
                why={unread.map((x) => `${x.label}: ${errors[x.purpose]}`).join(' · ')}
              />
            )}

            {h.bushfire && (
              <p className="alert"><b>⚠ Bush fire prone.</b> Triggers Planning for Bushfire
                Protection — asset protection zones and construction standards, and often a
                real reduction in developable area.</p>
            )}
            {h.biodiversity && (
              <p className="alert"><b>⚠ On the Biodiversity Values Map.</b> The Offset Scheme
                applies; credits are routinely the largest unbudgeted line on a greenfield
                deal.</p>
            )}
            {h.flood && (
              <p className="alert"><b>⚠ In a flood planning area.</b> Expect a flood study,
                a minimum floor level and, on the worse sites, a limit on the form of
                development rather than a cost adjustment.</p>
            )}

            <p className="note">
              A hazard shown as <b>✓ outside the mapped area</b> means the published layer
              was asked and does not cover this point. It is not a certification, and a
              layer that did not answer is listed separately above.
            </p>
          </>
        )}

        {tab === 'terrain' && <TerrainSection t={terrain} halfM={TERRAIN_HALF_M} />}

        {tab === 'hood' && (
          <>
            <h3>Contaminated land ({(CONTAM_RADIUS_M / 1000).toFixed(1)} km)</h3>
            <ContaminationSection c={contam} />

            <h3>Nearby (OpenStreetMap, {fmtRadius(POI_RADIUS_M)})</h3>
            <PoiSection p={poi} radiusM={POI_RADIUS_M} />

            <h3>Catchment (ABS)</h3>
            <DemographicsSection d={demo} />
          </>
        )}

        {tab === 'value' && <ValuationSection v={val} />}
      </div>
    </aside>
  );
}

/* -------------------------------------------------------------- headline */

function AnsCell({ k, v, tone }: { k: string; v: string; tone?: 'ok' | 'bad' }) {
  return (
    <div className="ans-cell">
      <span className="ans-k">{k}</span>
      <b className={tone ? `ans-v ${tone}` : 'ans-v'}>{v}</b>
    </div>
  );
}

/* ----------------------------------------------------------- street view */

/** Street View has FOUR states and every one of them is now visible. It used
 *  to render `sv?.available && <img/>`, which meant that with no API key, or
 *  at a location Google has never driven, the whole block — heading included —
 *  vanished without a word. Someone cloning the repo could not tell the
 *  feature existed, and someone assessing a battleaxe block could not tell the
 *  difference between "no imagery" and "we did not look".
 *
 *  The key stays server-side. This component only ever sees the proxied image
 *  path from /api/streetview/image. */
function StreetViewBlock({ sv }: { sv: Async<StreetView> }) {
  const d = sv.data;

  return (
    <div className="sv-block">
      <h3>Street View</h3>

      {sv.busy && !d && <Waiting what="Google for the nearest panorama" />}

      {sv.err && (
        <Failed what="The Street View lookup" why={sv.err}>
          Whether there is imagery here is unknown, not absent.
        </Failed>
      )}

      {d?.available && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={d.image} alt="Street View facing the site" className="sv" />
          <p className="note">
            Camera {d.distance} m away, turned to {d.heading}° to face the site. {d.note}
          </p>
        </>
      )}

      {d && !d.available && /key/i.test(d.reason) && (
        <p className="note state-empty">
          <b>– Street View is not configured.</b> Set <code>GOOGLE_MAPS_API_KEY</code> in{' '}
          <code>.env.local</code> and enable the Street View Static API on the key. The key
          is read server-side only and is never sent to the browser. Without it this panel
          has no photograph — not because there is none, but because none was requested.
        </p>
      )}

      {d && !d.available && !/key/i.test(d.reason) && (
        <p className="note state-empty">
          <b>○ Google has no panorama within 200 m of this point.</b> That is normal on
          rural frontage, private roads and battleaxe lots, and it is real information
          about access: nothing has driven past. It does not mean the lookup failed.
          <span className="sv-reason"> Reported: {d.reason}.</span>
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ provenance */

function ServiceLog({ d }: { d: Site }) {
  const errors = d.errors ?? {};
  const available = d.available ?? [];
  const all = Array.from(new Set([...available, ...Object.keys(errors)])).sort();

  if (!all.length)
    return <p className="note state-empty">○ No layer list was returned for this state.</p>;

  return (
    <>
      {all.map((p) => (
        <Fact key={p} k={cap(p)}
              v={errors[p] ? undefined : 'answered'}
              state={errors[p] ? 'unavailable' : 'ok'}
              tone={errors[p] ? undefined : 'ok'}
              glyph={errors[p] ? undefined : '✓ '}
              sub={errors[p]} />
      ))}
      {d.source && <Fact k="Service" v={d.source} />}
      {d.coverage?.length ? <Fact k="Coverage" v={d.coverage.join(', ')} /> : null}
      <p className="note">
        A layer listed here as not returned contributes nothing either way. Its absence
        from the hazard tab is a gap, not a clearance.
      </p>
    </>
  );
}

/* -------------------------------------------------------- value and sales */

function ValuationSection({ v }: { v: Async<Valuation> }) {
  if (v.busy && !v.data) return <Waiting what="the NSW Valuer General land value and sales layers" />;
  if (v.err) return <Failed what="The Valuer General service" why={v.err} />;
  if (!v.data) return null;

  const d = v.data;

  if (!d.available)
    return (
      <>
        <Fact k="Land value and sales" state="na" v="not published this way here" />
        <p className="note">{d.reason}</p>
      </>
    );

  const money = (n: number | null | undefined) =>
    (n == null ? null : `$${Math.round(n).toLocaleString('en-AU')}`);

  const latest = d.subject?.series?.[0] ?? null;

  return (
    <>
      {/* The answer first: what this land is assessed at, and what the street
          has actually transacted at. */}
      <div className="answer">
        <div className="ans-k">Land value (Valuer General)</div>
        <div className="ans-v">
          {latest?.value != null ? money(latest.value) : '○ none returned for this lot'}
        </div>
        <div className="ans-s">
          {latest?.value != null
            ? `Assessed${latest.at ? ` at ${fmtWhen(latest.at)}` : ''} — land only, improvements excluded`
            : 'The subject lot was not matched in the land-value layer'}
        </div>
      </div>

      {d.medianRatePerM2 != null ? (
        <Fact k={`Median recorded rate (${fmtRadius(d.radiusM)})`}
              v={`${money(d.medianRatePerM2)}/m²`}
              sub={`from ${d.comparableCount} recorded sale${d.comparableCount === 1 ? '' : 's'}`} />
      ) : (
        <Fact k={`Median recorded rate (${fmtRadius(d.radiusM)})`} state="empty"
              v="not enough sales with an area"
              sub="a rate needs both a price and a lot area" />
      )}

      {d.comparableCount === 0 ? (
        <p className="note state-empty">
          <b>○ No recorded sales inside {fmtRadius(d.radiusM)}.</b> The layer answered; it
          simply has no transaction mapped in that box. Widen the search on the Valuer
          General&rsquo;s own service before reading anything into it.
        </p>
      ) : (
        <>
          <h3>Recorded sales ({d.comparableCount})</h3>
          <ShowAll
            items={d.comparables}
            initial={4}
            noun="recorded sales"
            render={(c, i) => (
              <div className="row sub-row" key={`${c.address}-${i}`}>
                <span>
                  {c.address ?? 'address not stated'}
                  {c.date ? ` · ${fmtWhen(c.date)}` : ''}
                  {c.areaM2 ? ` · ${Math.round(c.areaM2).toLocaleString('en-AU')} m²` : ''}
                </span>
                <b>{money(c.price) ?? '—'}</b>
              </div>
            )}
          />
        </>
      )}

      <Detail label="Subject lot as the Valuer General holds it">
        <Fact k="Address" v={d.subject?.address ?? undefined}
              state={d.subject?.address ? 'ok' : 'empty'} />
        <Fact k="Zone (VG record)" v={d.subject?.zone ?? undefined}
              state={d.subject?.zone ? 'ok' : 'empty'} />
        <Fact k="Area (VG record)"
              v={d.subject?.areaM2 ? `${Math.round(d.subject.areaM2).toLocaleString('en-AU')} m²` : undefined}
              state={d.subject?.areaM2 ? 'ok' : 'empty'} />
        <Fact k="Basis" v={d.subject?.basis ?? undefined}
              state={d.subject?.basis ? 'ok' : 'empty'} />
        <Fact k="Property id" v={d.propid ?? undefined}
              state={d.propid ? 'ok' : 'empty'} />
        {(d.subject?.series ?? []).length > 1 && (
          <>
            <h3>Land value history</h3>
            {d.subject!.series.map((s, i) => (
              <Fact key={i} k={s.at ? fmtWhen(s.at) : `Value ${i + 1}`}
                    v={money(s.value) ?? undefined}
                    state={s.value == null ? 'empty' : 'ok'} />
            ))}
          </>
        )}
      </Detail>

      <p className="note">{d.note}</p>
    </>
  );
}

/* ------------------------------------------------------------------ atoms */

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** ArcGIS hands dates back as epoch milliseconds about as often as strings.
 *  Rendering the raw number would print a 13-digit integer as a date. */
function fmtWhen(v: string | number): string {
  if (typeof v === 'number' && isFinite(v)) {
    const dt = new Date(v > 1e11 ? v : v * 1000);
    return isNaN(dt.getTime()) ? String(v)
      : dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  return String(v);
}
