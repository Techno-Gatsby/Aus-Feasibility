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
  summary, error, busy, inputs,
}: { summary: any; error: string | null; busy: boolean; inputs?: Record<string, any> }) {
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

  const grab = async (path: string, ext: string) => {
    const r = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs }),
    });
    if (!r.ok) {
      let msg = String(r.status);
      try { msg = (await r.json()).error ?? msg; } catch { /* not JSON */ }
      alert(`Export failed: ${msg}`);
      return;
    }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `feasibility-${new Date().toISOString().slice(0, 10)}.${ext}`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`kpis${busy ? ' busy' : ''}`}>
      {cells.map(([k, v, sub]) => (
        <div key={k} className="k">
          <span className="k-l">{k}</span>
          <b className="k-v">{v}</b>
          {sub && <span className="k-s">{sub}</span>}
        </div>
      ))}
      <div className="k k-act">
        <button onClick={() => grab('/api/pdf', 'pdf')} disabled={!summary}>PDF report</button>
        <button onClick={() => grab('/api/export', 'xls')} disabled={!summary}>Workbook</button>
      </div>
    </div>
  );
}
