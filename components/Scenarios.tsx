'use client';
import { useState, useCallback, useEffect } from 'react';

/** Scenarios are input OVERRIDES, not saved copies of the model, so what
 *  changed is explicit and auditable. */
const PRESETS = [
  { name: 'Downside', overrides: { hpsf: 0.9, buildpsf: 1.1, vel: 0.75 } },
  { name: 'Base', overrides: {} },
  { name: 'Upside', overrides: { hpsf: 1.1, buildpsf: 0.95, vel: 1.25 } },
];

const money = (v: number | null) =>
  v == null ? '—' : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}m`
                                       : `$${Math.round(v).toLocaleString('en-AU')}`;
const pct = (v: number | null) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);

export default function Scenarios({ inputs }: { inputs: Record<string, any> }) {
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!inputs || !Object.keys(inputs).length) return;
    setBusy(true);
    try {
      // multipliers are resolved against the CURRENT inputs, so a scenario
      // means "10% worse than what I have now", not a fixed number that
      // silently stops matching when the base case moves
      const scenarios = PRESETS.map((p) => ({
        name: p.name,
        overrides: Object.fromEntries(
          Object.entries(p.overrides).map(([k, mult]) => [k, Number(inputs[k] ?? 0) * mult]),
        ),
      }));
      const r = await fetch('/api/scenarios', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs, scenarios }),
      });
      setData(await r.json());
    } finally { setBusy(false); }
  }, [inputs]);

  useEffect(() => { load(); }, [load]);

  const rows: [string, (m: any) => string][] = [
    ['Revenue', (m) => money(m?.revenue)],
    ['Net profit after tax', (m) => money(m?.npat)],
    ['Margin', (m) => pct(m?.margin)],
    ['Equity IRR', (m) => pct(m?.eirr)],
    ['NPV', (m) => money(m?.npv)],
    ['Peak equity', (m) => money(m?.peakEquity)],
    ['Peak debt', (m) => money(m?.peakDebt)],
  ];

  return (
    <div className="stmt">
      <h3>Scenarios</h3>
      {busy && <p className="muted">Running each scenario…</p>}
      {data && (
        <>
          <div className="stmt-scroll">
            <table>
              <thead>
                <tr>
                  <th className="l">Measure</th>
                  {data.results.map((r: any) => (
                    <th key={r.name}>{r.name}{!r.ok && ' ⚠'}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(([label, fmt]) => (
                  <tr key={label}>
                    <td className="l">{label}</td>
                    {data.results.map((r: any) => (
                      <td key={r.name}>{r.ok ? fmt(r.metrics) : '—'}</td>
                    ))}
                  </tr>
                ))}
                <tr className="result">
                  <td className="l">Changed</td>
                  {data.results.map((r: any) => (
                    <td key={r.name} style={{ fontSize: 11, fontWeight: 400 }}>
                      {Object.keys(r.overrides).length
                        ? Object.keys(r.overrides).join(', ')
                        : 'base case'}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          {data.results.some((r: any) => !r.ok) && (
            <p className="alert">
              {data.results.filter((r: any) => !r.ok).map((r: any) => (
                <span key={r.name}><b>{r.name}:</b> {r.error}<br /></span>
              ))}
            </p>
          )}
          <p className="note">
            Downside and upside are multipliers on the current inputs, not fixed
            numbers, so they stay meaningful as the base case moves. A scenario
            that fails validation is shown with its error rather than dropped —
            omitting it would make the comparison look complete when it is not.
          </p>
        </>
      )}
    </div>
  );
}
