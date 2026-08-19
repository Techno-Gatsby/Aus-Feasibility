'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  monthlyEngine, offerGrid, consolidatedProfitAndLoss, consolidatedCashflow,
  consolidatedBalanceSheet, projectComparison,
  type Statement, type Parcel, type OfferTarget, type OfferCell,
  type Comparison, type CompareFmt,
} from '@/lib/statements2';

/* ---- formatting. A zero is printed as an em dash, because in these
   statements a real zero and an absent figure look the same on the page and
   the honest reading is "nothing here", not "exactly nil". ---- */
const money = (v: number | null) =>
  v == null ? '' :
  Math.abs(v) < 0.5 ? '—' :
  Math.abs(v) >= 1e6 ? `${v < 0 ? '(' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}m${v < 0 ? ')' : ''}`
                     : `${v < 0 ? '(' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-AU')}${v < 0 ? ')' : ''}`;
const pct = (v: number | null, dp = 1) => (v == null ? '' : `${(v * 100).toFixed(dp)}%`);
const xr = (v: number | null) => (v == null ? '' : `${v.toFixed(2)}x`);
const int = (v: number | null) => (v == null ? '' : Math.round(v).toLocaleString('en-AU'));
const fmtBy = (f: CompareFmt, v: number | null) =>
  f === 'money' ? money(v) : f === 'pct' ? pct(v, 2) : f === 'x' ? xr(v)
  : f === 'area' ? (v == null ? '' : `${Math.round(v).toLocaleString('en-AU')} m²`) : int(v);

type Tab = 'monthly' | 'offer' | 'cpl' | 'ccf' | 'cbs' | 'port';

export type ParcelInput = { name: string; inputs: Record<string, any> };

export default function Statements2({
  analysis, fyOfMonth, inputs, parcels = [], parcelName = 'Current scheme',
}: {
  analysis: any;
  fyOfMonth: number[] | null;
  inputs: Record<string, any>;
  /** extra parcels for the consolidation. The app has no parcel list yet, so
   *  with none supplied the roll-up is the current scheme alone and says so. */
  parcels?: ParcelInput[];
  parcelName?: string;
}) {
  const [tab, setTab] = useState<Tab>('monthly');

  const monthly = useMemo(() => (analysis ? monthlyEngine(analysis) : null), [analysis]);

  /* ---- the parcel set feeding every consolidated pane ---- */
  const [extra, setExtra] = useState<Parcel[]>([]);
  const [extraErr, setExtraErr] = useState<string | null>(null);
  useEffect(() => {
    if (!parcels.length) { setExtra([]); return; }
    let dead = false;
    (async () => {
      const out: Parcel[] = [];
      const bad: string[] = [];
      for (const p of parcels) {
        try {
          const r = await fetch('/api/model', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ inputs: p.inputs }),
          });
          const j = await r.json();
          if (j.ok) out.push({ name: p.name, analysis: j.analysis, fyOfMonth: j.fyOfMonth ?? [] });
          else bad.push(`${p.name}: ${j.error ?? 'failed'}`);
        } catch (e: any) { bad.push(`${p.name}: ${String(e?.message ?? e)}`); }
      }
      if (dead) return;
      setExtra(out);
      setExtraErr(bad.length ? `${bad.length} parcel(s) excluded — ${bad.join('; ')}` : null);
    })();
    return () => { dead = true; };
  }, [parcels]);

  const roll: Parcel[] = useMemo(() => {
    const base = analysis && fyOfMonth?.length
      ? [{ name: parcelName, analysis, fyOfMonth }] : [];
    return [...base, ...extra];
  }, [analysis, fyOfMonth, parcelName, extra]);

  const cpl = useMemo(() => (roll.length ? consolidatedProfitAndLoss(roll) : null), [roll]);
  const ccf = useMemo(() => (roll.length ? consolidatedCashflow(roll) : null), [roll]);
  const cbs = useMemo(() => (roll.length ? consolidatedBalanceSheet(roll) : null), [roll]);

  if (!analysis) return <p className="muted">Enter a scheme and the statements build themselves.</p>;

  const single = roll.length < 2;

  return (
    <div className="stmts">
      <div className="seg stmt-tabs">
        <button onClick={() => setTab('monthly')} aria-pressed={tab === 'monthly'}>Monthly engine</button>
        <button onClick={() => setTab('offer')} aria-pressed={tab === 'offer'}>Land value</button>
        <button onClick={() => setTab('cpl')} aria-pressed={tab === 'cpl'}>Consolidated P&amp;L</button>
        <button onClick={() => setTab('ccf')} aria-pressed={tab === 'ccf'}>Consolidated cashflow</button>
        <button onClick={() => setTab('cbs')} aria-pressed={tab === 'cbs'}>Consolidated balance sheet</button>
        <button onClick={() => setTab('port')} aria-pressed={tab === 'port'}>Project comparison</button>
      </div>

      {tab === 'monthly' && monthly && <Table s={monthly} />}
      {tab === 'offer' && <Offer inputs={inputs} />}

      {tab !== 'monthly' && tab !== 'offer' && (
        <>
          {extraErr && <p className="alert">{extraErr}</p>}
          {single && (
            <p className="note">
              <b>One parcel.</b> Consolidation is the sum of the parcels supplied. The
              app has no parcel list yet, so this is the current scheme on its own —
              a legitimate roll-up of one, not a placeholder. Pass a{' '}
              <code>parcels</code> list of named input sets and every pane below adds
              them, each on its own financial-year map.
            </p>
          )}
        </>
      )}

      {tab === 'cpl' && cpl && <Table s={cpl} />}
      {tab === 'ccf' && ccf && <Table s={ccf} />}
      {tab === 'cbs' && cbs && <Table s={cbs} />}
      {tab === 'port' && <Compare parcels={roll} />}
    </div>
  );
}

