'use client';
import {
  loanCash, domain, gridValues, axisTick, money, monthLabel, isNum, type Analysis,
} from '@/lib/charts';

/** Monthly loan balance against cumulative equity cash flow.
 *
 *  Two things this has to survive:
 *   - a project with NO DEBT. The loan row is then legitimately all zeros,
 *     which is a real answer, not a missing one — so the line is drawn flat
 *     on the axis and the caption says so in words. The domain helper pads a
 *     flat series into a real interval, so nothing divides by zero.
 *   - a month the engine did not publish. That is a gap in the line, never a
 *     point at zero.
 *
 *  Financial-year markers come from the resolved month->FY map the server
 *  built with the engine's own fyOf. Without it there are simply no year
 *  markers; this component never works out a year boundary for itself. */
export default function LoanCashChart({
  analysis, fyOfMonth,
}: { analysis: Analysis; fyOfMonth: number[] | null }) {
  const c = loanCash(analysis, fyOfMonth ?? null);
  if (!c) return (
    <figure className="vd-chart">
      <figcaption>Loan balance and cumulative cash</figcaption>
      <p className="vd-empty">No monthly cash flow is available.</p>
    </figure>
  );

  const d = analysis?.d ?? {};
  const dm = domain([...c.loan, ...c.cumulativeCash]);
  if (!dm) return (
    <figure className="vd-chart">
      <figcaption>Loan balance and cumulative cash</figcaption>
      <p className="vd-empty">No monthly cash flow is available.</p>
    </figure>
  );

  const W = 1000, H = 250, pl = 70, pr = 196, pt = 20, pb = 34;
  const n = c.months.length;
  const X = (i: number) => (n === 1 ? pl + (W - pl - pr) / 2 : pl + (W - pl - pr) * i / (n - 1));
  const Y = (v: number) => pt + (dm.max - v) / (dm.max - dm.min) * (H - pt - pb);

  const path = (vals: (number | null)[]) => {
    let out = '', pen = false;
    vals.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }
      out += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
      pen = true;
    });
    return out.trim();
  };

  const series = [
    { name: 'Loan balance', vals: c.loan, colour: '#B3261E', dash: '7 4', marker: 'square' },
    { name: 'Cumulative cash', vals: c.cumulativeCash, colour: '#2E5496', dash: '', marker: 'circle' },
  ];

  // month labels thin out to about fourteen, as the legacy chart did
  const step = Math.max(1, Math.ceil(n / 14));

  return (
    <figure className="vd-chart">
      <figcaption>
        Loan balance and cumulative cash
        <span className="vd-sub">
          {c.hasDebt
            ? 'monthly, loan balance outstanding'
            : 'monthly · this scheme carries no debt, so the loan line sits on zero'}
        </span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" className="vd-svg"
        aria-label={`Loan balance and cumulative equity cash flow over ${n} months, ` +
          `${monthLabel(0, d)} to ${monthLabel(n - 1, d)}` +
          `${c.hasDebt ? '' : '. The project carries no debt: the loan balance is zero throughout'}`}>
        {gridValues(dm).map((v, i) => (
          <g key={i}>
            <line className="vd-grid" x1={pl} y1={Y(v)} x2={W - pr} y2={Y(v)} />
            <text className="vd-axlab" x={pl - 9} y={Y(v) + 3.5} textAnchor="end">{axisTick(v)}</text>
          </g>
        ))}
        <line className="vd-axis" x1={pl} y1={Y(0)} x2={W - pr} y2={Y(0)} />

        {/* financial-year boundaries, straight from the engine's fyOf map */}
        {c.fyBreaks.map((b) => (
          <g key={b.index}>
            <line className="vd-fybreak" x1={X(b.index)} y1={pt} x2={X(b.index)} y2={H - pb} />
            <text className="vd-fylab" x={X(b.index) + 3} y={pt + 9}>FY{String(b.fy).slice(-2)}</text>
          </g>
        ))}

        {c.months.map((m, i) => (i % step === 0 ? (
          <text key={m} className="vd-axlab" x={X(i)} y={H - 11} textAnchor="middle">
            {monthLabel(m, d)}
          </text>
        ) : null))}

        {series.map((s) => {
          const lastIdx = s.vals.map((v, i) => (isNum(v) ? i : -1)).filter((i) => i >= 0).pop();
          return (
            <g key={s.name}>
              <path d={path(s.vals)} fill="none" stroke={s.colour} strokeWidth={2.2}
                strokeDasharray={s.dash || undefined} strokeLinecap="round" />
              {/* one marker every `step` months: a dot on all 60+ months is mud,
                  but the shape has to appear often enough to identify the line */}
              {s.vals.map((v, i) => (isNum(v) && i % step === 0
                ? (s.marker === 'square'
                    ? <rect key={i} x={X(i) - 2.6} y={Y(v) - 2.6} width={5.2} height={5.2}
                        fill={s.colour} stroke="#fff" strokeWidth={1} />
                    : <circle key={i} cx={X(i)} cy={Y(v)} r={2.7}
                        fill={s.colour} stroke="#fff" strokeWidth={1} />)
                : null))}
              {lastIdx != null && (
                <text className="vd-endlab" x={W - pr + 10} y={Y(s.vals[lastIdx] as number) + 4}
                  fill={s.colour}>
                  {s.name} {money(s.vals[lastIdx])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
