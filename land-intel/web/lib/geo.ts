// Local equirectangular projection to feet. Exact enough at parcel scale and
// keeps the whole app dependency-free on the geometry side.

export const FT_PER_DEG_LAT = 364000;

export type Pt = [number, number]; // [x, y] in feet
export type Ring = Pt[];
export type LonLat = [number, number];

export class Proj {
  kx: number;
  ky: number;
  constructor(public lat0: number, public lon0: number) {
    this.kx = FT_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
    this.ky = FT_PER_DEG_LAT;
  }
  toFt(lon: number, lat: number): Pt {
    return [(lon - this.lon0) * this.kx, (lat - this.lat0) * this.ky];
  }
  toDeg(x: number, y: number): LonLat {
    return [this.lon0 + x / this.kx, this.lat0 + y / this.ky];
  }
}

function closeRing(r: Ring): Ring {
  if (r.length === 0) return r;
  const [a, b] = [r[0], r[r.length - 1]];
  return a[0] === b[0] && a[1] === b[1] ? r : [...r, a];
}

export function ringsToFt(rings: LonLat[][], proj: Proj): Ring[] {
  return rings.map((r) => closeRing(r.map(([lo, la]) => proj.toFt(lo, la))));
}

function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return a / 2;
}

/** Absolute area in sq ft. Signed sum handles donut holes when ring
 *  orientations are correct. */
export function polygonAreaSqft(ringsFt: Ring[]): number {
  return Math.abs(ringsFt.reduce((s, r) => s + ringArea(r), 0));
}

/** Ray casting across all rings; XOR handles holes. */
export function pointInRings(px: number, py: number, ringsFt: Ring[]): boolean {
  let inside = false;
  for (const ring of ringsFt) {
    const n = ring.length;
    let j = n - 1;
    for (let i = 0; i < n; i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (
        yi > py !== yj > py &&
        px < ((xj - xi) * (py - yi)) / (yj - yi || 1e-12) + xi
      ) {
        inside = !inside;
      }
      j = i;
    }
  }
  return inside;
}

export function distPointToSegment(
  px: number, py: number,
  ax: number, ay: number,
  bx: number, by: number,
): number {
  const dx = bx - ax;
  const dy = by - ay;
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy);
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function minDistToPaths(px: number, py: number, paths: Ring[]): number {
  let best = Infinity;
  for (const path of paths) {
    for (let i = 0; i < path.length - 1; i++) {
      const d = distPointToSegment(
        px, py, path[i][0], path[i][1], path[i + 1][0], path[i + 1][1],
      );
      if (d < best) best = d;
    }
  }
  return best;
}

export function bboxDeg(rings: LonLat[][], pad: number):
  [number, number, number, number] {
  const xs = rings.flat().map((p) => p[0]);
  const ys = rings.flat().map((p) => p[1]);
  return [
    Math.min(...xs) - pad, Math.min(...ys) - pad,
    Math.max(...xs) + pad, Math.max(...ys) + pad,
  ];
}

export function centroid(rings: LonLat[][]): { lat: number; lon: number } {
  const pts = rings.flat();
  return {
    lat: pts.reduce((s, p) => s + p[1], 0) / pts.length,
    lon: pts.reduce((s, p) => s + p[0], 0) / pts.length,
  };
}

export function wktFromRings(rings: LonLat[][]): string {
  const parts = rings.map((r) => {
    const pts = closeRing(r as unknown as Ring) as unknown as LonLat[];
    return '(' + pts.map((p) => `${p[0].toFixed(8)} ${p[1].toFixed(8)}`).join(',') + ')';
  });
  return `polygon(${parts.join(',')})`;
}
