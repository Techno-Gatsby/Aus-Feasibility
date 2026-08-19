'use client';

/** TERRAIN 3D — the shape of the ground under the drawn site.
 *
 *  WHY THIS EXISTS
 *  Street View shows the frontage. On raw development land the frontage is not
 *  the problem: the problem is where the water goes, which way the site falls,
 *  and how many cubic metres have to move before anything can be built on it.
 *  A slope percentage is one number for the whole site and it hides the shape —
 *  a 7% site that falls evenly is a different job from a 7% site that is flat
 *  at the front and drops off a bench at the back. This draws the surface.
 *
 *  HOW IT IS DRAWN — and why there is no dependency
 *  Plain 2-D canvas. Grid cells are projected with an orthographic yaw/tilt,
 *  sorted back to front and painted. No WebGL, no three.js, no npm install.
 *  The reference build for the US used three.js; here the whole repo has no
 *  charting dependency and it stays that way. An orthographic surface is
 *  actually the better fit for this job anyway — no perspective foreshortening
 *  means the scale bar is valid everywhere on the picture.
 *
 *  THE THINGS THIS REFUSES TO DO
 *  1. It never draws a plane it did not measure. No data means the panel says
 *     so; it does not render a flat surface, because a flat render is
 *     indistinguishable from a genuinely flat site and that is the exact
 *     mistake that costs money.
 *  2. The vertical exaggeration is stamped ON THE CANVAS, not just next to the
 *     slider, so a screenshot of a 5x hillside cannot be mistaken for the site.
 *  3. Height is never carried by colour alone: the tints are quantised to the
 *     contour interval, real contour lines are drawn on the surface, index
 *     contours are labelled in metres, and the high and low points carry their
 *     values.
 *  4. The source resolution travels with the picture. A ~30 m DEM is told to
 *     the reader in the same breath as the shape it produced, and when the
 *     site's whole fall is inside the source's own vertical error the panel
 *     says the shape is noise rather than letting it be read as ground.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { sampleSurface } from '@/lib/terrain3d';

type Surface = Awaited<ReturnType<typeof sampleSurface>>;

export type Terrain3DProps = {
  /** Map pin. Used when no polygon has been drawn. */
  point: { lat: number; lng: number } | null;
  /** Drawn site rings in SiteMap's own convention: [lat, lng] pairs, outer
   *  ring first then holes. Pass SiteMap's `onShape` payload straight through. */
  rings?: [number, number][][] | null;
  /** Half-width of the sampled square when there is no polygon, in metres. */
  halfM?: number;
};

const DEG = Math.PI / 180;
const M_PER_LAT = 110574;
const mPerLng = (lat: number) => 111320 * Math.cos(lat * DEG);

/** Vertical error of each source, metres. This is the number that decides
 *  whether a small relief figure is ground or noise. SRTM's published vertical
 *  accuracy is around 6 m RMSE and it is a radar first-return surface, so over
 *  timber and rooftops it reads high as well as noisy. */
const VERTICAL_NOISE_M: Record<string, number> = {
  nsw5m: 0.5,
  google: 3,
  terrarium: 6,
};

/** What each resolution genuinely resolves, in the language of a site visit. */
function resolutionCaveat(resM: number | null): string {
  if (resM === null) return 'The source did not report its resolution, so nothing here should be read as a measured level.';
  if (resM <= 2) return 'At this post spacing a benched terrace and a batter are visible; a kerb, a retaining wall and a single building pad are not.';
  if (resM <= 8) return `~${Math.round(resM)} m posts show benches, gullies and the main fall. They cannot show a 2 m retaining wall, a table drain, a batter or a building pad.`;
  return `~${Math.round(resM)} m posts show catchment and gross fall only. A 2 m retaining wall, a driveway grade, a swale, a batter and a building pad are all smaller than one sample and are simply not in this data.`;
}

/* ── colour ─────────────────────────────────────────────────────────────── */
/** Hypsometric tints, low to high. Quantised to the contour interval before
 *  use, so every colour on screen maps to a labelled band in the legend. */
const RAMP: [number, number, number][] = [
  [ 46, 104,  78], [ 79, 132,  84], [126, 156,  86], [176, 178,  96],
  [206, 178, 110], [196, 145,  95], [170, 112,  83], [140,  88,  74],
  [131, 110, 106], [176, 168, 166],
];

