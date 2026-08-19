export type Pt = { lng: number; lat: number };

/** Bearing from a to b in degrees, used to aim Street View at the site
 *  rather than wherever the camera car happened to face. */
export function bearing(a: Pt, b: Pt) {
  const r = Math.PI / 180;
  const y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x =
    Math.cos(a.lat * r) * Math.sin(b.lat * r) -
    Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

export function metres(a: Pt, b: Pt) {
  const r = Math.PI / 180, R = 6371000;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Australia's mainland + Tasmania bounding box. Anything outside is a
 *  geocoding miss, not a site — the old build happily flew to rural NSW
 *  and drew council polygons across half a state. */
export const AU_BOUNDS: [number, number, number, number] = [112.9, -43.7, 153.7, -10.0];

export const inAustralia = (p: Pt) =>
  p.lng >= AU_BOUNDS[0] && p.lng <= AU_BOUNDS[2] &&
  p.lat >= AU_BOUNDS[1] && p.lat <= AU_BOUNDS[3];

/** NSW only, for gating the NSW-specific layer set. */
export const NSW_BOUNDS: [number, number, number, number] = [140.9, -37.6, 153.7, -28.1];
export const inNSW = (p: Pt) =>
  p.lng >= NSW_BOUNDS[0] && p.lng <= NSW_BOUNDS[2] &&
  p.lat >= NSW_BOUNDS[1] && p.lat <= NSW_BOUNDS[3];


export type StateCode = 'NSW' | 'VIC' | 'QLD' | 'SA' | 'WA' | 'TAS' | 'NT' | 'ACT';

/** Rough state bounding boxes, used only to pick which endpoint set to try.
 *  They overlap at borders and ACT sits inside NSW, so this is a ROUTING
 *  hint, not a determination — ACT is tested before NSW for that reason, and
 *  a wrong guess costs one failed query, not a wrong answer. */
const STATE_BOXES: [StateCode, number, number, number, number][] = [
  // most specific first
  ['ACT', 148.76, -35.92, 149.40, -35.12],
  ['NSW', 140.99, -37.51, 153.64, -28.16],
  ['VIC', 140.96, -39.20, 150.00, -33.98],
  ['QLD', 137.99, -29.18, 153.55, -10.05],
  ['SA',  128.99, -38.07, 141.01, -25.99],
  ['WA',  112.92, -35.14, 129.01, -13.69],
  ['NT',  128.99, -26.01, 138.01, -10.96],
  ['TAS', 143.81, -43.65, 148.51, -39.19],
];

export function stateOf(p: Pt): StateCode | null {
  for (const [code, w, s, e, n] of STATE_BOXES)
    if (p.lng >= w && p.lng <= e && p.lat >= s && p.lat <= n) return code;
  return null;
}

export const STATE_NAME: Record<StateCode, string> = {
  NSW: 'New South Wales', VIC: 'Victoria', QLD: 'Queensland',
  SA: 'South Australia', WA: 'Western Australia', TAS: 'Tasmania',
  NT: 'Northern Territory', ACT: 'Australian Capital Territory',
};
