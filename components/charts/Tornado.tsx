'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  TORNADO_DRIVERS, TORNADO_METRICS, tornadoMetric, tornadoRows, isNum, type Analysis,
} from '@/lib/charts';

/** Ranked driver impact on the base case.
 *
 *  Each end of each bar is a FULL model run at the swung input, obtained from
 *  the sensitivity endpoint — the same thing the single-file build's worker
 *  did. It is never a gradient taken at the base case: a development model is
 *  full of thresholds (debt sizing, tax, settlement timing) and a
 *  linearisation walks straight through them.
 *
 *  The base case in the centre is READ from the analysis, not from the
 *  midpoint run, so the axis of this chart cannot disagree with the KPI card
 *  above it.
 *
 *  A driver whose input is unset cannot be swung — there is nothing to take a
 *  percentage of. Those drivers are named underneath as excluded rather than
 *  drawn as a zero-length bar, which would read as "no sensitivity". */

const SWINGS = [5, 10, 15, 20, 30, 50];

type Raw = { key: string; label: string; low: number | null; high: number | null };

export default function Tornado({
  analysis, inputs,
}: { analysis: Analysis; inputs: Record<string, any> }) {
  const [metricKey, setMetricKey] = useState<string>('npv');
  const [swing, setSwing] = useState(15);
  const [raw, setRaw] = useState<Raw[] | null>(null);
  const [dropped, setDropped] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  const metric = tornadoMetric(metricKey);
  const base = analysis ? metric.read(analysis) : null;

  // candidates: the legacy driver order, minus anything this scheme leaves
  // unset. Sending a zero base to the endpoint earns a 422 and tells us
  // nothing we did not already know.
  const candidates = useMemo(
    () => TORNADO_DRIVERS.filter((dv) => {
      const v = Number(inputs?.[dv.key]);
      return isFinite(v) && v !== 0;
    }),
    [inputs],
  );
  const unset = useMemo(
    () => TORNADO_DRIVERS.filter((dv) => !candidates.some((c) => c.key === dv.key)),
    [candidates],
  );

  useEffect(() => {
    if (!analysis || !isNum(base) || !candidates.length) { setRaw(null); return; }
    const mine = ++seq.current;
    const ac = new AbortController();
    setBusy(true);
    (async () => {
      const out: Raw[] = [];
      const miss: string[] = [];
      await Promise.all(candidates.map(async (dv) => {
        try {
          const r = await fetch('/api/sensitivity', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            signal: ac.signal,
            body: JSON.stringify({
              inputs, rowDriver: dv.key, colDriver: null,
              metric: metricKey, swing, steps: 3,
            }),
          });
          const j = await r.json();
          if (!j?.ok || !Array.isArray(j.cells)) { miss.push(dv.label); return; }
          const [lo, , hi] = j.cells;
          if (!isNum(lo) && !isNum(hi)) { miss.push(dv.label); return; }
          out.push({ key: dv.key, label: dv.label, low: isNum(lo) ? lo : null, high: isNum(hi) ? hi : null });
        } catch { miss.push(dv.label); }
      }));
      if (mine !== seq.current) return;
      setRaw(out); setDropped([...miss, ...unset.map((u) => u.label)]); setBusy(false);
    })();
    return () => { ac.abort(); };
    // inputs is a fresh object on every keystroke upstream; the analysis it
    // produced is the stable stand-in for "the numbers changed"
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, metricKey, swing, candidates]);

  const rows = raw && isNum(base) ? tornadoRows(base, raw) : [];

  const controls = (
    <div className={`vd-ctl${busy ? ' busy' : ''}`}>
      <label>Measure
        <select value={metricKey} onChange={(e) => setMetricKey(e.target.value)}>
          {TORNADO_METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </label>
      <label>Swing each driver by
        <select value={swing} onChange={(e) => setSwing(Number(e.target.value))}>
          {SWINGS.map((s) => <option key={s} value={s}>±{s}%</option>)}
        </select>
      </label>
    </div>
  );

  if (!isNum(base)) return (
    <figure className="vd-chart">
      <figcaption>Sensitivity — ranked drivers</figcaption>
      {controls}
      <p className="vd-empty">
        {metric.label} is not available for this scheme, so there is no base case to swing around.
      </p>
    </figure>
  );

  const W = 1000, pl = 300, pr = 150, pt = 34, pb = 26, rowH = 30;
  const H = pt + Math.max(1, rows.length) * rowH + pb;
  const maxAbs = Math.max(1e-9, ...rows.flatMap((r) => [Math.abs(r.downside), Math.abs(r.upside)]));
  const cx = pl + (W - pl - pr) / 2, half = (W - pl - pr) / 2 - 8;
  const S = (v: number) => cx + (v / maxAbs) * half;

  return (
    <figure className="vd-chart">
      <figcaption>
        Sensitivity — ranked drivers
        <span className="vd-sub">
          impact on {metric.label} · base {metric.fmt(base)} · ±{swing}% on each driver
        </span>
      </figcaption>
      {controls}

      {/* "not run yet" and "run, and nothing moved" are different statements
          and must not share a message: the first is the tool still working,
          the second is a finding about the scheme. */}
      {!candidates.length && (
        <p className="vd-empty">
          None of the ranked drivers is set in this scheme, so there is nothing to swing.
        </p>
      )}
      {!!candidates.length && raw === null && (
        <p className="vd-empty">Running the model at each swung input…</p>
      )}
      {!!candidates.length && raw !== null && !rows.length && (
        <p className="vd-empty">
          No driver moved {metric.label} at ±{swing}%. Either the inputs those drivers
          feed are unset, or this scheme is genuinely flat to them.
        </p>
      )}

      {!!rows.length && (
        <svg viewBox={`0 0 ${W} ${H}`} role="img" className="vd-svg"
          aria-label={`Tornado chart ranking ${rows.length} drivers by their effect on ` +
            `${metric.label}, base case ${metric.fmt(base)}`}>
          <text className="vd-ttl" x={pl} y={16}>▼ Downside</text>
          <text className="vd-ttl" x={cx} y={16} textAnchor="middle">Base case {metric.fmt(base)}</text>
          <text className="vd-ttl" x={W - pr} y={16} textAnchor="end">Upside ▲</text>
          <line className="vd-axis" x1={cx} y1={24} x2={cx} y2={H - pb + 2} strokeWidth={1.3} />

          {rows.map((r, i) => {
            const y = pt + i * rowH;
            const x1 = S(r.downside), x2 = S(r.upside);
            const downLab = r.lowIsDownside ? `−${swing}%` : `+${swing}%`;
            const upLab = r.lowIsDownside ? `+${swing}%` : `−${swing}%`;
            return (
              <g key={r.key}>
                <text className="vd-axlab vd-driver" x={pl - 92} y={y + 13} textAnchor="end">{r.label}</text>
                <text className="vd-axlab" x={pl - 14} y={y + 13} textAnchor="end">▼ {downLab}</text>
                {/* both ends are measured FROM the centre, and either end can
                    land on either side of it — a driver whose whole range
                    improves the metric has both bars to the right. Taking the
                    span as an absolute keeps the bar on the correct side
                    instead of collapsing to a stub. */}
                <rect x={Math.min(cx, x1)} y={y + 3} width={Math.max(1.5, Math.abs(cx - x1))}
                  height={14} rx={1.5} fill="#9CB6DA" stroke="#4A6B99" strokeWidth={0.8}>
                  <title>{`${r.label} ${downLab}: ${metric.fmt(r.downside + base)}`}</title>
                </rect>
                <rect x={Math.min(cx, x2)} y={y + 3} width={Math.max(1.5, Math.abs(x2 - cx))}
                  height={14} rx={1.5} fill="#0C356B" stroke="#0C356B" strokeWidth={0.8}>
                  <title>{`${r.label} ${upLab}: ${metric.fmt(r.upside + base)}`}</title>
                </rect>
                <text className="vd-axlab" x={W - pr + 12} y={y + 13}>▲ {upLab}</text>
              </g>
            );
          })}

          {/* the axis measures the IMPACT either side of the base case, as the
              single-file build did — not the absolute metric */}
          {[-maxAbs, -maxAbs / 2, 0, maxAbs / 2, maxAbs].map((v, i) => (
            <text key={i} className="vd-axlab" x={S(v)} y={H - 7} textAnchor="middle">
              {metric.fmt(v)}
            </text>
          ))}
        </svg>
      )}

      {!!dropped.length && (
        <p className="vd-note">
          Not ranked, because the inputs behind them are unset in this scheme and a
          percentage of nothing is nothing: {dropped.join(', ')}.
        </p>
      )}
    </figure>
  );
}
