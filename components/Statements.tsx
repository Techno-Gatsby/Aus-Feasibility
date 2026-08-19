'use client';
import { useMemo, useState } from 'react';
import { profitAndLoss, sourcesAndUses, debtCover, type Statement } from '@/lib/statements';

const money = (v: number | null) =>
  v == null ? '' :
  v === 0 ? '—' :
  Math.abs(v) >= 1e6 ? `${v < 0 ? '(' : ''}$${(Math.abs(v) / 1e6).toFixed(2)}m${v < 0 ? ')' : ''}`
                     : `${v < 0 ? '(' : ''}$${Math.round(Math.abs(v)).toLocaleString('en-AU')}${v < 0 ? ')' : ''}`;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const xr = (v: number | null) => (v == null ? 'n/a' : `${v.toFixed(2)}x`);

type Tab = 'pl' | 'su' | 'debt';

export default function Statements({ analysis }: { analysis: any }) {
  const [tab, setTab] = useState<Tab>('pl');
  const pl = useMemo(() => (analysis ? profitAndLoss(analysis) : null), [analysis]);
  const su = useMemo(() => (analysis ? sourcesAndUses(analysis) : null), [analysis]);
  const dc = useMemo(() => (analysis ? debtCover(analysis) : null), [analysis]);

  if (!analysis) return <p className="muted">Enter a scheme and the statements build themselves.</p>;

  return (
    <div className="stmts">
      <div className="seg stmt-tabs">
        <button onClick={() => setTab('pl')} aria-pressed={tab === 'pl'}>Profit and loss</button>
        <button onClick={() => setTab('su')} aria-pressed={tab === 'su'}>Sources and uses</button>
        <button onClick={() => setTab('debt')} aria-pressed={tab === 'debt'}>Debt and cover</button>
      </div>
      {tab === 'pl' && pl && <Table s={pl} />}
      {tab === 'su' && su && <Table s={su} />}
      {tab === 'debt' && dc && <Debt d={dc} />}
    </div>
  );
}

function Table({ s }: { s: Statement }) {
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
                <tr key={i} className="band"><td colSpan={s.columns.length + (s.columns.length > 1 ? 3 : 2)}>{r.label}</td></tr>
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

function Debt({ d }: { d: ReturnType<typeof debtCover> }) {
  const ok = (b: boolean, t: string) => <span className={b ? 'pill ok' : 'pill bad'}>{t}</span>;
  return (
    <div className="stmt">
      <h3>Debt sizing and cover</h3>
      <div className="stmt-scroll">
        <table>
          <tbody>
            <tr className="band"><td colSpan={3}>SIZING</td></tr>
            <tr><td className="l">Peak debt drawn</td><td>{money(d.peak)}</td><td>month {d.peakMonth}</td></tr>
            <tr><td className="l">Facility limit</td><td>{money(d.limit)}</td><td /></tr>
            <tr><td className="l">Headroom</td><td>{money(d.headroom)}</td>
                <td>{ok(d.headroom >= 0, d.headroom >= 0 ? 'within limit' : 'OVER LIMIT')}</td></tr>
            <tr><td className="l">Loan to cost</td><td>{pct(d.ltc)}</td>
                <td>{ok(d.ltc <= 0.65, 'typical cap 65%')}</td></tr>
            <tr><td className="l">Loan to gross realisation</td><td>{pct(d.ltgrv)}</td>
                <td>{ok(d.ltgrv <= 0.6, 'typical cap 60%')}</td></tr>
            <tr className="band"><td colSpan={3}>COVER</td></tr>
            <tr><td className="l">Repayment cover at peak debt</td><td>{xr(d.repaymentCover)}</td>
                <td>{d.repaymentCover != null && ok(d.repaymentCover >= d.covenant, `covenant ${d.covenant.toFixed(2)}x`)}</td></tr>
            <tr><td className="l">Settlement periods with debt service</td><td>{d.servicedPeriods}</td><td /></tr>
            <tr><td className="l">Minimum DSCR in repayment window</td><td>{xr(d.minDscr)}</td>
                <td>{d.minDscr == null ? ok(true, 'no serviced period')
                                       : ok(d.minDscr >= d.covenant, `covenant ${d.covenant.toFixed(2)}x`)}</td></tr>
            <tr><td className="l">Occurs at</td><td>{d.minDscrMonth > 0 ? `month ${d.minDscrMonth}` : '—'}</td><td /></tr>
            <tr><td className="l">Periods below covenant</td><td>{d.breaches}</td>
                <td>{ok(d.breaches === 0, d.breaches === 0 ? 'no breach' : `${d.breaches} below`)}</td></tr>
          </tbody>
        </table>
      </div>
      <p className="note">
        DSCR is measured only where BOTH debt service and settlement receipts occur.
        During construction a development facility is not serviced from operations —
        interest rolls up and is repaid from settlements — so a construction-phase
        DSCR is not a meaningful number. Loan to gross realisation uses this model's
        own realisation, not a bank valuation. The caps shown are typical, not your
        lender's: confirm against the term sheet.
      </p>
    </div>
  );
}