/* ════════════ shared table renderer (matches components/Statements.tsx) ════════════ */
function Table({ s }: { s: Statement }) {
  const span = s.columns.length + (s.columns.length > 1 ? 3 : 2);
  return (
    <div className="stmt">
      <h3>{s.caption}</h3>
      <div className="stmt-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">No.</th><th className="l">Description</th>
              {s.columns.map((c) => <th key={c}>{c}</th>)}
              {s.columns.length > 1 && <th>Total</th>}
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r, i) =>
              r.kind === 'band' ? (
                <tr key={i} className="band"><td colSpan={span}>{r.label}</td></tr>
              ) : (
                <tr key={i} className={r.kind ?? ''}>
                  <td className="l no">{r.no ?? ''}</td>
                  <td className="l">{r.label}</td>
                  {r.values.map((v, j) => <td key={j}>{money(v)}</td>)}
                  {s.columns.length > 1 && <td className="tot">{money(r.total)}</td>}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {s.note && <p className="note">{s.note}</p>}
    </div>
  );
}

/* ════════════ 2. OFFER PRICE / LAND VALUE ════════════ */

const METRICS = [
  ['eirr', 'Equity IRR', [0.10, 0.125, 0.15, 0.175, 0.20, 0.25, 0.30]],
  ['margin', 'Margin on revenue', [0.10, 0.15, 0.20, 0.25]],
  ['moic', 'Equity multiple', [1.25, 1.5, 1.75, 2.0]],
  ['npat', 'Net profit', [0, 10e6, 25e6, 50e6, 100e6]],
  ['npv', 'Net present value', [0, 10e6, 25e6, 50e6]],
] as const;
const metricName = (k: string) => METRICS.find((m) => m[0] === k)?.[1] ?? k;
const showTarget = (k: string, v: number) =>
  k === 'eirr' || k === 'margin' ? `${(v * 100).toFixed(1)}%`
  : k === 'moic' ? `${v.toFixed(2)}x`
  : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}m` : `$${v.toLocaleString('en-AU')}`;

/** Which input actually moves the sale price for this scheme. Vertical
 *  schemes sell by unit rate; a land subdivision sells per saleable sqm or
 *  per frontage foot. Guessing wrong would re-solve the model against a
 *  field that does nothing and quietly report three identical columns. */
function saleLever(inputs: Record<string, any>): { key: string; unit: string } | null {
  const has = (k: string) => typeof inputs?.[k] === 'number' && inputs[k] > 0;
  if (inputs?.vert && has('hpsf')) return { key: 'hpsf', unit: 'per sqm of vertical unit' };
  if (!inputs?.vert && inputs?.pmode && has('vpsf')) return { key: 'vpsf', unit: 'per saleable sqm' };
  if (!inputs?.vert && has('vff')) return { key: 'vff', unit: 'per unit' };
  if (has('hpsf')) return { key: 'hpsf', unit: 'per sqm' };
  return null;
}

function Offer({ inputs }: { inputs: Record<string, any> }) {
  const [metric, setMetric] = useState('eirr');
  const [target, setTarget] = useState(0.20);
  const [cells, setCells] = useState<OfferCell[][] | null>(null);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = Number(inputs?.pr);
  const siteArea = Number(inputs?.acresGross);
  const lever = saleLever(inputs);
  const levels = useMemo(() => {
    if (!lever) return [{ factor: 1, label: 'At the current sale price' }];
    const base = Number(inputs[lever.key]);
    return [1, 0.94, 0.84].map((f) => ({
      factor: f,
      label: `At $${Math.round(base * f).toLocaleString('en-AU')} ${lever.unit}`,
    }));
  }, [lever, inputs]);

  const targets: OfferTarget[] = useMemo(() => {
    const want: OfferTarget[] = [
      { key: 'npv', target: 0, label: 'Net present value nil — the absolute ceiling' },
      { key: metric, target, label: `${metricName(metric)} of ${showTarget(metric, target)} — YOUR REQUIREMENT`, mine: true },
      { key: 'eirr', target: 0.20, label: 'Equity IRR 20%' },
      { key: 'eirr', target: 0.25, label: 'Equity IRR 25%' },
    ];
    const seen = new Set(want.filter((t) => t.mine).map((t) => `${t.key}|${t.target.toFixed(4)}`));
    return want.filter((t) => {
      if (t.mine) return true;
      const sig = `${t.key}|${t.target.toFixed(4)}`;
      if (seen.has(sig)) return false;
      seen.add(sig); return true;
    });
  }, [metric, target]);

  const solveAll = useCallback(async () => {
    setBusy(true); setErr(null); setDone(0);
    const grid: OfferCell[][] = targets.map(() => levels.map(() => ({
      value: null, achieved: null, reason: 'undefined-metric' as const, explanation: '',
    })));
    setCells(grid.map((r) => r.slice()));
    let finished = 0;
    const jobs: Promise<void>[] = [];
    targets.forEach((t, i) => levels.forEach((lv, j) => {
      const body = {
        inputs: lever ? { ...inputs, [lever.key]: Number(inputs[lever.key]) * lv.factor } : inputs,
        driver: 'pr', metric: t.key, target: t.target,
      };
      jobs.push((async () => {
        try {
          const r = await fetch('/api/optimise', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          const j = await r.json();
          grid[i][j] = j.ok
            ? { value: j.solved ?? null, achieved: j.achieved ?? null, reason: j.reason, explanation: j.explanation ?? '' }
            : { value: null, achieved: null, reason: 'undefined-metric', explanation: j.error ?? 'the model could not be run at this sale price' };
        } catch (e: any) {
          grid[i][j] = { value: null, achieved: null, reason: 'undefined-metric', explanation: String(e?.message ?? e) };
        }
        finished++; setDone(finished);
        setCells(grid.map((r) => r.slice()));
      })());
    }));
    try { await Promise.all(jobs); } catch (e: any) { setErr(String(e?.message ?? e)); }
    setBusy(false);
  }, [targets, levels, lever, inputs]);

  const G = useMemo(
    () => (cells ? offerGrid(targets, levels.map((l) => l.label), cells, ask, siteArea) : null),
    [cells, targets, levels, ask, siteArea],
  );
  const total = targets.length * levels.length;

  return (
    <div className="stmt">
      <h3>Offer price — what the land is worth</h3>
      <div className="sens-ctl">
        <label>Required return
          <select value={metric} onChange={(e) => {
            setMetric(e.target.value);
            const m = METRICS.find((x) => x[0] === e.target.value);
            if (m) setTarget(m[2][Math.floor(m[2].length / 2)]);
            setCells(null);
          }}>
            {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>of
          <select value={target} onChange={(e) => { setTarget(Number(e.target.value)); setCells(null); }}>
            {(METRICS.find((m) => m[0] === metric)?.[2] ?? []).map((v) => (
              <option key={v} value={v}>{showTarget(metric, v)}</option>
            ))}
          </select>
        </label>
        <button className="primary" onClick={solveAll} disabled={busy || !isFinite(ask) || ask <= 0}>
          {busy ? `Solving ${done} of ${total}…` : 'Solve'}
        </button>
      </div>

      {(!isFinite(ask) || ask <= 0) && (
        <p className="alert">
          There is no land price in the scheme to compare against, so there is
          nothing to solve towards. Set the land price per sqm first.
        </p>
      )}
      {err && <p className="alert">{err}</p>}

      {G && <>
        <Headline G={G} metric={metric} target={target} />
        <div className="stmt-scroll">
          <table>
            <thead>
              <tr>
                <th className="l">Required return</th>
                {G.columns.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {G.rows.map((r, i) => (
                <tr key={i} className={r.mine ? 'result' : ''}>
                  <td className="l">{r.label}</td>
                  {r.cells.map((c, j) => (
                    <td key={j} title={c.value == null ? c.explanation : undefined}>
                      {c.value == null
                        ? <span className="muted">not reachable</span>
                        : <span className={c.value < G.ask ? 'neg' : ''}>{money(c.value)}</span>}
                    </td>
                  ))}
                </tr>
              ))}
              <tr className="sub">
                <td className="l">Price being asked</td>
                {G.columns.map((c) => <td key={c}>{money(G.ask)}</td>)}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="note">{G.note}</p>
        <p className="note">
          The engine ships <code>solveLand</code>, and this pane does not use it.
          It evaluates an endpoint at a land price of zero first and abandons the
          search when the metric is undefined there — and at zero this model
          returns no equity IRR at all, so it reports “no solution” for hurdles
          the curve genuinely crosses. This scans the interior instead and skips
          undefined samples rather than stopping at them.
        </p>
        <p className="note">
          Project IRR is not offered as a target here. The optimiser endpoint
          publishes equity IRR, margin, multiple, profit and NPV; project IRR is
          not among them, and this model returns none for the current scheme in
          any case. An absent row is honest — a row of zeros would not be.
        </p>
      </>}

      {!G && !busy && (
        <p className="muted">
          Solving means running the whole model repeatedly — around a hundred runs
          per cell — so it is on a button rather than on every keystroke.
        </p>
      )}
    </div>
  );
}

function Headline({ G, metric, target }: { G: NonNullable<ReturnType<typeof offerGrid>>; metric: string; target: number }) {
  const req = G.requirement;
  if (!req || req.value == null)
    return (
      <p className="alert">
        <b>{metricName(metric)} of {showTarget(metric, target)} is not reachable at any land price</b> on
        these assumptions. {req?.explanation}
      </p>
    );
  const gap = G.gapPerSqm ?? 0;
  const site = G.gapAcrossSite ?? 0;
  return (
    <div className="opt-out">
      <div className="opt-card hit">
        <span>You can pay up to</span>
        <b>{money(req.value)}</b>
        <em>per sqm for a {metricName(metric).toLowerCase()} of {showTarget(metric, target)}</em>
      </div>
      <div className="opt-card">
        <span>Being asked</span>
        <b>{money(G.ask)}</b>
        <em>per sqm</em>
      </div>
      <div className="opt-card">
        <span>{gap >= 0 ? 'Headroom' : 'Overpayment'}</span>
        <b className={gap >= 0 ? 'pos' : 'neg'}>{money(Math.abs(gap))}</b>
        <em>per sqm, {money(Math.abs(site))} across the site</em>
      </div>
      {G.ceiling?.value != null && (
        <div className="opt-card">
          <span>Absolute ceiling</span>
          <b>{money(G.ceiling.value)}</b>
          <em>net present value nil — no return at all</em>
        </div>
      )}
    </div>
  );
}

/* ════════════ 4. PROJECT COMPARISON ════════════ */
function Compare({ parcels }: { parcels: Parcel[] }) {
  const [rate, setRate] = useState(7.25);
  const C: Comparison | null = useMemo(
    () => (parcels.length ? projectComparison(parcels, rate) : null), [parcels, rate]);
  if (!C) return <p className="muted">No parcel to compare.</p>;

  return (
    <div className="stmt">
      <h3>{C.caption}</h3>
      <div className="sens-ctl">
        <label>Portfolio discount rate
          <input type="number" min={0} max={40} step={0.25} value={rate}
                 onChange={(e) => setRate(Math.max(0, Number(e.target.value)))} />
        </label>
        <span className="muted">% a year, pre-tax unlevered</span>
      </div>
      <div className="stmt-scroll">
        <table>
          <thead>
            <tr>
              <th className="l">Measure</th>
              {C.columns.map((c, i) => (
                <th key={c}>{C.best === i ? '★ ' : ''}{c}</th>
              ))}
              {C.columns.length > 1 && <th>Portfolio</th>}
            </tr>
          </thead>
          <tbody>
            {C.rows.map((r, i) => (
              <tr key={i}>
                <td className="l">{r.label}</td>
                {r.values.map((v, j) => (
                  <td key={j}>{v == null ? <span className="muted">not produced</span> : fmtBy(r.fmt, v)}</td>
                ))}
                {C.columns.length > 1 && (
                  <td className="tot" title={r.portfolio == null ? r.portfolioNote : undefined}>
                    {r.portfolio == null
                      ? <span className="muted">not additive</span>
                      : fmtBy(r.fmt, r.portfolio)}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {C.best !== null && C.columns.length > 1 && (
        <p className="note">
          ★ marks the strongest equity return of the {C.columns.length} parcels.
        </p>
      )}
      <p className="note">{C.note}</p>
    </div>
  );
}
