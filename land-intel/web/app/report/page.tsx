import { analyse } from '@/lib/analyse';
import { computeYield, DEFAULTS, type Assumptions } from '@/lib/yield';
import PrintButton from './PrintButton';
import './report.css';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const n2 = (v: number) =>
  v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v?: number | null) =>
  v == null ? '—' : '$' + Math.round(v).toLocaleString('en-US');

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return isFinite(n) ? n : d;
}

export default async function Report({
  searchParams,
}: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const propId = Number(sp.propId);
  if (!isFinite(propId)) {
    return <main className="rep"><p>Missing or invalid propId.</p></main>;
  }

  const a: Assumptions = {
    streamBufferFt: num(sp.streamBufferFt, DEFAULTS.streamBufferFt),
    maxSlopePct: num(sp.maxSlopePct, DEFAULTS.maxSlopePct),
    rowPct: num(sp.rowPct, DEFAULTS.rowPct),
    openSpacePct: num(sp.openSpacePct, DEFAULTS.openSpacePct),
    density: num(sp.density, DEFAULTS.density),
  };

  const d: any = await analyse({ propId });
  if (d.error) {
    return <main className="rep"><p>{d.error}</p></main>;
  }
  const y = computeYield(d.grid, d.parcel.grossAcres, a);
  const p = d.parcel;
  const reg = d.regulatory;
  const ctx = d.context;
  const u = d.utilities;

  const noSewer = u.sewer.status === 'ok' && u.sewer.holders.length === 0;
  const noWater = u.water.status === 'ok' && u.water.holders.length === 0;
  const heavyClay = ['high', 'very high'].includes(d.soils.shrinkSwell);

  const risks = [
    noSewer && 'No sewer CCN over the tract — no provider is obligated to serve. Service extension, CCN petition or on-site treatment is a material cost and timing item.',
    noWater && 'No water CCN over the tract — same exposure as sewer.',
    u.water.holders.length > 1 && `${u.water.holders.length} overlapping water CCNs — confirm which entity actually serves before relying on either.`,
    heavyClay && `Shrink-swell rated ${d.soils.shrinkSwell}${d.soils.maxLep != null ? ` (max linear extensibility ${d.soils.maxLep}%)` : ''}. Blackland Prairie clay drives foundation design and cost; a geotechnical report is required before pricing.`,
    reg.zoning?.pd && `Governed by Planned Development ${reg.zoning.pd}${reg.zoning.ordinances?.length ? ` (ord. ${reg.zoning.ordinances.join(', ')})` : ''}. PD districts carry bespoke setbacks, lot mix and density that no zoning API exposes — the controlling ordinance must be read before the yield below is relied on.`,
    !reg.zoning && 'Zoning is not published as GIS for this jurisdiction. The zoning shapefile must be obtained by Public Information Request, or the adopted map georeferenced.',
    p.cadAgExemptAcres > 0 && `${n2(p.cadAgExemptAcres)} ac carries an agricultural exemption. Ag rollback tax (3 years plus interest) triggers on change of use.`,
    ctx.pipelinesCrossing.length > 0 && `${ctx.pipelinesCrossing.length} pipeline(s) cross the tract — easement width and surface use terms are negotiated, not mapped.`,
    y.unionAcres / y.grossAcres > 0.25 && `${(100 * y.unionAcres / y.grossAcres).toFixed(0)}% of the gross area is physically constrained before any dedication.`,
  ].filter(Boolean) as string[];

  const positives = [
    reg.cityLimits && `Inside ${reg.cityLimits} city limits — municipal entitlement path rather than county plat-only.`,
    reg.schoolDistrict && `${reg.schoolDistrict}.`,
    !noSewer && u.sewer.holders.length === 1 && `Sewer CCN held by ${u.sewer.holders[0].utility} (CCN ${u.sewer.holders[0].ccnNo}).`,
    !noWater && u.water.holders.length >= 1 && `Water CCN held by ${u.water.holders.map((h: any) => h.utility).join(', ')}.`,
    reg.futureLandUse && `Future land use designated ${reg.futureLandUse}.`,
    ctx.outerLoopWithin2mi > 0 && 'Collin County Outer Loop alignment within ~2 miles.',
    y.efficiencyPct > 55 && `Buildable efficiency of ${y.efficiencyPct.toFixed(0)}% is healthy for a tract of this size.`,
  ].filter(Boolean) as string[];

  const Section = ({ n, title, children }:
    { n: string; title: string; children: React.ReactNode }) => (
    <section className="sec">
      <h2><span>{n}</span>{title}</h2>
      {children}
    </section>
  );

  return (
    <main className="rep">
      <PrintButton />

      <header className="cover">
        <p className="eyebrow">Sobha · Land Acquisition</p>
        <h1>Investment Note</h1>
        <p className="site">
          {p.legal ?? 'Subject tract'}<br />
          {reg.cityLimits ?? 'Unincorporated'}, Collin County, Texas
        </p>
        <dl className="coverfacts">
          <div><dt>Gross area</dt><dd>{n2(p.grossAcres)} ac</dd></div>
          <div><dt>Net developable</dt><dd>{n2(y.netDevelopableAcres)} ac</dd></div>
          <div><dt>Indicative units</dt><dd>{y.indicativeUnits}</dd></div>
          <div><dt>Owner of record</dt><dd>{p.owner ?? '—'}</dd></div>
        </dl>
        <p className="stamp">
          Screening note — generated from public GIS. Not a substitute for
          title, survey, geotechnical or civil engineering work.
        </p>
      </header>

      <Section n="A" title="Executive summary">
        <p>
          The subject is a {n2(p.grossAcres)} acre tract in{' '}
          {reg.cityLimits ?? 'unincorporated Collin County'}
          {reg.schoolDistrict ? `, within ${reg.schoolDistrict}` : ''}.
          {reg.zoning
            ? ` It is zoned ${reg.zoning.zone ?? '—'}${reg.zoning.pd ? ` under ${reg.zoning.pd}` : ''}.`
            : ' Zoning is not published in GIS for this jurisdiction.'}
          {reg.futureLandUse ? ` The adopted future land use designation is ${reg.futureLandUse}.` : ''}
        </p>
        <p>
          After deducting mapped physical constraints, street right-of-way and
          open space dedication, the tract carries an estimated{' '}
          <b>{n2(y.netDevelopableAcres)} net developable acres</b> — an
          efficiency of {y.efficiencyPct.toFixed(1)}% — supporting an indicative{' '}
          <b>{y.indicativeUnits} units</b> at {a.density} units per acre.
          That density is an input, not a finding: actual yield is set by the
          controlling ordinance lot mix.
        </p>
        {p.cadMarketValue != null && (
          <p>
            The appraisal district carries the tract at {money(p.cadLandValue)}{' '}
            land value and {money(p.cadMarketValue)} market value. <b>This is an
            assessed figure, not a sale price.</b> Texas is a non-disclosure
            state; transaction prices are not public record and no land or
            selling-price benchmarking can be produced from public data. A
            broker relationship or a paid comps service is required.
          </p>
        )}
      </Section>

      <Section n="B" title="Site & ownership">
        <table className="t">
          <tbody>
            <tr><th>Owner of record</th><td>{p.owner ?? '—'}</td></tr>
            <tr><th>Legal description</th><td>{p.legal ?? '—'}</td></tr>
            <tr><th>CAD property id</th><td>{p.propId ?? '—'}</td></tr>
            <tr><th>Geo id</th><td>{p.geoId ?? '—'}</td></tr>
            <tr><th>Gross area (computed)</th><td>{n2(p.grossAcres)} ac</td></tr>
            {p.cadLandAcres != null && (
              <tr><th>Gross area (CAD)</th><td>{n2(p.cadLandAcres)} ac</td></tr>)}
            {p.cadAgExemptAcres != null && (
              <tr><th>Agricultural exemption</th><td>{n2(p.cadAgExemptAcres)} ac</td></tr>)}
            <tr><th>CAD land value</th><td>{money(p.cadLandValue)}</td></tr>
            <tr><th>CAD market value</th><td>{money(p.cadMarketValue)}</td></tr>
            <tr><th>Source</th><td>{p.source}</td></tr>
          </tbody>
        </table>
      </Section>

      <Section n="C" title="Jurisdiction & entitlement">
        <table className="t">
          <tbody>
            <tr><th>City limits</th><td>{reg.cityLimits ?? 'Unincorporated'}</td></tr>
            <tr><th>ETJ / jurisdiction</th><td>{reg.prosperJurisdiction ?? '—'}</td></tr>
            <tr><th>School district</th><td>{reg.schoolDistrict ?? '—'}</td></tr>
            <tr><th>Zoning</th><td>{reg.zoning ? `${reg.zoning.zone ?? '—'}${reg.zoning.class ? ` (${reg.zoning.class})` : ''}` : 'Not published as GIS'}</td></tr>
            <tr><th>Planned Development</th><td>{reg.zoning?.pd ?? '—'}</td></tr>
            <tr><th>Controlling ordinances</th><td>{reg.zoning?.ordinances?.join(', ') || '—'}</td></tr>
            <tr><th>Future land use</th><td>{reg.futureLandUse ?? '—'}</td></tr>
            <tr><th>Special districts</th><td>{reg.specialDistricts?.join(', ') || 'None'}</td></tr>
            <tr><th>In ETJ release area</th><td>{reg.inEtjReleaseArea ? 'Yes (SB 2038)' : 'No'}</td></tr>
          </tbody>
        </table>
      </Section>

      <Section n="D" title="Physical constraints & buildable envelope">
        <table className="t">
          <thead><tr><th>Layer</th><th className="r">Acres</th><th className="r">% of gross</th></tr></thead>
          <tbody>
            {y.perLayer.map((l) => (
              <tr key={l.key}>
                <td>{l.label}</td>
                <td className="r">{n2(l.acres)}</td>
                <td className="r">{(100 * l.acres / y.grossAcres).toFixed(1)}%</td>
              </tr>
            ))}
            <tr className="sum">
              <td>Combined (union — layers overlap)</td>
              <td className="r">{n2(y.unionAcres)}</td>
              <td className="r">{(100 * y.unionAcres / y.grossAcres).toFixed(1)}%</td>
            </tr>
          </tbody>
        </table>
        <p className="note">
          Summing the individual layers would give {n2(y.sumIfDoubleCounted)} ac.
          Floodplain, water, wetlands and stream buffers overlap heavily, so the
          union is the figure deducted — not the sum.
        </p>

        <table className="t">
          <tbody>
            <tr><th>Gross area</th><td className="r">{n2(y.grossAcres)} ac</td></tr>
            {y.deductions.map((x) => (
              <tr key={x.item}><th>less {x.item}</th>
                <td className="r">({n2(x.acres)}) ac</td></tr>
            ))}
            <tr className="tot"><th>Net developable</th>
              <td className="r">{n2(y.netDevelopableAcres)} ac</td></tr>
            <tr><th>Efficiency</th><td className="r">{y.efficiencyPct.toFixed(1)}%</td></tr>
            <tr className="tot"><th>Indicative units @ {a.density}/ac</th>
              <td className="r">{y.indicativeUnits}</td></tr>
          </tbody>
        </table>
        <p className="note">
          Assumptions applied: stream buffer {a.streamBufferFt} ft · maximum
          buildable slope {a.maxSlopePct}% · street/ROW take {a.rowPct}% · open
          space dedication {a.openSpacePct}% · density {a.density} units/ac.
          These are inputs set by the analyst, not ordinance lookups.
        </p>
        <p className="note">
          FEMA zones present: {d.floodZones?.join(', ') || 'none intersecting'}.
          Layer provenance — flood: {d.coverage.floodplain}, water:{' '}
          {d.coverage.water}, streams: {d.coverage.streams}, wetlands:{' '}
          {d.coverage.wetlands}.
        </p>
      </Section>

      <Section n="E" title="Water & sewer service (PUC CCN)">
        <p className="note">
          A Certificate of Convenience and Necessity is the legal right
          <b> and obligation</b> to provide retail service to a defined area. In
          exurban Texas this is the single most common cause of deal failure.
        </p>
        <table className="t">
          <thead><tr><th>Service</th><th>Holder</th><th>CCN</th><th>Status</th></tr></thead>
          <tbody>
            {(['water', 'sewer'] as const).flatMap((k) =>
              u[k].holders.length
                ? u[k].holders.map((h: any, i: number) => (
                    <tr key={k + i}>
                      <td style={{ textTransform: 'capitalize' }}>{k}</td>
                      <td>{h.utility}</td><td>{h.ccnNo}</td><td>{h.status}</td>
                    </tr>))
                : [(
                    <tr key={k} className="bad">
                      <td style={{ textTransform: 'capitalize' }}>{k}</td>
                      <td colSpan={3}>
                        {u[k].status === 'QUERY FAILED'
                          ? 'Query failed — verify manually, do not read as none'
                          : 'No CCN over this tract'}
                      </td>
                    </tr>)],
            )}
          </tbody>
        </table>
      </Section>

      <Section n="F" title="Ground conditions">
        <table className="t">
          <tbody>
            <tr><th>Shrink-swell rating</th><td>{d.soils.shrinkSwell}
              {d.soils.maxLep != null ? ` (max linear extensibility ${d.soils.maxLep}%)` : ''}</td></tr>
            {d.terrain?.reliefFt != null && (<>
              <tr><th>Elevation range</th>
                <td>{n2(d.terrain.minFt)}–{n2(d.terrain.maxFt)} ft
                  (relief {n2(d.terrain.reliefFt)} ft)</td></tr>
              <tr><th>Mean / p90 slope</th>
                <td>{d.terrain.meanSlopePct.toFixed(2)}% / {d.terrain.p90SlopePct.toFixed(2)}%</td></tr>
              <tr><th>Terrain sampling</th>
                <td>{d.terrain.samples} USGS 3DEP points at ~{d.terrain.sampleSpacingFt} ft
                  — screening resolution</td></tr>
            </>)}
          </tbody>
        </table>
        <h3>Soil map units</h3>
        <table className="t">
          <thead><tr><th>Map unit</th><th className="r">PI</th><th>HSG</th><th>Drainage</th></tr></thead>
          <tbody>
            {[...new Map(d.soils.units.map((s: any) => [s.mapUnit, s])).values()]
              .slice(0, 12).map((s: any) => (
                <tr key={s.mapUnit}>
                  <td>{s.mapUnit}</td>
                  <td className="r">{s.plasticityIndex != null ? Math.round(s.plasticityIndex) : '—'}</td>
                  <td>{s.hydroGroup ?? '—'}</td>
                  <td>{s.drainage ?? '—'}</td>
                </tr>))}
          </tbody>
        </table>
      </Section>

      <Section n="G" title="Mineral estate & pipelines">
        <p className="note">
          In Texas the mineral estate is <b>dominant</b>: a severed mineral owner
          may enter and use the surface to develop minerals regardless of the
          surface owner. The Railroad Commission shows what is permitted and
          mapped — not who owns the minerals, which is a title question.
        </p>
        <table className="t">
          <tbody>
            <tr><th>Pipelines crossing the tract</th><td>{ctx.pipelinesCrossing.length}</td></tr>
            <tr><th>Pipelines within 0.5 mi</th><td>{ctx.pipelinesWithinHalfMile}</td></tr>
            <tr><th>Wells within 0.5 mi</th><td>{ctx.wells.length}</td></tr>
          </tbody>
        </table>
        {ctx.pipelinesCrossing.length > 0 && (
          <table className="t">
            <thead><tr><th>Operator</th><th>Commodity</th><th className="r">Dia.</th><th>Status</th></tr></thead>
            <tbody>
              {ctx.pipelinesCrossing.map((pl: any, i: number) => (
                <tr key={i}><td>{pl.operator}</td><td>{pl.commodity}</td>
                  <td className="r">{pl.diameterIn}″</td><td>{pl.status}</td></tr>))}
            </tbody>
          </table>
        )}
      </Section>

      <Section n="H" title="Competitive context">
        <table className="t">
          <tbody>
            <tr><th>Development applications within ~1 mi</th>
              <td>{ctx.nearbyDevelopments.length}</td></tr>
            <tr><th>Planned thoroughfare crossing site</th>
              <td>{ctx.thoroughfareCrossing}</td></tr>
            <tr><th>Collin County Outer Loop within 2 mi</th>
              <td>{ctx.outerLoopWithin2mi}</td></tr>
          </tbody>
        </table>
      </Section>

      <Section n="I" title="Assessment">
        <h3>Supporting factors</h3>
        <ul>{positives.map((s, i) => <li key={i}>{s}</li>)}</ul>
        <h3>Risks & open items</h3>
        <ul>{risks.map((s, i) => <li key={i}>{s}</li>)}</ul>
      </Section>

      <Section n="J" title="Diligence not answerable from public data">
        <ol>
          <li>Land and selling-price comparables. <b>Texas is a non-disclosure
            state</b> — sale prices are not public record. Requires a broker
            relationship, MLS through a licensed agent, or a paid service such
            as CoStar. Absorption pace requires Zonda or John Burns.</li>
          <li>Utility will-serve letter and capacity commitment. A CCN
            establishes obligation, not available capacity.</li>
          <li>Wastewater treatment and lift station requirements; impact fee
            schedule and roughly proportionate exactions.</li>
          <li>Title commitment: recorded deed restrictions, easements, and
            mineral severance.</li>
          <li>Geotechnical report — confirming shrink-swell, bearing capacity
            and foundation design.</li>
          <li>Boundary survey. Parcel geometry here is appraisal-district
            mapping, not a survey, and is not reliable for area to the
            hundredth of an acre.</li>
          <li>USACE jurisdictional determination. The wetlands layer is a
            desktop screen only.</li>
          <li>Entitlement risk, school capacity, and any development moratoria.</li>
        </ol>
      </Section>

      <Section n="K" title="Sources & limitations">
        <p className="note">
          Collin Central Appraisal District (parcels, ownership, valuation) ·
          Town of Prosper GIS (zoning, PD, future land use, development
          applications) · Collin County GIS (floodplain, streams, lakes,
          thoroughfare plan) · FEMA National Flood Hazard Layer · USFWS National
          Wetlands Inventory · USDA SSURGO · USGS 3DEP · Texas PUC water and
          sewer CCN · Texas Railroad Commission. All sources public.
        </p>
        <p className="note">
          Constraint areas are grid-sampled at {d.grid.length} points across the
          tract rather than exact polygon clips, and are accurate to roughly one
          grid cell along each boundary. Slope is derived from{' '}
          {d.terrain?.samples ?? 0} elevation samples at approximately{' '}
          {d.terrain?.sampleSpacingFt ?? '—'} ft spacing; localised steep creek
          banks are smoothed out at that resolution. Where a layer does not
          extend over the tract this note says so explicitly — a layer with no
          coverage is reported as unknown, never as zero.
        </p>
      </Section>
    </main>
  );
}
