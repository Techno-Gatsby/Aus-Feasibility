// Yield math. Deliberately shared between server and client: the API ships
// per-cell constraint data once, then every assumption change recomputes
// instantly in the browser with no round trip.

export interface GridCell {
  lat: number;
  lon: number;
  sfha: boolean;     // FEMA Special Flood Hazard Area / floodway
  water: boolean;    // mapped pond or lake
  wetland: boolean;  // NWI wetland
  dStream: number;   // distance to nearest stream, feet (Infinity if none)
  slope: number;     // percent
}

export interface Assumptions {
  streamBufferFt: number;
  maxSlopePct: number;
  rowPct: number;
  openSpacePct: number;
  density: number;
}

export const DEFAULTS: Assumptions = {
  streamBufferFt: 50,
  maxSlopePct: 15,
  rowPct: 22,
  openSpacePct: 15,
  density: 2.5,
};

export interface Deduction { item: string; acres: number }

export interface YieldResult {
  grossAcres: number;
  perLayer: { label: string; acres: number; key: string }[];
  unionAcres: number;
  sumIfDoubleCounted: number;
  deductions: Deduction[];
  netDevelopableAcres: number;
  efficiencyPct: number;
  indicativeUnits: number;
}

export function computeYield(
  grid: GridCell[],
  grossAcres: number,
  a: Assumptions,
): YieldResult {
  const n = grid.length || 1;
  const cellAc = grossAcres / n;

  let flood = 0, water = 0, wet = 0, stream = 0, steep = 0, union = 0;
  for (const c of grid) {
    const isStream = c.dStream <= a.streamBufferFt;
    const isSteep = c.slope > a.maxSlopePct;
    if (c.sfha) flood++;
    if (c.water) water++;
    if (c.wetland) wet++;
    if (isStream) stream++;
    if (isSteep) steep++;
    if (c.sfha || c.water || c.wetland || isStream || isSteep) union++;
  }

  const perLayer = [
    { key: 'sfha', label: 'FEMA SFHA / floodway', acres: flood * cellAc },
    { key: 'water', label: 'Ponds & lakes', acres: water * cellAc },
    { key: 'wetland', label: 'Wetlands (NWI)', acres: wet * cellAc },
    {
      key: 'stream',
      label: `Stream buffer (${a.streamBufferFt} ft)`,
      acres: stream * cellAc,
    },
    {
      key: 'steep',
      label: `Slope > ${a.maxSlopePct}%`,
      acres: steep * cellAc,
    },
  ];

  // Constraints overlap heavily -- ponds sit inside floodplain, streams run
  // through both. Deduct the UNION, never the sum.
  const unionAcres = union * cellAc;
  const afterPhysical = Math.max(0, grossAcres - unionAcres);
  const row = (afterPhysical * a.rowPct) / 100;
  const os = (afterPhysical * a.openSpacePct) / 100;
  const net = Math.max(0, afterPhysical - row - os);

  const active = perLayer.filter((p) => p.acres > 0.0005).map((p) => p.key);
  const deductions: Deduction[] = [
    {
      item: `Physical constraints [${active.join(', ') || 'none'}]`,
      acres: unionAcres,
    },
    { item: `Street / ROW take (${a.rowPct}%)`, acres: row },
    { item: `Open space dedication (${a.openSpacePct}%)`, acres: os },
  ].filter((d) => d.acres > 0.0005);

  return {
    grossAcres,
    perLayer,
    unionAcres,
    sumIfDoubleCounted: perLayer.reduce((s, p) => s + p.acres, 0),
    deductions,
    netDevelopableAcres: net,
    efficiencyPct: grossAcres ? (100 * net) / grossAcres : 0,
    indicativeUnits: Math.floor(net * a.density),
  };
}
