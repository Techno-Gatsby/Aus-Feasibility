'use client';
import { timeline, monthLabel, type Analysis } from '@/lib/charts';

/** The phased development programme: entitlement, project-wide sales and
 *  contracting, then each construction phase with its build bar and its
 *  settlement bar, against calendar months with the three hard milestones
 *  (land close, construction start, last settlement) marked.
 *
 *  Each track carries a printed track tag (ENT / DEV / SALE / SETTLE) and a
 *  hatch pattern as well as a colour, so the four tracks stay separable in
 *  greyscale and for a colour-blind reader. */

const TRACKS = {
  ent:    { name: 'Entitlement',              colour: '#7C93B8', tag: 'ENT',    hatch: 'vd-h-dot' },
  dev:    { name: 'Development / build',      colour: '#0C356B', tag: 'DEV',    hatch: 'vd-h-solid' },
  sales:  { name: 'Sales / contracting',      colour: '#2E77D0', tag: 'SALE',   hatch: 'vd-h-diag' },
  settle: { name: 'Settlement / realisation', colour: '#15924F', tag: 'SETTLE', hatch: 'vd-h-vert' },
} as const;

const OFFSET: Record<string, number> = { ent: 11, dev: 4, sales: 17, settle: 30 };

export default function Timeline({ analysis }: { analysis: Analysis }) {
  const t = timeline(analysis);
  if (!t) return (
    <figure className="vd-chart">
      <figcaption>Development timeline</figcaption>
      <p className="vd-empty">No project schedule is available.</p>
    </figure>
  );

  const d = analysis?.d ?? {};
  const W = 1000, pl = 210, pr = 30, pt = 54, rowH = 48, pb = 32;
  const H = pt + t.rows.length * rowH + pb;
  const plotW = W - pl - pr;
  const X = (m: number) => pl + (m - t.start) / Math.max(1, t.end - t.start) * plotW;

  const ticks: number[] = [];
  let tick = Math.ceil(t.start / t.step) * t.step;
  if (tick < t.start) tick += t.step;
  for (let m = tick; m <= t.end; m += t.step) ticks.push(m);

  return (
    <figure className="vd-chart">
      <figcaption>
        Development timeline
        <span className="vd-legend">
          {(Object.keys(TRACKS) as (keyof typeof TRACKS)[]).map((k) => (
            <span key={k}><i style={{ background: TRACKS[k].colour }} />{TRACKS[k].tag} {TRACKS[k].name}</span>
          ))}
        </span>
      </figcaption>
      <div className="vd-scrollx">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" className="vd-gantt"
          aria-label={`Timeline of ${t.rows.length} activities from ${monthLabel(t.start, d)} ` +
            `to ${monthLabel(t.end, d)}, showing entitlement, development, sales and settlement`}>
          <defs>
            <pattern id="vd-h-diag" width="6" height="6" patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)">
              <rect width="6" height="6" fill="#2E77D0" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="#fff" strokeWidth="2" opacity=".55" />
            </pattern>
            <pattern id="vd-h-vert" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#15924F" />
              <line x1="0" y1="0" x2="0" y2="5" stroke="#fff" strokeWidth="1.6" opacity=".55" />
            </pattern>
            <pattern id="vd-h-dot" width="5" height="5" patternUnits="userSpaceOnUse">
              <rect width="5" height="5" fill="#7C93B8" />
              <circle cx="2.5" cy="2.5" r="1.1" fill="#fff" opacity=".6" />
            </pattern>
          </defs>

          <line className="vd-axis" x1={pl} y1={pt - 12} x2={W - pr} y2={pt - 12} />
          {ticks.map((m) => (
            <g key={m}>
              <line className="vd-grid" x1={X(m)} y1={pt - 12} x2={X(m)} y2={H - pb + 2} />
              <text className="vd-axlab" x={X(m)} y={H - 10} textAnchor="middle">{monthLabel(m, d)}</text>
            </g>
          ))}

          {t.rows.map((r, i) => {
            const y = pt + i * rowH;
            return (
              <g key={`${r.label}-${i}`} className="vd-gantt-row">
                <title>{r.tip}</title>
                <line className="vd-rowline" x1={8} y1={y + rowH - 1} x2={W - pr} y2={y + rowH - 1} />
                <text className="vd-gantt-label" x={10} y={y + 13}>{r.label}</text>
                <text className="vd-gantt-sub" x={10} y={y + 28}>{r.sub}</text>
                {r.bars.map((b, j) => {
                  const lo = Math.min(b.from, b.to), hi = Math.max(b.from, b.to);
                  const x1 = X(lo), x2 = X(hi + 1);
                  const trk = TRACKS[b.track];
                  const by = y + (OFFSET[b.track] ?? 8);
                  const fill = b.track === 'dev' ? trk.colour : `url(#${trk.hatch})`;
                  return (
                    <g key={j}>
                      <text className="vd-track-tag" x={pl - 6} y={by + 9} textAnchor="end">{trk.tag}</text>
                      <rect x={x1.toFixed(1)} y={by} width={Math.max(7, x2 - x1).toFixed(1)} height={12}
                        rx={2} fill={fill} stroke={trk.colour} strokeWidth={0.8}>
                        <title>{`${trk.name} — ${monthLabel(lo, d)} to ${monthLabel(hi, d)}`}</title>
                      </rect>
                    </g>
                  );
                })}
              </g>
            );
          })}

          {t.milestones.map((ms, i) => {
            const x = X(ms.month);
            const anchor = x > W - 150 ? 'end' : x < pl + 95 ? 'start' : 'middle';
            const tx = anchor === 'end' ? x - 5 : anchor === 'start' ? x + 5 : x;
            return (
              <g key={ms.label}>
                <line className="vd-milestone" x1={x} y1={pt - 8} x2={x} y2={H - pb + 2} />
                <path d={`M${x} ${pt - 12} l4 -4 l4 4 l-4 4 z`} fill="#5B7C9A" />
                <text className="vd-milestone-lab" x={tx} y={14 + i * 13} textAnchor={anchor}>
                  {ms.label} · {monthLabel(ms.month, d)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
