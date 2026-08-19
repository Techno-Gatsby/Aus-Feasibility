'use client';
import { economics, domain, gridValues, axisTick, money, isNum, type Analysis } from '@/lib/charts';

/** Cumulative revenue, cost and net cash by financial year.
 *
 *  Three lines on one axis need three channels, not three colours: each
 *  series gets its own dash pattern, its own marker shape, and its name
 *  printed at the right-hand end beside its final value. Printed in
 *  greyscale, or read by someone who cannot separate the hues, it still
 *  says which line is which. */

const SERIES = [
  { key: 'revenue', name: 'Revenue', colour: '#0C356B', dash: '', marker: 'circle' },
  { key: 'cost', name: 'Total cost', colour: '#B45309', dash: '6 4', marker: 'square' },
  { key: 'net', name: 'Net cash flow', colour: '#166534', dash: '2 3', marker: 'triangle' },
] as const;

function Marker({ shape, x, y, colour }: { shape: string; x: number; y: number; colour: string }) {
  if (shape === 'square')
    return <rect x={x - 3} y={y - 3} width={6} height={6} fill={colour} stroke="#fff" strokeWidth={1.2} />;
  if (shape === 'triangle')
    return <path d={`M${x} ${y - 4} L${x + 3.8} ${y + 3} L${x - 3.8} ${y + 3} Z`}
      fill={colour} stroke="#fff" strokeWidth={1.2} />;
  return <circle cx={x} cy={y} r={3} fill={colour} stroke="#fff" strokeWidth={1.2} />;
}

export default function EconomicsChart({ analysis }: { analysis: Analysis }) {
  const e = economics(analysis);
  if (!e) return (
    <figure className="vd-chart">
      <figcaption>Revenue / cost / net cash</figcaption>
      <p className="vd-empty">No annual project economics are available.</p>
    </figure>
  );

  const dm = domain([...e.revenue, ...e.cost, ...e.net]);
  if (!dm) return (
    <figure className="vd-chart">
      <figcaption>Revenue / cost / net cash</figcaption>
      <p className="vd-empty">No annual project economics are available.</p>
    </figure>
  );

  const W = 1000, H = 250, pl = 66, pr = 158, pt = 22, pb = 30;
  const n = e.years.length;
  const X = (i: number) => (n === 1 ? pl + (W - pl - pr) / 2 : pl + (W - pl - pr) * i / (n - 1));
  const Y = (v: number) => pt + (dm.max - v) / (dm.max - dm.min) * (H - pt - pb);

  const path = (vals: (number | null)[]) => {
    let out = '', pen = false;
    vals.forEach((v, i) => {
      if (!isNum(v)) { pen = false; return; }         // a gap, not a zero
      out += `${pen ? 'L' : 'M'}${X(i).toFixed(1)} ${Y(v).toFixed(1)} `;
      pen = true;
    });
    return out.trim();
  };

  return (
    <figure className="vd-chart">
      <figcaption>
        Revenue / cost / net cash
        <span className="vd-sub">cumulative, by financial year</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" className="vd-svg"
        aria-label={`Cumulative revenue, cost and net cash flow across ${n} financial years, ` +
          `FY${String(e.years[0]).slice(-2)} to FY${String(e.years[n - 1]).slice(-2)}`}>
        {gridValues(dm).map((v, i) => (
          <g key={i}>
            <line className="vd-grid" x1={pl} y1={Y(v)} x2={W - pr} y2={Y(v)} />
            <text className="vd-axlab" x={pl - 9} y={Y(v) + 3.5} textAnchor="end">{axisTick(v)}</text>
          </g>
        ))}
        <line className="vd-axis" x1={pl} y1={Y(0)} x2={W - pr} y2={Y(0)} />
        {e.years.map((y, i) => (
          <text key={y} className="vd-axlab" x={X(i)} y={H - 9} textAnchor="middle">
            FY{String(y).slice(-2)}
          </text>
        ))}

        {SERIES.map((s) => {
          const vals = e[s.key] as (number | null)[];
          const lastIdx = vals.map((v, i) => (isNum(v) ? i : -1)).filter((i) => i >= 0).pop();
          return (
            <g key={s.key}>
              <path d={path(vals)} fill="none" stroke={s.colour} strokeWidth={2.3}
                strokeDasharray={s.dash || undefined} strokeLinecap="round" />
              {vals.map((v, i) => isNum(v)
                ? <Marker key={i} shape={s.marker} x={X(i)} y={Y(v)} colour={s.colour} />
                : null)}
              {lastIdx != null && (
                <text className="vd-endlab" x={W - pr + 10} y={Y(vals[lastIdx] as number) + 4}
                  fill={s.colour}>
                  {s.name} {money(vals[lastIdx])}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </figure>
  );
}
