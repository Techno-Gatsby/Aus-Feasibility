'use client';
import { useEffect, useState, type CSSProperties } from 'react';
import type { Demographics } from '@/lib/abs';
import type { NotifiedSite } from '@/app/api/contamination/route';

type Pt = { lat: number; lng: number };

type Contam =
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

const RADIUS_M = 1000;

export default function AreaPanel({ point }: { point: Pt | null }) {
  const [demo, setDemo] = useState<Demographics | null>(null);
  const [demoErr, setDemoErr] = useState<string | null>(null);
  const [demoBusy, setDemoBusy] = useState(false);

  const [contam, setContam] = useState<Contam | null>(null);
  const [contamErr, setContamErr] = useState<string | null>(null);
  const [contamBusy, setContamBusy] = useState(false);

  useEffect(() => {
    if (!point) return;
    let cancelled = false;
    setDemoBusy(true); setContamBusy(true);
    setDemo(null); setContam(null); setDemoErr(null); setContamErr(null);

    const qs = `lat=${point.lat}&lng=${point.lng}`;

    // Two independent requests, two independent states. The ABS dataflows are
    // slow enough that pinning contamination behind them would make a fast
    // answer wait on a slow one.
    fetch(`/api/demographics?${qs}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as Demographics;
      })
      .then((j) => { if (!cancelled) setDemo(j); })
      .catch((e) => { if (!cancelled) setDemoErr(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setDemoBusy(false); });

    fetch(`/api/contamination?${qs}&radius=${RADIUS_M}`)
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok && !j?.applicable) throw new Error(j?.error ?? `HTTP ${r.status}`);
        return j as Contam;
      })
      .then((j) => { if (!cancelled) setContam(j); })
      .catch((e) => { if (!cancelled) setContamErr(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setContamBusy(false); });

    return () => { cancelled = true; };
  }, [point]);

  if (!point)
    return (
      <aside className="panel">
        <p className="muted">Search for a site, or click the map.</p>
      </aside>
    );

  return (
    <aside className="panel">
      <h2>Area</h2>

      <h3>Population and income</h3>
      {demoBusy && <p className="muted">Reading ABS statistical area and dataflows…</p>}
      {demoErr && <p className="bad">ABS lookup failed: {demoErr}</p>}
      {!demoBusy && !demoErr && demo && <Demo d={demo} />}

      <h3>Contaminated land</h3>
      {contamBusy && <p className="muted">Querying the NSW EPA register…</p>}
      {contamErr && <p className="bad">EPA lookup failed: {contamErr}</p>}
      {!contamBusy && !contamErr && contam && <Contamination c={contam} />}
    </aside>
  );
}

/* ------------------------------------------------------------------- ABS */

function Demo({ d }: { d: Demographics }) {
  if (!d.sa2)
    return (
      <p className="muted">
        No ABS statistical area covers this point
        {d.missing[0] ? ` — ${d.missing[0].reason}` : '.'}
      </p>
    );

  const money = (f: { value: number; period: string } | null) =>
    f ? `$${f.value.toLocaleString('en-AU')}/wk` : null;

  return (
    <>
      <Row k="SA2" v={d.sa2.name} />
      <Row k="SA2 code" v={d.sa2.code} />
      {d.sa2.sa3 && <Row k="SA3" v={d.sa2.sa3} />}
      {d.sa2.sa4 && <Row k="SA4" v={d.sa2.sa4} />}
      {d.sa2.gccsa && <Row k="Greater capital area" v={d.sa2.gccsa} />}
      <Row
        k="SA2 area"
        v={d.sa2.areaSqKm != null ? `${d.sa2.areaSqKm.toLocaleString('en-AU')} km²` : 'not stated'}
      />

      <Row
        k="Population"
        v={d.population ? d.population.value.toLocaleString('en-AU') : 'not available'}
        sub={d.population ? `ERP ${d.population.period}` : undefined}
        cls={d.population ? undefined : 'muted'}
      />
      <Row
        k="Median age"
        v={d.medianAge ? `${d.medianAge.value}` : 'not available'}
        sub={d.medianAge ? `Census ${d.medianAge.period}` : undefined}
        cls={d.medianAge ? undefined : 'muted'}
      />
      <Row
        k="Median personal income"
        v={money(d.medianPersonalIncomeWeekly) ?? 'not available'}
        sub={d.medianPersonalIncomeWeekly ? `Census ${d.medianPersonalIncomeWeekly.period}` : undefined}
        cls={d.medianPersonalIncomeWeekly ? undefined : 'muted'}
      />
      <Row
        k="Median household income"
        v={money(d.medianHouseholdIncomeWeekly) ?? 'not available'}
        sub={d.medianHouseholdIncomeWeekly ? `Census ${d.medianHouseholdIncomeWeekly.period}` : undefined}
        cls={d.medianHouseholdIncomeWeekly ? undefined : 'muted'}
      />

      <p className="note">
        Figures describe the whole SA2, not the site. An SA2 averages a few
        thousand to ~25,000 people, so it is a catchment indicator, not a
        statement about the immediate frontage.
        {d.medianAge || d.medianPersonalIncomeWeekly || d.medianHouseholdIncomeWeekly
          ? ' Medians are Census 2021 and do not move between Censuses; population is the ABS current-year estimate, so the two carry different dates by design.'
          : ''}
      </p>

      {d.missing.length > 0 && (
        <p className="note">
          Not returned by the ABS:{' '}
          {d.missing.map((m, i) => (
            <span key={m.field}>
              {i > 0 && '; '}
              <b>{m.field}</b> — {m.reason}
            </span>
          ))}
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------- EPA */

function Contamination({ c }: { c: Contam }) {
  if (!c.applicable)
    return (
      <>
        <Row
          k="Register"
          v="NSW only — not queried"
          sub={c.stateName ? `point is in ${c.stateName}` : undefined}
          cls="muted"
        />
        <p className="note">{c.message}</p>
      </>
    );

  if (c.error)
    return (
      <>
        <p className="bad">EPA layer did not answer: {c.error}</p>
        <p className="note">
          No result was returned, which is not the same as no sites. Re-run before
          relying on this section.
        </p>
      </>
    );

  const n = c.sites.length;

  return (
    <>
      <Row
        k={`Notified sites within ${(c.radiusM / 1000).toFixed(1)} km`}
        v={n === 0 ? 'none found' : String(n)}
        cls={n > 0 ? 'bad' : undefined}
      />
      {c.registerDate && <Row k="Register version" v={c.registerDate} />}

      {n > 0 && (
        <ul style={S.list}>
          {c.sites.map((s, i) => (
            <li key={`${s.name}-${i}`} style={S.item}>
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
            </li>
          ))}
        </ul>
      )}

      {c.truncated && (
        <p className="note">
          Result capped at 100 sites; there may be more within the radius.
        </p>
      )}

      {/* The central caveat. A nil result here is the most dangerous output
          this panel can produce, so it gets the alert treatment rather than a
          footnote — an empty register is not a clean site. */}
      {n === 0 ? (
        <p className="alert">
          <b>No notified site found — this is not a clearance.</b> The EPA register
          lists only sites <i>notified</i> to it under s60 of the Contaminated Land
          Management Act 1997, which is triggered by specific events and by someone
          choosing to notify. Land that has never been investigated never appears.
          Absence of a record is absence of a record, nothing more — a Phase 1
          environmental site assessment is still the only thing that answers this
          question.
        </p>
      ) : (
        <p className="alert">
          <b>Notified sites nearby.</b> &ldquo;Regulation under CLM Act not
          required&rdquo; is the EPA&rsquo;s regulatory decision, not a finding that
          the land is clean — contamination may still be present and still bear on
          remediation cost, staging and offsite migration onto this site. The
          register is also not exhaustive: unnotified land does not appear.
        </p>
      )}

      <p className="note">
        Source: NSW EPA, contaminated land notified sites. Points are the EPA&rsquo;s
        own coordinates and are indicative of the site, not its boundary.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ atoms */

function Row({ k, v, sub, cls }: { k: string; v: string; sub?: string; cls?: string }) {
  return (
    <div className="row">
      <span>{k}</span>
      <b className={cls}>
        {v}
        {sub && <em style={S.sub}>{sub}</em>}
      </b>
    </div>
  );
}

/** Inline rather than in globals.css: this component owns two small pieces of
 *  structure the shared sheet has no class for, and the tokens keep them in
 *  the same visual language as .row / .note. */
const S: Record<string, CSSProperties> = {
  sub: {
    display: 'block',
    fontStyle: 'normal',
    fontWeight: 400,
    fontSize: 11,
    color: 'var(--faint)',
    marginTop: 1,
  },
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
