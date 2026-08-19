'use client';
import type { CSSProperties } from 'react';
import type { Demographics } from '@/lib/abs';
import type { NotifiedSite } from '@/app/api/contamination/route';
import {
  Fact, Failed, Waiting, ShowAll, Detail, useJson, type Async,
} from '@/components/SiteTabs';

type Pt = { lat: number; lng: number };

export type Contam =
  | { applicable: false; state: string | null; stateName: string | null; message: string }
  | {
      applicable: true;
      state: 'NSW';
      radiusM: number;
      count?: number;
      sites: NotifiedSite[];
      registerDate?: string | null;
      truncated?: boolean;
      error?: string;
    };

export const CONTAM_RADIUS_M = 1000;

/** AREA — the catchment readings: ABS demographics for the surrounding SA2,
 *  and the NSW EPA contaminated-land register within a kilometre.
 *
 *  Like SiteIntel, this file no longer draws a panel of its own; both readings
 *  are sections of the Neighbourhood tab in SitePanel. They are still two
 *  independent requests with two independent states, because the ABS dataflows
 *  are slow enough that pinning contamination behind them would make a fast
 *  answer wait on a slow one.
 */

/* ------------------------------------------------------------------ data */

export function useDemographics(point: Pt | null): Async<Demographics> {
  return useJson<Demographics>(point ? `/api/demographics?lat=${point.lat}&lng=${point.lng}` : null);
}

export function useContamination(point: Pt | null, radiusM = CONTAM_RADIUS_M): Async<Contam> {
  return useJson<Contam>(
    point ? `/api/contamination?lat=${point.lat}&lng=${point.lng}&radius=${radiusM}` : null,
  );
}

/** Never "0". The badge distinguishes a register that answered with nothing
 *  from one that did not answer at all, because they mean opposite things. */
export function contamBadge(c: Async<Contam>): { badge: string | null; tone: 'ok' | 'bad' | null } {
  if (c.busy) return { badge: '…', tone: null };
  if (c.err) return { badge: 'not returned', tone: 'bad' };
  const d = c.data;
  if (!d) return { badge: null, tone: null };
  if (!d.applicable) return { badge: 'NSW only', tone: null };
  if (d.error) return { badge: 'not returned', tone: 'bad' };
  return d.sites.length
    ? { badge: `${d.sites.length} notified`, tone: 'bad' }
    : { badge: 'none mapped', tone: null };
}

/* ------------------------------------------------------------------- ABS */

export function DemographicsSection({ d }: { d: Async<Demographics> }) {
  if (d.busy && !d.data) return <Waiting what="the ABS statistical area and dataflows" />;
  if (d.err) return <Failed what="The ABS" why={d.err} />;
  if (!d.data) return null;

  const dm = d.data;

  if (!dm.sa2)
    return (
      <p className="note state-empty">
        <b>○ No ABS statistical area covers this point.</b>{' '}
        {dm.missing[0] ? dm.missing[0].reason : 'The boundary lookup returned nothing here.'}
      </p>
    );

  const money = (f: { value: number; period: string } | null) =>
    (f ? `$${f.value.toLocaleString('en-AU')}/wk` : null);

  return (
    <>
      <Fact k="Statistical area (SA2)" v={dm.sa2.name} />

      {/* Rule: an absent figure is absent. It is never a zero, and it is never
          silently dropped either — the reason travels with the row. */}
      <Fact
        k="Population"
        v={dm.population ? dm.population.value.toLocaleString('en-AU') : undefined}
        state={dm.population ? 'ok' : 'unavailable'}
        sub={dm.population ? `ERP ${dm.population.period}` : reasonFor(dm, 'population')}
      />
      <Fact
        k="Median age"
        v={dm.medianAge ? `${dm.medianAge.value}` : undefined}
        state={dm.medianAge ? 'ok' : 'unavailable'}
        sub={dm.medianAge ? `Census ${dm.medianAge.period}` : reasonFor(dm, 'medianAge')}
      />
      <Fact
        k="Median personal income"
        v={money(dm.medianPersonalIncomeWeekly) ?? undefined}
        state={dm.medianPersonalIncomeWeekly ? 'ok' : 'unavailable'}
        sub={dm.medianPersonalIncomeWeekly
          ? `Census ${dm.medianPersonalIncomeWeekly.period}`
          : reasonFor(dm, 'medianPersonalIncomeWeekly')}
      />
      <Fact
        k="Median household income"
        v={money(dm.medianHouseholdIncomeWeekly) ?? undefined}
        state={dm.medianHouseholdIncomeWeekly ? 'ok' : 'unavailable'}
        sub={dm.medianHouseholdIncomeWeekly
          ? `Census ${dm.medianHouseholdIncomeWeekly.period}`
          : reasonFor(dm, 'medianHouseholdIncomeWeekly')}
      />

      <p className="note">
        Figures describe the whole SA2, not the site. An SA2 averages a few thousand to
        ~25,000 people, so it is a catchment indicator, not a statement about the
        immediate frontage.
      </p>

      <Detail label="Statistical geography and dating">
        <Fact k="SA2 code" v={dm.sa2.code} />
        {dm.sa2.sa3 && <Fact k="SA3" v={dm.sa2.sa3} />}
        {dm.sa2.sa4 && <Fact k="SA4" v={dm.sa2.sa4} />}
        {dm.sa2.gccsa && <Fact k="Greater capital area" v={dm.sa2.gccsa} />}
        <Fact
          k="SA2 area"
          v={dm.sa2.areaSqKm != null ? `${dm.sa2.areaSqKm.toLocaleString('en-AU')} km²` : undefined}
          state={dm.sa2.areaSqKm != null ? 'ok' : 'unavailable'}
        />
        <p className="note">
          Medians are Census 2021 and do not move between Censuses; population is the ABS
          current-year estimate. The two carry different dates by design.
        </p>
        {dm.missing.length > 0 && (
          <p className="note">
            Not returned by the ABS:{' '}
            {dm.missing.map((m, i) => (
              <span key={m.field}>{i > 0 && '; '}<b>{m.field}</b> — {m.reason}</span>
            ))}
          </p>
        )}
      </Detail>
    </>
  );
}

