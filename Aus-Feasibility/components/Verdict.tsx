'use client';
import EconomicsChart from '@/components/charts/EconomicsChart';
import Timeline from '@/components/charts/Timeline';
import LoanCashChart from '@/components/charts/LoanCashChart';
import Tornado from '@/components/charts/Tornado';
import { verdict, investmentKpis, snapshot, type Analysis } from '@/lib/charts';

/** Summary / verdict pane, ported from the single-file build.
 *
 *  The judgement, the KPI cards, the charts and the snapshot all read the
 *  SAME analysis object the statements, the PDF and the workbook read. There
 *  is no second calculation anywhere in this subtree, which is the only way
 *  the screen and the exports can be guaranteed to agree.
 *
 *  Section order follows the legacy scaffold: the judgement first, then what
 *  it is based on. */
export default function Verdict({
  analysis, inputs, fyOfMonth, error, busy,
}: {
  analysis: Analysis;
  inputs?: Record<string, any>;
  fyOfMonth?: number[] | null;
  error?: string | null;
  busy?: boolean;
}) {
  if (error) return (
    <section className="verdict">
      <div className="vd-banner vd-stop">
        <span className="vd-icon" aria-hidden="true">×</span>
        <div>
          <h2>The model cannot run</h2>
          <p className="vd-reason">{error}</p>
        </div>
      </div>
    </section>
  );

  if (!analysis) return (
    <section className="verdict">
      <p className="vd-empty">
        No appraisal yet. Set the inputs on the left and the verdict, the charts and
        the snapshot appear here.
      </p>
    </section>
  );

  const v = verdict(analysis);
  const kpis = investmentKpis(analysis);
  const snap = snapshot(analysis);

  return (
    <section className={`verdict${busy ? ' busy' : ''}`}>
      {v && (
        <div className={`vd-banner vd-${v.level}`} role="status">
          {/* the glyph repeats what the colour says, for anyone the colour
              does not reach — the same reason the sensitivity grid pairs its
              tint with an arrow */}
          <span className="vd-icon" aria-hidden="true">{v.icon}</span>
          <div>
            <h2>{v.title}</h2>
            <ul className="vd-reasons">
              {v.reasons.map((r) => (
                <li key={r.label} className={`vd-r-${r.state}`}>
                  <span aria-hidden="true">
                    {r.state === 'pass' ? '▲' : r.state === 'fail' ? '▼' : '·'}
                  </span>
                  {r.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <h3 className="vd-head"><span>01</span>Investment summary</h3>
      <div className="vd-kpis">
        {kpis.map((k) => (
          <div key={k.label} className="vd-kpi">
            <span className="vd-k">{k.label}</span>
            <b className="vd-v">{k.value}</b>
            <span className="vd-d">{k.detail}</span>
          </div>
        ))}
      </div>

      <h3 className="vd-head"><span>02</span>Project economics</h3>
      <div className="vd-split">
        <EconomicsChart analysis={analysis} />
        <div className="vd-panel">
          <h4>Project snapshot</h4>
          <table className="vd-snap">
            <tbody>
              {snap.map((r) => (
                <tr key={r.label}>
                  <th scope="row">{r.label}</th>
                  <td>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h3 className="vd-head"><span>03</span>Development timeline</h3>
      <Timeline analysis={analysis} />

      <h3 className="vd-head"><span>04</span>Funding profile</h3>
      <LoanCashChart analysis={analysis} fyOfMonth={fyOfMonth ?? null} />

      <h3 className="vd-head"><span>05</span>Sensitivity</h3>
      <Tornado analysis={analysis} inputs={inputs ?? {}} />

      <p className="vd-note">
        Every figure on this pane is read from the appraisal the engine returned —
        the same object behind the statements, the PDF and the workbook. A dash
        means the model did not produce that figure; it never means zero.
      </p>
    </section>
  );
}
