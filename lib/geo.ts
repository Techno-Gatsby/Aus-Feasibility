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