function rampAt(t: number): [number, number, number] {
  const u = Math.max(0, Math.min(1, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(u));
  const f = u - i;
  const a = RAMP[i], b = RAMP[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

const rgb = (c: [number, number, number], k = 1) =>
  `rgb(${Math.round(Math.max(0, Math.min(255, c[0] * k)))},` +
  `${Math.round(Math.max(0, Math.min(255, c[1] * k)))},` +
  `${Math.round(Math.max(0, Math.min(255, c[2] * k)))})`;

/** 1, 2 or 5 x 10^n — the intervals a contour map is actually drawn at. */
function niceStep(x: number): number {
  if (!(x > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(x));
  const f = x / p;
  return (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * p;
}

const fmt = (v: number, dp = 1) =>
  v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });

export default function Terrain3D({ point, rings, halfM = 120 }: Terrain3DProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cvsRef = useRef<HTMLCanvasElement>(null);

  const [data, setData] = useState<Surface | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [err, setErr] = useState<string | null>(null);

  const [exag, setExag] = useState(2);
  const [yaw, setYaw] = useState(-35 * DEG);
  const [pitch, setPitch] = useState(38 * DEG);
  const [zoom, setZoom] = useState(1);

  /* ── the footprint ─────────────────────────────────────────────────────
     A drawn polygon wins over the pin. The box is padded so the ground just
     outside the boundary is visible: where the water leaves the site matters
     as much as what happens inside it. */
  const outer = useMemo<[number, number][] | null>(() => {
    const r = rings?.[0];
    return Array.isArray(r) && r.length >= 3 ? r : null;
  }, [rings]);

  const bbox = useMemo<[number, number, number, number] | null>(() => {
    if (outer) {
      const lats = outer.map((p) => Number(p[0])).filter(Number.isFinite);
      const lngs = outer.map((p) => Number(p[1])).filter(Number.isFinite);
      if (lats.length >= 3) {
        let [s, n] = [Math.min(...lats), Math.max(...lats)];
        let [w, e] = [Math.min(...lngs), Math.max(...lngs)];
        const padY = Math.max((n - s) * 0.2, 40 / M_PER_LAT);
        const padX = Math.max((e - w) * 0.2, 40 / Math.max(1, mPerLng((s + n) / 2)));
        return [w - padX, s - padY, e + padX, n + padY];
      }
    }
    if (point) {
      const dLat = halfM / M_PER_LAT;
      const dLng = halfM / Math.max(1, mPerLng(point.lat));
      return [point.lng - dLng, point.lat - dLat, point.lng + dLng, point.lat + dLat];
    }
    return null;
  }, [outer, point, halfM]);

  const bboxKey = bbox ? bbox.map((v) => v.toFixed(6)).join(',') : '';

  useEffect(() => {
    if (!bbox) { setState('idle'); setData(null); return; }
    let dead = false;
    setState('loading'); setErr(null);
    sampleSurface(bbox)
      .then((r) => {
        if (dead) return;
        setData(r);
        setState(r.ok ? 'ready' : 'error');
        if (!r.ok) setErr(r.reason ?? 'no elevation returned');
      })
      .catch((e: unknown) => {
        if (dead) return;
        setData(null); setState('error');
        setErr(e instanceof Error ? e.message : String(e));
      });
    return () => { dead = true; };
    // bboxKey, not bbox: a new array with identical numbers must not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bboxKey]);

  /* ── derived readings ──────────────────────────────────────────────────── */
  const relief = data?.ok ? data.reliefM ?? 0 : 0;
  const noiseM = data?.source ? VERTICAL_NOISE_M[data.source] ?? 6 : 6;
  /** True when the entire fall across the site is inside the source's own
   *  vertical error. The picture is then a picture of the error. */
  const reliefIsNoise = !!data?.ok && relief < noiseM * 2;
  /** Contour interval. Floored at a quarter of the source's vertical error as
   *  well as at a fraction of the relief: drawing 0.5 m contours off a dataset
   *  that is ±6 m vertically is drawing the error at four times life size, and
   *  a reader counts contour lines. */
  const step = useMemo(
    () => niceStep(Math.max(relief / 8, noiseM / 4, 0.05)),
    [relief, noiseM],
  );

  /* ── render ────────────────────────────────────────────────────────────── */
  const draw = useCallback(() => {
    const cvs = cvsRef.current, wrap = wrapRef.current;
    if (!cvs || !wrap) return;
    const cw = Math.max(280, wrap.clientWidth);
    const ch = Math.max(260, Math.round(Math.min(560, Math.max(320, cw * 0.62))));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (cvs.width !== Math.round(cw * dpr) || cvs.height !== Math.round(ch * dpr)) {
      cvs.width = Math.round(cw * dpr); cvs.height = Math.round(ch * dpr);
      cvs.style.width = `${cw}px`; cvs.style.height = `${ch}px`;
    }
    const g = cvs.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = '#0E1826';
    g.fillRect(0, 0, cw, ch);

    if (!data?.ok) return;
    const { n, elev, widthM, heightM, minM, maxM } = data;
    if (minM === null || maxM === null || n < 2) return;

    /* world coords: metres, centred on the box, +Y north, Z up (exaggerated) */
    const wx = (j: number) => (j / (n - 1) - 0.5) * widthM;
    const wy = (i: number) => (i / (n - 1) - 0.5) * heightM;
    const wz = (z: number) => (z - minM) * exag;

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const proj = (X: number, Y: number, Z: number) => {
      const xr = X * cy - Y * sy;
      const yr = X * sy + Y * cy;
      return { x: xr, y: -(yr * sp + Z * cp), d: yr };
    };

    /* fit: project every grid node, then scale the extent into the canvas */
    let px0 = Infinity, px1 = -Infinity, py0 = Infinity, py1 = -Infinity;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const z = elev[i * n + j];
        const p = proj(wx(j), wy(i), wz(typeof z === 'number' ? z : minM));
        if (p.x < px0) px0 = p.x; if (p.x > px1) px1 = p.x;
        if (p.y < py0) py0 = p.y; if (p.y > py1) py1 = p.y;
      }
    }
    const pad = 46;
    const scale = Math.min((cw - pad * 2) / Math.max(1e-6, px1 - px0),
                           (ch - pad * 2 - 26) / Math.max(1e-6, py1 - py0)) * zoom;
    const ox = cw / 2 - ((px0 + px1) / 2) * scale;
    const oy = ch / 2 + 8 - ((py0 + py1) / 2) * scale;
    const S = (X: number, Y: number, Z: number) => {
      const p = proj(X, Y, Z);
      return { x: ox + p.x * scale, y: oy + p.y * scale, d: p.d };
    };

    const at = (i: number, j: number) => {
      const v = elev[i * n + j];
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    };

    /* contour levels, shared by the tints and the lines so a colour boundary
       and a contour are the same thing rather than two rival stories */
    const base = Math.floor(minM / step) * step;
    const levels: number[] = [];
    for (let L = base + step; L < maxM; L += step) levels.push(L);
    // index contours every 5th, drawn heavier and labelled
    const isIndex = (L: number) => Math.round((L - base) / step) % 5 === 0;

    /* fixed NW light at 45 deg: rotating the model must not restyle the
       ground, or two screenshots of the same site disagree */
    const az = 315 * DEG, alt = 45 * DEG;
    const L: [number, number, number] =
      [Math.sin(az) * Math.cos(alt), Math.cos(az) * Math.cos(alt), Math.sin(alt)];

    const dx = widthM / (n - 1), dy = heightM / (n - 1);
    const span = Math.max(maxM - minM, 1e-6);

    type Cell = { i: number; j: number; d: number };
    const cells: Cell[] = [];
    for (let i = 0; i < n - 1; i++) {
      for (let j = 0; j < n - 1; j++) {
        const p = proj((wx(j) + wx(j + 1)) / 2, (wy(i) + wy(i + 1)) / 2, 0);
        cells.push({ i, j, d: p.d });
      }
    }
    cells.sort((a, b) => b.d - a.d);   // far first

    const labelSlots: { L: number; x: number; y: number }[] = [];
    let holes = 0;

    for (const c of cells) {
      const { i, j } = c;
      const z00 = at(i, j), z01 = at(i, j + 1), z10 = at(i + 1, j), z11 = at(i + 1, j + 1);
      if (z00 === null || z01 === null || z10 === null || z11 === null) { holes++; continue; }

      const a = S(wx(j), wy(i), wz(z00));
      const b = S(wx(j + 1), wy(i), wz(z01));
      const d = S(wx(j + 1), wy(i + 1), wz(z11));
      const e = S(wx(j), wy(i + 1), wz(z10));

      // slope of the exaggerated surface, so the shading matches the picture
      const gx = ((z01 + z11) - (z00 + z10)) * 0.5 * exag / dx;
      const gy = ((z10 + z11) - (z00 + z01)) * 0.5 * exag / dy;
      const nl = Math.hypot(gx, gy, 1);
      const dot = (-gx * L[0] - gy * L[1] + L[2]) / nl;
      const shade = 0.42 + 0.78 * Math.max(0, dot);

      const mid = (z00 + z01 + z10 + z11) / 4;
      // quantise to the contour band: the fill and the legend are the same scale
      const bandCentre = base + (Math.floor((mid - base) / step) + 0.5) * step;
      const col = rampAt((bandCentre - minM) / span);

      g.beginPath();
      g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); g.lineTo(d.x, d.y); g.lineTo(e.x, e.y);
      g.closePath();
      g.fillStyle = rgb(col, shade);
      g.fill();
      // hairline in the fill colour closes the seams between quads without
      // drawing a wireframe that would read as survey grid
      g.strokeStyle = rgb(col, shade); g.lineWidth = 0.6; g.stroke();

      /* contours inside this cell, painted immediately after it so the
         painter's ordering hides the ones behind a ridge */
      const tris: [number, number, number][][] = [
        [[wx(j), wy(i), z00], [wx(j + 1), wy(i), z01], [wx(j + 1), wy(i + 1), z11]],
        [[wx(j), wy(i), z00], [wx(j + 1), wy(i + 1), z11], [wx(j), wy(i + 1), z10]],
      ];
      const lo = Math.min(z00, z01, z10, z11), hi = Math.max(z00, z01, z10, z11);
      for (const Lv of levels) {
        if (Lv <= lo || Lv >= hi) continue;
        for (const T of tris) {
          const hits: { x: number; y: number }[] = [];
          for (let k = 0; k < 3; k++) {
            const p = T[k], q = T[(k + 1) % 3];
            if ((p[2] < Lv) === (q[2] < Lv)) continue;
            const t = (Lv - p[2]) / (q[2] - p[2]);
            hits.push(S(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, wz(Lv)));
          }
          if (hits.length !== 2) continue;
          const idx = isIndex(Lv);
          g.beginPath(); g.moveTo(hits[0].x, hits[0].y); g.lineTo(hits[1].x, hits[1].y);
          g.strokeStyle = idx ? 'rgba(16,26,40,.85)' : 'rgba(22,34,52,.42)';
          g.lineWidth = idx ? 1.5 : 0.8;
          g.stroke();
          if (idx && labelSlots.length < 40) {
            labelSlots.push({ L: Lv, x: (hits[0].x + hits[1].x) / 2, y: (hits[0].y + hits[1].y) / 2 });
          }
        }
      }
    }

    /* ── the drawn site, draped ────────────────────────────────────────────
       Each edge is densified before draping, otherwise the boundary cuts a
       straight line through a hill it is supposed to run over. */
    const [bw, bs, be, bn] = data.bbox;
    const sampleAt = (lat: number, lng: number): number | null => {
      const fx = ((lng - bw) / (be - bw)) * (n - 1);
      const fy = ((lat - bs) / (bn - bs)) * (n - 1);
      const j0 = Math.max(0, Math.min(n - 2, Math.floor(fx)));
      const i0 = Math.max(0, Math.min(n - 2, Math.floor(fy)));
      const tx = Math.max(0, Math.min(1, fx - j0)), ty = Math.max(0, Math.min(1, fy - i0));
      const q = [at(i0, j0), at(i0, j0 + 1), at(i0 + 1, j0), at(i0 + 1, j0 + 1)];
      if (q.some((v) => v === null)) {
        const ok = q.filter((v): v is number => v !== null);
        return ok.length ? ok.reduce((s2, v) => s2 + v, 0) / ok.length : null;
      }
      return (q[0]! * (1 - tx) + q[1]! * tx) * (1 - ty) + (q[2]! * (1 - tx) + q[3]! * tx) * ty;
    };
    const toWorld = (lat: number, lng: number) => ({
      X: ((lng - bw) / (be - bw) - 0.5) * widthM,
      Y: ((lat - bs) / (bn - bs) - 0.5) * heightM,
    });

    if (rings?.length) {
      for (const ring of rings) {
        if (!Array.isArray(ring) || ring.length < 3) continue;
        const pts: { x: number; y: number }[] = [];
        for (let k = 0; k < ring.length; k++) {
          const p = ring[k], q = ring[(k + 1) % ring.length];
          if (!Number.isFinite(p?.[0]) || !Number.isFinite(q?.[0])) continue;
          const steps = 14;
          for (let t = 0; t < steps; t++) {
            const f = t / steps;
            const lat = p[0] + (q[0] - p[0]) * f, lng = p[1] + (q[1] - p[1]) * f;
            const z = sampleAt(lat, lng);
            if (z === null) continue;
            const w2 = toWorld(lat, lng);
            // lift a touch off the surface so the line is not z-fighting the
            // quad it sits on
            pts.push(S(w2.X, w2.Y, wz(z) + span * exag * 0.012 + 0.3));
          }
        }
        if (pts.length < 3) continue;
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
        g.closePath();
        g.fillStyle = 'rgba(245,158,11,.15)'; g.fill();
        g.lineJoin = 'round';
        g.strokeStyle = 'rgba(10,16,26,.55)'; g.lineWidth = 4; g.stroke();
        g.strokeStyle = '#FBBF24'; g.lineWidth = 2; g.stroke();
      }
    }

    /* ── labels ────────────────────────────────────────────────────────── */
    const halo = (text: string, x: number, y: number, font: string, fill = '#F8FAFC') => {
      g.font = font; g.textAlign = 'left'; g.textBaseline = 'middle';
      g.lineWidth = 3.4; g.strokeStyle = 'rgba(8,14,24,.92)';
      g.strokeText(text, x, y); g.fillStyle = fill; g.fillText(text, x, y);
    };

    // index contour values, thinned so they do not tile the surface
    const shown: { x: number; y: number }[] = [];
    const usedLevels = new Set<number>();
    const slots = labelSlots.sort((p, q) => p.x - q.x);
    // Two passes: one label per distinct height first, then repeats along long
    // contours. Five labels all reading "52 m" tells the reader one height;
    // five reading 42/52/62 tells them the interval and the direction of fall.
    for (const distinctOnly of [true, false]) {
      for (const s2 of slots) {
        if (shown.length >= 5) break;
        if (distinctOnly && usedLevels.has(s2.L)) continue;
        if (shown.some((o) => Math.hypot(o.x - s2.x, o.y - s2.y) < 96)) continue;
        shown.push(s2); usedLevels.add(s2.L);
        halo(`${fmt(s2.L, s2.L % 1 ? 1 : 0)} m`, s2.x + 5, s2.y,
          '600 10px var(--mono, monospace)', '#E2E8F0');
      }
    }

    // high and low points, with their values
    let loI = 0, hiI = 0, loV = Infinity, hiV = -Infinity;
    for (let k = 0; k < elev.length; k++) {
      const v = elev[k];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      if (v < loV) { loV = v; loI = k; }
      if (v > hiV) { hiV = v; hiI = k; }
    }
    for (const [k, v, tag, colr] of [[hiI, hiV, 'HIGH', '#FDE68A'], [loI, loV, 'LOW', '#93C5FD']] as const) {
      const i = Math.floor(k / n), j = k % n;
      const p = S(wx(j), wy(i), wz(v));
      g.beginPath(); g.arc(p.x, p.y, 3.6, 0, Math.PI * 2);
      g.fillStyle = colr; g.fill();
      g.lineWidth = 1.4; g.strokeStyle = 'rgba(8,14,24,.9)'; g.stroke();
      halo(`${tag} ${fmt(v)} m`, p.x + 7, p.y - 8, '600 10.5px var(--mono, monospace)', colr);
    }

    /* ── the exaggeration stamp. On the canvas, always, because a screenshot
         of this panel travels without the slider next to it. ─────────────── */
    const stamp = exag === 1 ? 'VERTICAL 1:1 — TRUE SHAPE' : `VERTICAL ${exag}× EXAGGERATED`;
    g.font = '700 11px var(--sans, sans-serif)';
    const sw = g.measureText(stamp).width;
    g.fillStyle = exag === 1 ? 'rgba(20,68,48,.94)' : 'rgba(122,86,20,.96)';
    g.fillRect(10, 10, sw + 18, 24);
    g.strokeStyle = exag === 1 ? '#34D399' : '#FBBF24'; g.lineWidth = 1;
    g.strokeRect(10.5, 10.5, sw + 17, 23);
    g.fillStyle = exag === 1 ? '#D1FAE5' : '#FEF3C7';
    g.textBaseline = 'middle'; g.textAlign = 'left';
    g.fillText(stamp, 19, 23);

    halo(`Contours ${fmt(step, step % 1 ? 1 : 0)} m · relief ${fmt(relief)} m`,
      10, 48, '500 10.5px var(--sans, sans-serif)', '#CBD5E1');
    if (holes) {
      halo(`${holes} cell${holes === 1 ? '' : 's'} not drawn — no elevation there`,
        10, 64, '500 10.5px var(--sans, sans-serif)', '#FCA5A5');
    }

    /* scale bar — valid across the whole picture because the projection is
       orthographic, so there is no near/far foreshortening to spoil it */
    const barTarget = (cw - 120) * 0.22 / scale;
    const barM = niceStep(barTarget);
    const barPx = barM * scale;
    const bx = 12, by = ch - 16;
    g.strokeStyle = 'rgba(8,14,24,.9)'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + barPx, by); g.stroke();
    g.strokeStyle = '#E2E8F0'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + barPx, by); g.stroke();
    g.beginPath(); g.moveTo(bx, by - 4); g.lineTo(bx, by + 4);
    g.moveTo(bx + barPx, by - 4); g.lineTo(bx + barPx, by + 4); g.stroke();
    halo(`${barM >= 1000 ? `${fmt(barM / 1000, 1)} km` : `${Math.round(barM)} m`} horizontal`,
      bx, by - 13, '600 10.5px var(--mono, monospace)', '#E2E8F0');

    /* north arrow — the surface rotates, so the reader needs this to know
       which way the site actually falls */
    const nx = cw - 32, ny = ch - 34, r = 15;
    g.beginPath(); g.arc(nx, ny, r + 4, 0, Math.PI * 2);
    g.fillStyle = 'rgba(8,14,24,.62)'; g.fill();
    const north = { X: 0, Y: 1 };
    const nrx = (north.X * cy - north.Y * sy);
    const nry = -((north.X * sy + north.Y * cy) * sp);
    const nl2 = Math.hypot(nrx, nry) || 1;
    const ax = (nrx / nl2) * r, ay = (nry / nl2) * r;
    g.beginPath(); g.moveTo(nx - ax * 0.7, ny - ay * 0.7); g.lineTo(nx + ax, ny + ay);
    g.strokeStyle = '#F8FAFC'; g.lineWidth = 2; g.lineCap = 'round'; g.stroke();
    g.beginPath();
    g.moveTo(nx + ax, ny + ay);
    g.lineTo(nx + ax * 0.55 - ay * 0.3, ny + ay * 0.55 + ax * 0.3);
    g.lineTo(nx + ax * 0.55 + ay * 0.3, ny + ay * 0.55 - ax * 0.3);
    g.closePath(); g.fillStyle = '#F8FAFC'; g.fill();
    g.font = '700 9.5px var(--sans, sans-serif)'; g.textAlign = 'center';
    g.fillStyle = '#F8FAFC'; g.fillText('N', nx + ax * 1.5, ny + ay * 1.5 + 3);
    g.textAlign = 'left';
  }, [data, exag, yaw, pitch, zoom, rings, step, relief]);

  /* draw on change, coalesced to one frame */
  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [draw]);

  /* drag to orbit */
  useEffect(() => {
    const cvs = cvsRef.current;
    if (!cvs) return;
    let drag = false, lx = 0, ly = 0;
    const down = (ev: PointerEvent) => {
      drag = true; lx = ev.clientX; ly = ev.clientY;
      cvs.setPointerCapture(ev.pointerId);
    };
    const move = (ev: PointerEvent) => {
      if (!drag) return;
      setYaw((v) => v - (ev.clientX - lx) * 0.006);
      setPitch((v) => Math.max(8 * DEG, Math.min(88 * DEG, v + (ev.clientY - ly) * 0.005)));
      lx = ev.clientX; ly = ev.clientY;
    };
    const up = (ev: PointerEvent) => {
      drag = false;
      try { cvs.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
    };
    const wheel = (ev: WheelEvent) => {
      ev.preventDefault();
      setZoom((z) => Math.max(0.6, Math.min(4, z * (1 - Math.sign(ev.deltaY) * 0.12))));
    };
    cvs.addEventListener('pointerdown', down);
    cvs.addEventListener('pointermove', move);
    cvs.addEventListener('pointerup', up);
    cvs.addEventListener('pointercancel', up);
    cvs.addEventListener('wheel', wheel, { passive: false });
    return () => {
      cvs.removeEventListener('pointerdown', down);
      cvs.removeEventListener('pointermove', move);
      cvs.removeEventListener('pointerup', up);
      cvs.removeEventListener('pointercancel', up);
      cvs.removeEventListener('wheel', wheel);
    };
  }, []);

  /* ── Google Earth: free, no key, no tile bill ──────────────────────────
     Same deep-link shape the single-file build used, but the altitude and the
     camera distance are derived from this site instead of hard-coded 600a/1200d,
     so the camera arrives at the ground rather than under a ridge or in orbit. */
  const earthUrl = useMemo(() => {
    if (!bbox) return null;
    const lat = (bbox[1] + bbox[3]) / 2, lng = (bbox[0] + bbox[2]) / 2;
    const spanM = Math.hypot(
      (bbox[2] - bbox[0]) * mPerLng(lat), (bbox[3] - bbox[1]) * M_PER_LAT);
    const a = Math.round(data?.ok && data.meanM !== null ? data.meanM : 0);
    const d = Math.round(Math.max(300, Math.min(12000, spanM * 2.4)));
    return `https://earth.google.com/web/@${lat.toFixed(6)},${lng.toFixed(6)},` +
      `${a}a,${d}d,35y,0h,45t,0r`;
  }, [bbox, data]);

  /* ── legend bands, numeric ─────────────────────────────────────────────── */
  const bands = useMemo(() => {
    if (!data?.ok || data.minM === null || data.maxM === null) return [];
    const base = Math.floor(data.minM / step) * step;
    const out: { lo: number; hi: number; css: string }[] = [];
    const span = Math.max(data.maxM - data.minM, 1e-6);
    for (let L = base; L < data.maxM; L += step) {
      out.push({
        lo: Math.max(L, data.minM), hi: Math.min(L + step, data.maxM),
        css: rgb(rampAt((L + step / 2 - data.minM) / span)),
      });
      if (out.length > 24) break;
    }
    return out.reverse();
  }, [data, step]);

  /* ── shell ─────────────────────────────────────────────────────────────── */
  return (
    <section className="t3d">
      <h3>Ground shape (3D)</h3>

      {!bbox ? (
        <p className="muted">Pick a point on the map, or draw the site, to build a
          surface. Nothing is drawn until there is a footprint to sample.</p>
      ) : (
        <>
          <div className="t3d-bar">
            <label className="t3d-exag">
              <span>Vertical exaggeration</span>
              <input
                type="range" min={1} max={8} step={0.5} value={exag}
                onChange={(ev) => setExag(Number(ev.target.value))}
                aria-label="Vertical exaggeration"
              />
              <b className={exag === 1 ? 'ok' : 'warn'}>{exag}×</b>
            </label>
            <button type="button" onClick={() => { setYaw(-35 * DEG); setPitch(38 * DEG); setZoom(1); }}>
              Reset view
            </button>
            {earthUrl && (
              <a className="t3d-earth" href={earthUrl} target="_blank" rel="noopener noreferrer">
                Open in Google Earth ↗
              </a>
            )}
          </div>

          <div className="t3d-stage" ref={wrapRef}>
            <canvas
              ref={cvsRef} className="t3d-canvas"
              role="img"
              aria-label={
                data?.ok
                  ? `Terrain surface, ${fmt(data.minM ?? 0)} to ${fmt(data.maxM ?? 0)} metres, ` +
                    `${fmt(relief)} metres of relief, drawn at ${exag} times vertical exaggeration ` +
                    `from ${data.sourceLabel}.`
                  : 'No terrain surface is drawn.'
              }
            />
            {state === 'loading' && <div className="t3d-veil">Sampling elevation…</div>}
            {state === 'error' && (
              <div className="t3d-veil bad">
                <b>No surface drawn.</b>
                <span>{err}</span>
              </div>
            )}
          </div>

          {data?.ok && (
            <>
              <div className="t3d-legend" aria-label="Elevation bands">
                {bands.map((b, i) => (
                  <span className="t3d-band" key={i}>
                    <i style={{ background: b.css }} />
                    {fmt(b.lo, step % 1 ? 1 : 0)}–{fmt(b.hi, step % 1 ? 1 : 0)} m
                  </span>
                ))}
              </div>

              <div className="t3d-facts">
                <Row k="Relief across the box" v={`${fmt(relief)} m (${fmt(data.minM!)} – ${fmt(data.maxM!)} m)`} />
                {data.slopePct !== null && (
                  <Row k="Average grade" v={`${fmt(data.slopePct)}%${data.grade ? ` · ${data.grade}` : ''}`}
                       cls={data.slopePct >= 8 ? 'bad' : data.slopePct < 3 ? 'ok' : undefined} />
                )}
                {data.aspect && (
                  <Row k="Falls toward" v={`${data.aspect}${data.aspectDeg !== null ? ` (${Math.round(data.aspectDeg)}°)` : ''}`} />
                )}
                <Row k="Elevation source" v={data.sourceLabel || String(data.source)} />
                <Row k="Source resolution"
                     v={data.resolutionM ? `~${fmt(data.resolutionM, 0)} m posts` : 'not reported'} />
                <Row k="Render grid"
                     v={`${data.n} × ${data.n}, one sample every ${fmt(data.spacingM ?? 0, 0)} m` +
                        `${data.filled < data.requested ? ` · ${data.requested - data.filled} gaps` : ''}`} />
                {data.datum && <Row k="Vertical datum" v={data.datum} />}
              </div>

              <p className="note">
                <b>Read this at {fmt(data.resolutionM ?? 0, 0)} m, not at the grid spacing.</b>{' '}
                {resolutionCaveat(data.resolutionM)} The render grid is finer than the data only so
                the surface is smooth to look at — it adds no measurement.
              </p>

              {reliefIsNoise && (
                <p className="alert">
                  <b>This shape may be noise, not ground.</b> The whole fall across the box is{' '}
                  {fmt(relief)} m, and {data.sourceLabel || 'this source'} carries roughly ±{noiseM} m
                  of vertical error. On a site this flat the bumps you can see are within what the
                  dataset gets wrong. Treat it as &ldquo;flat, within tolerance&rdquo; and get levels
                  before you design a fall.
                </p>
              )}

              {exag > 1 && (
                <p className="note">
                  The surface is stretched <b>{exag}×</b> vertically. At 1:1 this site would look{' '}
                  {relief / Math.max(1, Math.hypot(data.widthM, data.heightM)) < 0.05 ? 'close to flat' : 'noticeably gentler'}.
                  Slide to 1× to see the true shape.
                </p>
              )}

              {data.degraded && <p className="alert">{data.degraded}</p>}
              {data.resolutionNote && <p className="note">{data.resolutionNote}</p>}
              {data.warnings?.map((w, i) => <p className="note" key={i}>{w}</p>)}

              <p className="note">
                Drag to orbit, scroll to zoom. Screening only — this is a public DEM, not a
                contour survey, and no earthworks quantity should be priced from it.
              </p>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="row"><span>{k}</span><b className={cls}>{v}</b></div>;
}
