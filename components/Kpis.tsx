'use client';

const money = (v: any) =>
  typeof v === 'number' && isFinite(v)
    ? (Math.abs(v) >= 1e6
        ? `$${(v / 1e6).toFixed(2)}m`
        : `$${Math.round(v).toLocaleString('en-AU')}`)
    : '—';
const pc = (v: any) =>
  typeof v === 'number' && isFinite(v) ? `${(v * 100).toFixed(1)}%` : '—';

/** The engine's validation errors are shown here, prominently and verbatim.
 *  They are the model telling the user what is missing — burying them would
 *  leave the app looking broken when it is actually being precise. */
export default function Kpis({
  summary, error, busy,
}: { summary: any; error: string | null; busy: boolean }) {
  if (error)
    return (
      <div className="kpis error">
        <div className="k-err">
          <b>Model cannot run</b>
          <span>{error}</span>
        </div>
      </div>
    );

  const cells: [string, string, string][] = [
    ['Revenue', money(summary?.revenue), 'gross realisation'],
    ['Net profit', money(summary?.npat), 'after tax'],
    ['Margin', pc(summary?.margin), 'on revenue'],
    ['Equity IRR', pc(summary?.equityIrr), 'after tax'],
    ['Peak equity', money(summary?.peakEquity), 'max out of pocket'],
    ['Peak debt', money(summary?.peakDebt), ''],
    ['Stamp duty', money(summary?.stampDuty), 'acquisition'],
    ['FIRB', money(summary?.firb), 'foreign investor'],
  ];

  return (
    <div className={`kpis${busy ? ' busy' : ''}`}>
      {cells.map(([k, v, sub]) => (
        <div key={k} className="k">
          <span className="k-l">{k}</span>
          <b className="k-v">{v}</b>
          {sub && <span className="k-s">{sub}</span>}
        </div>
      ))}
    </div>
  );
}