const reasonFor = (d: Demographics, field: string) =>
  d.missing.find((m) => m.field === field)?.reason ?? 'the ABS did not return this figure';

/* ------------------------------------------------------------------- EPA */

export function ContaminationSection({ c }: { c: Async<Contam> }) {
  if (c.busy && !c.data) return <Waiting what="the NSW EPA notified-sites register" />;
  if (c.err) return <Failed what="The NSW EPA register" why={c.err} />;
  if (!c.data) return null;

  const d = c.data;

  // Not applicable is a fourth state again: the register was never asked
  // because it does not cover this place. That is not an empty result.
  if (!d.applicable)
    return (
      <>
        <Fact k="Notified-sites register" state="na" v="NSW only — not queried"
              sub={d.stateName ? `this point is in ${d.stateName}` : undefined} />
        <p className="note">{d.message}</p>
      </>
    );

  // The service answered with an error for this layer.
  if (d.error)
    return <Failed what="The EPA contaminated-land layer" why={d.error} />;

  const n = d.sites.length;
  const km = (d.radiusM / 1000).toFixed(1);

  return (
    <>
      {n === 0 ? (
        <Fact k={`Notified sites within ${km} km`} state="empty"
              v="none in the register" />
      ) : (
        <Fact k={`Notified sites within ${km} km`} v={`${n} notified`} tone="bad" glyph="⚠ " />
      )}
      {d.registerDate && <Fact k="Register version" v={d.registerDate} />}

      {/* The central caveat. A nil result here is the most dangerous output
          this panel can produce, so it gets the alert treatment rather than a
          footnote — an empty register is not a clean site. */}
      {n === 0 ? (
        <p className="alert">
          <b>○ Nothing in the register — this is not a clearance.</b> The EPA register
          lists only sites <i>notified</i> to it under s60 of the Contaminated Land
          Management Act 1997, which is triggered by specific events and by someone
          choosing to notify. Land that has never been investigated never appears.
          Absence of a record is absence of a record, nothing more — a Phase 1
          environmental site assessment is still the only thing that answers this
          question.
        </p>
      ) : (
        <p className="alert">
          <b>⚠ Notified sites nearby.</b> &ldquo;Regulation under CLM Act not
          required&rdquo; is the EPA&rsquo;s regulatory decision, not a finding that the
          land is clean — contamination may still be present and still bear on
          remediation cost, staging and offsite migration onto this site. The register is
          also not exhaustive: unnotified land does not appear.
        </p>
      )}

      {/* A div rather than a ul: ShowAll's own control is a button, and a
          button is not a permitted child of ul. */}
      {n > 0 && (
        <div style={S.list} role="list">
          <ShowAll
            items={d.sites}
            initial={3}
            noun="notified sites"
            render={(s, i) => (
              <div key={`${s.name}-${i}`} style={S.item} role="listitem">
                <div style={S.itemHead}>
                  <b style={S.itemName}>{s.name ?? 'Unnamed site'}</b>
                  {s.distanceM != null && <span style={S.dist}>{s.distanceM} m</span>}
                </div>
                <div style={S.itemMeta}>
                  {[s.street, s.suburb].filter(Boolean).join(', ') || 'address not stated'}
                  {s.lga ? ` · ${s.lga}` : ''}
                </div>
                <div style={S.itemMeta}>
                  {s.activityType ?? 'activity not stated'} —{' '}
                  {s.managementClass ?? 'class not stated'}
                </div>
              </div>
            )}
          />
        </div>
      )}

      {d.truncated && (
        <p className="note">Result capped at 100 sites; there may be more within the radius.</p>
      )}

      <p className="note">
        Source: NSW EPA, contaminated land notified sites. Points are the EPA&rsquo;s own
        coordinates and are indicative of the site, not its boundary.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ atoms */

/** Inline rather than in globals.css: this component owns one small piece of
 *  structure the shared sheet has no class for, and the tokens keep it in the
 *  same visual language as .row / .note. */
const S: Record<string, CSSProperties> = {
  list: { listStyle: 'none', margin: '8px 0 0', padding: 0 },
  item: {
    padding: '8px 0',
    borderBottom: '1px solid #f4f4f5',
    fontSize: 12.5,
    lineHeight: 1.45,
  },
  itemHead: { display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'baseline' },
  itemName: { color: 'var(--ink)', fontWeight: 600 },
  dist: { color: 'var(--mute)', fontSize: 11, fontVariantNumeric: 'tabular-nums', flex: 'none' },
  itemMeta: { color: 'var(--mute)', marginTop: 1 },
};

/** Kept so the page's existing three-panel markup still type-checks while the
 *  content lives in the tabbed panel. Renders nothing on purpose — see the
 *  note on SiteIntel's default export. */
export default function AreaPanel(_props: { point: Pt | null }) {
  return null;
}
