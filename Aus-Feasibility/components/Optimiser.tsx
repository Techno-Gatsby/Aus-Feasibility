'use client';
import { useState, useCallback } from 'react';

const DRIVERS = [
  ['pr', 'Land price / sqm'], ['hpsf', 'Sale price / sqm'],
  ['buildpsf', 'Construction cost / sqm'], ['vel', 'Sales velocity'],
] as const;
const TARGETS = [
  ['eirr', 'Equity IRR', [0.10, 0.125, 0.15, 0.175, 0.20, 0.25]],
  ['margin', 'Margin on revenue', [0.10, 0.15, 0.20, 0.25]],
  ['npat', 'Net profit', [0, 5e6, 10e6, 20e6, 50e6]],
  ['npv', 'NPV', [0, 5e6, 10e6, 20e6]],
] as const;

const isPct = (m: string) => m === 'eirr' || m === 'margin';
const showTarget = (m: string, v: number) =>
  isPct(m) ? `${(v * 100).toFixed(1)}%`
           : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(0)}m` : `$${v.toLocaleString('en-AU')}`;
const showVal = (v: number | null) =>
  v == null ? '—' : `$${Math.round(v).toLocaleString('en-AU')}`;
const showMetric = (m: string, v: number | null) =>
  v == null ? '—' : isPct(m) ? `${(v * 100).toFixed(2)}%`
    : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}m` : `$${Math.round(v).toLocaleString('en-AU')}`;

export default function Optimiser({ inputs }: { inputs: Record<string, any> }) {
  const [driver, setDriver] = useState('pr');
  const [metric, setMetric] = useState('eirr');
  const [target, setTarget] = useState(0.15);
  const [res, setRes] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const solve = useCallback(async () => {
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/optimise', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, driver, metric, target }),
      });
      const j = await r.json();
      if (j.ok) setRes(j); else { setRes(null); setErr(j.error ?? 'failed'); }
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }, [inputs, driver, metric, target]);

  const opts = TARGETS.find((t) => t[0] === metric)?.[2] ?? [];
  const delta = res?.solved != null && res?.current != null ? res.solved - res.current : null;

  return (
    <div className="stmt">
      <h3>Optimiser</h3>
      <div className="sens-ctl">
        <label>Solve for
          <select value={driver} onChange={(e) => setDriver(e.target.value)}>
            {DRIVERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>To hit
          <select value={metric} onChange={(e) => {
            setMetric(e.target.value);
            const t = TARGETS.find((x) => x[0] === e.target.value);
            if (t) setTarget(t[2][Math.floor(t[2].length / 2)]);
          }}>
            {TARGETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Target
          <select value={target} onChange={(e) => setTarget(Number(e.target.value))}>
            {opts.map((v) => <option key={v} value={v}>{showTarget(metric, v)}</option>)}
          </select>
        </label>
        <button className="primary" onClick={solve} disabled={busy}>
          {busy ? 'Solving…' : 'Solve'}
        </button>
      </div>

      {err && <p className="alert">{err}</p>}

      {res && (
        <>
          <div className="opt-out">
            <div className="opt-card">
              <span>Today</span>
              <b>{showVal(res.current)}</b>
              <em>{showMetric(metric, res.currentMetric)}</em>
            </div>
            <div className={`opt-card${res.solved == null ? ' none' : ' hit'}`}>
              <span>To reach {showTarget(metric, target)}</span>
              <b>{showVal(res.solved)}</b>
              <em>{res.solved == null ? '—' : showMetric(metric, res.achieved)}</em>
            </div>
            {delta != null && (
              <div className="opt-card">
                <span>Difference</span>
                <b className={delta < 0 ? 'neg' : 'pos'}>
                  {delta >= 0 ? '+' : '−'}{showVal(Math.abs(delta))}
                </b>
                <em>{delta < 0 ? 'you must pay less' : 'headroom above today'}</em>
              </div>
            )}
          </div>

          {res.solved == null && (
            <p className="alert"><b>No solution.</b> {res.explanation}</p>
          )}

          <p className="note">
            Solved by bisection over real model runs. The engine ships its own
            land solver, but it evaluates an endpoint at zero first and gives up
            when the metric is undefined there — at a land price of zero this
            model returns a null equity IRR, so it reported “no solution” for
            targets that are in fact reachable. This scans the interior and
            ignores undefined samples instead of stopping at them.
          </p>
        </>
      )}
    </div>
  );
}
