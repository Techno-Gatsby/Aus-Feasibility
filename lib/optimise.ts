/** Root finding for "what value of X hits target Y".
 *
 *  The engine ships solveLand/solveDriver, but they evaluate an endpoint at
 *  zero first and abandon the search if the metric is undefined there. That
 *  is a real case: at a land price of zero this model returns a null equity
 *  IRR (there is no meaningful equity outflow to measure against), so
 *  solveLand reports "no solution" for a 20% IRR target even though the
 *  curve crosses 20% between $25,000 and $31,234 per sqm.
 *
 *  This scans the interior, ignores undefined samples rather than stopping
 *  at them, and bisects the first bracket it finds. It also reports WHY it
 *  failed, because "no land price achieves this" and "the metric is
 *  undefined across the range" are different answers for a buyer.
 */

export type SolveResult = {
  value: number | null;
  achieved: number | null;
  reason: 'ok' | 'no-crossing' | 'undefined-metric' | 'target-below-range' | 'target-above-range';
  samples: { x: number; y: number | null }[];
};

export function solve(
  evaluate: (x: number) => number | null,
  target: number,
  lo: number,
  hi: number,
  steps = 24,
  tol = 1e-4,
): SolveResult {
  const samples: { x: number; y: number | null }[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = lo + ((hi - lo) * i) / steps;
    samples.push({ x, y: evaluate(x) });
  }
  const defined = samples.filter((s) => s.y != null) as { x: number; y: number }[];
  if (defined.length < 2)
    return { value: null, achieved: null, reason: 'undefined-metric', samples };

  // first bracket between CONSECUTIVE defined samples; skipping over an
  // undefined gap would invent a crossing that may not exist
  let a: { x: number; y: number } | null = null;
  let b: { x: number; y: number } | null = null;
  for (let i = 0; i + 1 < samples.length; i++) {
    const p = samples[i], q = samples[i + 1];
    if (p.y == null || q.y == null) continue;
    if ((p.y - target) * (q.y - target) <= 0) {
      a = p as any; b = q as any; break;
    }
  }
  if (!a || !b) {
    const ys = defined.map((s) => s.y);
    const min = Math.min(...ys), max = Math.max(...ys);
    return {
      value: null, achieved: null, samples,
      reason: target < min ? 'target-below-range'
            : target > max ? 'target-above-range' : 'no-crossing',
    };
  }

  let loX = a.x, hiX = b.x, loY = a.y;
  for (let i = 0; i < 60; i++) {
    const mid = (loX + hiX) / 2;
    const y = evaluate(mid);
    if (y == null) break;                    // undefined inside the bracket
    if (Math.abs(y - target) < tol) return { value: mid, achieved: y, reason: 'ok', samples };
    if ((loY - target) * (y - target) <= 0) hiX = mid; else { loX = mid; loY = y; }
  }
  const mid = (loX + hiX) / 2;
  return { value: mid, achieved: evaluate(mid), reason: 'ok', samples };
}

export const REASON_TEXT: Record<SolveResult['reason'], string> = {
  ok: '',
  'no-crossing': 'The metric never reaches the target anywhere in the range searched.',
  'undefined-metric':
    'The metric is undefined across most of the range — the model cannot produce ' +
    'a meaningful figure here, which is not the same as the target being unreachable.',
  'target-below-range': 'The target is below everything achievable in this range.',
  'target-above-range': 'The target is above everything achievable in this range.',
};
