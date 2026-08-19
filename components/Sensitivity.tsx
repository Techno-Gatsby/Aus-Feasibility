'use client';
import { useEffect, useState, useCallback } from 'react';

const METRICS = [
  ['npat', 'Net profit after tax'], ['equityIrr', 'Equity IRR'],
  ['margin', 'Margin'], ['npv', 'NPV'], ['peakEquity', 'Peak equity'],
] as const;

const DRIVERS = [
  ['hpsf', 'Sale price / sqm'], ['buildpsf', 'Construction cost / sqm'],
  ['pr', 'Land price / sqm'], ['vel', 'Sales velocity'],
  ['buildmo', 'Build duration'], ['n1', 'Unit count'],
] as const;

/** A grid must use ONE unit throughout. Switching to raw dollars below $1m
 *  puts "$-187,782" next to "$5.6m" in the same column, which reads as an
 *  outlier when the value is in fact perfectly in sequence. Scale is chosen
 *  once, from the largest magnitude in the whole grid, and applied to every
 *  cell. */
const scaleOf = (vals: (number | null)[]) => {
  const max = Math.max(0, ...vals.filter((v): v is number => v != null).map(Math.abs));
  return max >= 1e6 ? 1e6 : max >= 1e3 ? 1e3 : 1;
};
const unitOf = (s: number) => (s === 1e6 ? 'm' : s === 1e3 ? 'k' : '');

const fmt = (v: number | null, metric: string, scale = 1) => {
  if (v == null) return '—';
  if (metric === 'equityIrr' || metric === 'margin') return `${(v * 100).toFixed(1)}%`;
  if (metric === 'moic') return `${v.toFixed(2)}x`;
  const s = v / scale;
  const dp = scale === 1 ? 0 : Math.abs(s) < 10 ? 2 : 1;
  return `$${s.toFixed(dp)}${unitOf(scale)}`;
};

export default function Sensitivity({ inputs }: { inputs: Record<string, any> }) {
  const [row, setRow] = useState<string>('hpsf');
  const [col, setCol] = useState<string>('buildpsf');
  const [metric, setMetric] = useState<string>('npat');
  const [swing, setSwing] = useState(10);
  const [two, setTwo] = useState(true);
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!inputs || !Object.keys(inputs).length) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch('/api/sensitivity', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, rowDriver: row, colDriver: two ? col : null,
                               metric, swing, steps: 7 }),
      });
      const j = await r.json();
      if (j.ok) { setData(j); setErr(null); } else { setData(null); setErr(j.error ?? 'failed'); }
    } catch (e: any) { setErr(String(e?.message ?? e)); }
    finally { setBusy(false); }
  }, [inputs, row, col, metric, swing, two]);

  useEffect(() => { load(); }, [load]);

  const base = data?.mode === 'two'
    ? data.grid?.[(data.grid.length - 1) / 2]?.[(data.grid[0].length - 1) / 2]
    : data?.cells?.[(data.cells.length - 1) / 2];

  return (
    <div className="stmt">
      <h3>Sensitivity</h3>
      <div className="sens-ctl">
        <label>Metric
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            {METRICS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Rows
          <select value={row} onChange={(e) => setRow(e.target.value)}>
            {DRIVERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className={two ? '' : 'off'}>Columns
          <select value={col} onChange={(e) => setCol(e.target.value)} disabled={!two}>
            {DRIVERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label>Swing
          <select value={swing} onChange={(e) => setSwing(Number(e.target.value))}>
            {[5, 10, 15, 20, 30].map((s) => <option key={s} value={s}>±{s}%</option>)}
          </select>
        </label>
        <label className="chk">
          <input type="checkbox" checked={two} onChange={(e) => setTwo(e.target.checked)} />
          Two drivers
        </label>
      </div>

      {err && <p className="alert">{err}</p>}
      {busy && <p className="muted">Running the model at each point…</p>}

      {data?.mode === 'one' && (() => { const sc = scaleOf(data.cells); return (
        <div className="stmt-scroll">
          <table>
            <thead><tr><th className="l">{labelFor(data.rowKey)}</th><th>{labelMetric(metric)}</th><th>vs base</th></tr></thead>
            <tbody>
              {data.rowValues.map((v: number, i: number) => {
                const cell = data.cells[i];
                const delta = cell != null && base != null ? cell - base : null;
                return (
                  <tr key={i} className={i === (data.rowValues.length - 1) / 2 ? 'result' : ''}>
                    <td className="l">{Math.round(v).toLocaleString('en-AU')}</td>
                    <td>{fmt(cell, metric, sc)}</td>
                    <td className={delta == null ? '' : delta < 0 ? 'neg' : 'pos'}>
                      {delta == null ? '—' : (delta >= 0 ? '+' : '') + fmt(delta, metric, sc)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ); })()}

      {data?.mode === 'two' && (() => { const sc = scaleOf(data.grid.flat()); return (
        <div className="stmt-scroll">
          <table className="heat">
            <thead>
              <tr>
                <th className="l">{labelFor(data.rowKey)} \ {labelFor(data.colKey)}</th>
                {data.colValues.map((c: number, j: number) =>
                  <th key={j}>{Math.round(c).toLocaleString('en-AU')}</th>)}
              </tr>
            </thead>
            <tbody>
              {data.grid.map((r: (number | null)[], i: number) => (
                <tr key={i}>
                  <td className="l">{Math.round(data.rowValues[i]).toLocaleString('en-AU')}</td>
                  {r.map((cell, j) => {
                    const worse = cell != null && base != null && cell < base;
                    const mid = i === (data.grid.length - 1) / 2 && j === (r.length - 1) / 2;
                    return (
                      <td key={j} className={`${cell == null ? 'nul' : worse ? 'worse' : 'better'}${mid ? ' base' : ''}`}>
                        {/* a shape as well as a colour: colour alone fails
                            colour-blind readers and greyscale print */}
                        {cell == null ? '—' : (
                          <>{worse ? '▼' : '▲'} {fmt(cell, metric, sc)}</>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ); })()}

      <p className="note">
        Every cell is a full model run, not a gradient taken at the base case. A
        development model is full of thresholds — debt sizing, tax, settlement
        timing — and a linear approximation stops being true the moment one trips.
        A dash means that combination fails validation: not a runnable scheme,
        which is different from earning nothing.
      </p>
    </div>
  );
}

const labelFor = (k: string) => DRIVERS.find((d) => d[0] === k)?.[1] ?? k;
const labelMetric = (k: string) => METRICS.find((m) => m[0] === k)?.[1] ?? k;
