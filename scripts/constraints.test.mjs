/**
 * Constraint-union test. Plain node, no framework.
 *
 * Proves the three things the analysis would be worthless without:
 *   1. areas are right — a 1000 m x 1000 m square measures 1,000,000 m2
 *   2. the UNION is less than the SUM when layers overlap, and the union
 *      equals the true covered fraction
 *   3. a hole in a polygon is excluded from its area
 *
 * Plus the projection check that motivates all of it: a degree of longitude
 * is not a degree of latitude, and in southern Australia the difference is
 * enormous.
 *
 * lib/constraints.ts is TypeScript and this runtime is node 20, which cannot
 * strip types. So the module is compiled with the repo's own tsc into a temp
 * directory first. That also means this test doubles as a type check of the
 * module in isolation: if it does not compile, it does not run.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let failed = 0;
const check = (name, cond, detail = '') => {
  const ok = !!cond;
  if (!ok) failed++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
/** relative-tolerance comparison; every area assertion here is +/- 2% */
const near = (got, want, tol = 0.02) =>
  Math.abs(got - want) <= Math.abs(want) * tol;
const pct = (x) => `${(x * 100).toFixed(2)}%`;

// ---- compile the module under test ---------------------------------------
const out = mkdtempSync(path.join(tmpdir(), 'constraints-'));
const tsc = path.join(root, 'node_modules', '.bin', 'tsc');
try {
  execFileSync(tsc, [
    path.join(root, 'lib', 'constraints.ts'),
    '--outDir', out,
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    '--strict',
    '--skipLibCheck',
  ], { cwd: root, stdio: 'inherit' });
} catch (e) {
  console.log('  FAIL  lib/constraints.ts compiles');
  process.exit(1);
}
writeFileSync(path.join(out, 'package.json'), '{"type":"module"}');
const emitted = readdirSync(out).find((f) => f.endsWith('constraints.js'));
if (!emitted) { console.log('  FAIL  tsc emitted no constraints.js'); process.exit(1); }

const {
  analyseConstraints, pointInPolygon, pointInRing,
  M_PER_DEG_LAT, mPerDegLng, M2_PER_ACRE,
} = await import(pathToFileURL(path.join(out, emitted)).href);

console.log('constraint union test');
console.log(`  (compiled ${emitted} for node ${process.version})`);

// ---- an independent haversine, so the geometry is not graded by itself ----
const haversine = (aLat, aLng, bLat, bLng) => {
  const r = Math.PI / 180, R = 6371000;
  const dLat = (bLat - aLat) * r, dLng = (bLng - aLng) * r;
  const s = Math.sin(dLat / 2) ** 2 +
            Math.cos(aLat * r) * Math.cos(bLat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/** Build an axis-aligned square of `side` metres centred on (lat,lng).
 *  Rings are [lat,lng], the convention the module and Leaflet both use. */
function squareAt(lat, lng, side) {
  const half = side / 2;
  const dLat = half / M_PER_DEG_LAT;
  const dLng = half / mPerDegLng(lat);
  return [
    [lat - dLat, lng - dLng],
    [lat - dLat, lng + dLng],
    [lat + dLat, lng + dLng],
    [lat + dLat, lng - dLng],
  ];
}

/** A sub-rectangle of a square's bbox, given as fractions 0..1 of each axis.
 *  `grow` pushes it outside the bbox so a band meant to span the site fully
 *  is not left ambiguous at the edge. */
function fracRect(sq, x0, x1, y0 = -0.5, y1 = 1.5) {
  const lats = sq.map((p) => p[0]), lngs = sq.map((p) => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const L = (f) => minLng + (maxLng - minLng) * f;
  const A = (f) => minLat + (maxLat - minLat) * f;
  return [
    [A(y0), L(x0)], [A(y0), L(x1)], [A(y1), L(x1)], [A(y1), L(x0)],
  ];
}

// Sydney latitude: far enough south that the cos factor is doing real work.
const LAT = -33.87, LNG = 151.21;

// =========================================================================
// 1. a 1000 m x 1000 m square measures 1,000,000 m2
// =========================================================================
console.log('\n1. area of a 1000 m x 1000 m square');
const sq = squareAt(LAT, LNG, 1000);

// first prove the test's own square really is 1000 m on a side, measured by
// an independent haversine — otherwise check 1 grades the module against
// the module's own assumptions.
const sideEW = haversine(sq[0][0], sq[0][1], sq[1][0], sq[1][1]);
const sideNS = haversine(sq[1][0], sq[1][1], sq[2][0], sq[2][1]);
check('test fixture is 1000 m east-west (haversine)', near(sideEW, 1000, 0.005),
      `${sideEW.toFixed(1)} m`);
check('test fixture is 1000 m north-south (haversine)', near(sideNS, 1000, 0.005),
      `${sideNS.toFixed(1)} m`);

const r1 = analyseConstraints([[sq]], [], { n: 40 });
check('analysis returns ok', r1.ok === true, r1.ok ? '' : r1.error);
check('square area is 1,000,000 m2 +/- 2%', near(r1.site.areaM2, 1e6, 0.02),
      `${Math.round(r1.site.areaM2).toLocaleString()} m2 ` +
      `(${(Math.abs(r1.site.areaM2 - 1e6) / 1e6 * 100).toFixed(3)}% off)`);
check('exact shoelace area agrees with the grid', near(r1.site.exactAreaM2, 1e6, 0.02),
      `${Math.round(r1.site.exactAreaM2).toLocaleString()} m2`);
check('acres conversion is right (~247.1 ac)',
      near(r1.site.areaAcres, r1.site.areaM2 / M2_PER_ACRE, 1e-12) &&
      near(r1.site.areaAcres, 247.105, 0.02),
      `${r1.site.areaAcres.toFixed(2)} ac`);
check('no layers means nothing constrained', r1.unionM2 === 0 && r1.sumM2 === 0);
check('no layers means the whole site is developable',
      near(r1.developableM2, r1.site.areaM2, 1e-9));

// the same square, four times the resolution: the answer must not move
const r1b = analyseConstraints([[sq]], [], { n: 160 });
check('area is stable when resolution quadruples',
      near(r1b.site.areaM2, r1.site.areaM2, 0.01),
      `n=40 ${Math.round(r1.site.areaM2)} vs n=160 ${Math.round(r1b.site.areaM2)}`);

// =========================================================================
// 2. two overlapping constraints: union < sum, union = true covered fraction
// =========================================================================
console.log('\n2. two overlapping constraints');
// Layer A: western half           x in [0.0, 0.5]  -> 50% of the site
// Layer B: a shifted half         x in [0.3, 0.8]  -> 50% of the site
// True union                      x in [0.0, 0.8]  -> 80%
// True sum                                          -> 100%
// True overlap                    x in [0.3, 0.5]  -> 20%
// True developable                x in [0.8, 1.0]  -> 20%
const A = fracRect(sq, 0.0, 0.5);
const B = fracRect(sq, 0.3, 0.8);
const r2 = analyseConstraints([[sq]], [
  { key: 'flood', label: 'Flood planning', polygons: [[A]] },
  { key: 'bushfire', label: 'Bush fire prone land', polygons: [[B]] },
], { n: 40 });

check('analysis returns ok', r2.ok === true, r2.ok ? '' : r2.error);
const site2 = r2.site.areaM2;
const fUnion = r2.unionM2 / site2;
const fSum = r2.sumM2 / site2;
const fOver = r2.overlapM2 / site2;
const fDev = r2.developableM2 / site2;

check('layer A covers 50% of the site', near(r2.layers[0].shareOfSite, 0.5, 0.02),
      pct(r2.layers[0].shareOfSite));
check('layer B covers 50% of the site', near(r2.layers[1].shareOfSite, 0.5, 0.02),
      pct(r2.layers[1].shareOfSite));
check('UNION IS LESS THAN SUM', r2.unionM2 < r2.sumM2,
      `union ${Math.round(r2.unionM2).toLocaleString()} m2 < ` +
      `sum ${Math.round(r2.sumM2).toLocaleString()} m2`);
check('union equals the true covered fraction (80%)', near(fUnion, 0.8, 0.02), pct(fUnion));
check('sum is the naive 100%', near(fSum, 1.0, 0.02), pct(fSum));
check('overlap = sum - union = 20% of site', near(fOver, 0.2, 0.02), pct(fOver));
check('double-count share is 20% of the naive total',
      near(r2.doubleCountShare, 0.2, 0.02), pct(r2.doubleCountShare));
check('developable is the remaining 20%', near(fDev, 0.2, 0.02), pct(fDev));
check('union + developable = site', near(r2.unionM2 + r2.developableM2, site2, 1e-9));
check('pairwise overlap flood-bushfire reported',
      r2.pairOverlaps.length === 1 && near(r2.pairOverlaps[0].m2 / site2, 0.2, 0.02),
      r2.pairOverlaps.length ? pct(r2.pairOverlaps[0].m2 / site2) : 'none');
check('byLayerCount: 20% clear, 60% one layer, 20% two layers',
      near(r2.byLayerCount[0] / site2, 0.2, 0.02) &&
      near(r2.byLayerCount[1] / site2, 0.6, 0.02) &&
      near(r2.byLayerCount[2] / site2, 0.2, 0.02),
      r2.byLayerCount.map((x) => pct(x / site2)).join(' / '));

// the deal-margin case from the brief: summing overstates the loss
const lostBySum = r2.sumM2 / M2_PER_ACRE;
const lostByUnion = r2.unionM2 / M2_PER_ACRE;
check('summing overstates lost land', lostBySum > lostByUnion,
      `sum says ${lostBySum.toFixed(1)} ac lost, union says ${lostByUnion.toFixed(1)} ac ` +
      `— ${(lostBySum - lostByUnion).toFixed(1)} ac of phantom loss`);

// non-overlapping layers must NOT be penalised: union should equal sum
const C = fracRect(sq, 0.0, 0.4);
const D = fracRect(sq, 0.6, 1.0);
const r2b = analyseConstraints([[sq]], [
  { key: 'flood', polygons: [[C]] },
  { key: 'bushfire', polygons: [[D]] },
], { n: 40 });
check('disjoint layers: union equals sum', near(r2b.unionM2, r2b.sumM2, 1e-9),
      `union ${Math.round(r2b.unionM2)} = sum ${Math.round(r2b.sumM2)}`);
// float epsilon, not a real overlap: 1e-12 of the total is sub-micron.
check('disjoint layers: no double count', Math.abs(r2b.doubleCountShare) < 1e-9,
      r2b.doubleCountShare.toExponential(2));
check('disjoint layers: no pairwise overlap reported', r2b.pairOverlaps.length === 0);

// a layer wholly inside another adds nothing and must be flagged as such
const E = fracRect(sq, 0.1, 0.3);
const r2c = analyseConstraints([[sq]], [
  { key: 'flood', polygons: [[fracRect(sq, 0.0, 0.5)]] },
  { key: 'wetland', polygons: [[E]] },
], { n: 40 });
check('a layer contained in another is flagged fully redundant',
      r2c.layers[1].fullyRedundant === true && near(r2c.unionM2 / r2c.site.areaM2, 0.5, 0.02),
      `union ${pct(r2c.unionM2 / r2c.site.areaM2)}`);

// =========================================================================
// 3. holes
// =========================================================================
console.log('\n3. polygon holes');
// A hole from 0.25 to 0.75 on both axes is a quarter of the bbox: 250,000 m2.
const hole = fracRect(sq, 0.25, 0.75, 0.25, 0.75);

check('point in the hole is inside the outer ring', pointInRing(LAT, LNG, sq) === true);
check('point in the hole is OUTSIDE the holed polygon',
      pointInPolygon(LAT, LNG, [sq, hole]) === false);
check('point outside the hole is inside the holed polygon',
      pointInPolygon(sq[0][0] + (LAT - sq[0][0]) * 0.2, LNG, [sq, hole]) === true);

const r3 = analyseConstraints([[sq, hole]], [], { n: 40 });
check('holed site area excludes the hole (750,000 m2 +/- 2%)',
      near(r3.site.areaM2, 750000, 0.02),
      `${Math.round(r3.site.areaM2).toLocaleString()} m2`);
check('shoelace area also excludes the hole',
      near(r3.site.exactAreaM2, 750000, 0.02),
      `${Math.round(r3.site.exactAreaM2).toLocaleString()} m2`);

// a hole in a CONSTRAINT: high ground inside a flood polygon is buildable
const r3b = analyseConstraints([[sq]], [
  { key: 'flood', polygons: [[sq, hole]] },
], { n: 40 });
check('a hole in a constraint leaves that ground developable',
      near(r3b.unionM2, 750000, 0.02) && near(r3b.developableM2, 250000, 0.02),
      `constrained ${Math.round(r3b.unionM2).toLocaleString()} m2, ` +
      `developable ${Math.round(r3b.developableM2).toLocaleString()} m2`);

// =========================================================================
// 4. the projection this whole thing rests on
// =========================================================================
console.log('\n4. cos(latitude) projection');
// Same square in degrees, at the top and bottom of Australia. If longitude
// were treated as planar these would come out identical, which is the error
// the brief calls out.
const degBox = (lat) => [
  [lat - 0.05, 150.0], [lat - 0.05, 150.1], [lat + 0.05, 150.1], [lat + 0.05, 150.0],
];
const north = analyseConstraints([[degBox(-10.5)]], [], { n: 40 });
const south = analyseConstraints([[degBox(-43.0)]], [], { n: 40 });
const ratio = north.site.areaM2 / south.site.areaM2;
const expected = Math.cos(10.5 * Math.PI / 180) / Math.cos(43.0 * Math.PI / 180);
check('the same degree box is bigger in the tropics than in Tasmania',
      near(ratio, expected, 0.01),
      `ratio ${ratio.toFixed(4)}, cos ratio ${expected.toFixed(4)} ` +
      `— a planar model would have said 1.0000, a ${pct(ratio - 1)} error`);
check('the planar error exceeds 25%', ratio - 1 > 0.25, pct(ratio - 1));

// =========================================================================
// 5. degenerate input must fail loudly, not return a confident zero
// =========================================================================
console.log('\n5. degenerate input');
const bad = analyseConstraints([], [], { n: 40 });
check('empty site is rejected', bad.ok === false, bad.ok ? '' : bad.error);
const flat = analyseConstraints([[[[ -33.0, 151.0], [-33.0, 151.1], [-33.0, 151.2]]]], [], { n: 40 });
check('zero-extent site is rejected', flat.ok === false, flat.ok ? '' : flat.error);
check('caveats are shipped with every result',
      Array.isArray(r2.caveats) && r2.caveats.length >= 5 &&
      r2.caveats.some((c) => /not a survey|substitute for one/i.test(c)),
      `${r2.caveats.length} caveats`);
check('resolution is reported so the reader can judge the error',
      r1.grid.resolutionM.ns > 0 && r1.grid.resolutionM.ew > 0,
      `${r1.grid.resolutionM.ns.toFixed(1)} m x ${r1.grid.resolutionM.ew.toFixed(1)} m cells`);

// =========================================================================
// 6. the approximation, exercised honestly
// =========================================================================
console.log('\n6. grid quantisation on a non-axis-aligned shape');
// Everything above is axis-aligned, which is the grid's best case: every
// boundary falls on a cell edge and the answer is exact. That flatters the
// method. A triangle cuts diagonally across cells, so its error is the real
// error. Exact area is half the bounding box: 500,000 m2.
const lats = sq.map((p) => p[0]), lngs = sq.map((p) => p[1]);
const [y0, y1] = [Math.min(...lats), Math.max(...lats)];
const [x0, x1] = [Math.min(...lngs), Math.max(...lngs)];
const tri = [[y0, x0], [y0, x1], [y1, (x0 + x1) / 2]];

const t40 = analyseConstraints([[tri]], [], { n: 40 });
const t160 = analyseConstraints([[tri]], [], { n: 160 });
const e40 = Math.abs(t40.site.areaM2 - 500000) / 500000;
const e160 = Math.abs(t160.site.areaM2 - 500000) / 500000;
check('triangle area within 2% at n=40', e40 <= 0.02,
      `${Math.round(t40.site.areaM2).toLocaleString()} m2, ${pct(e40)} off`);
check('error shrinks as resolution rises', e160 < e40,
      `n=40 ${pct(e40)} -> n=160 ${pct(e160)}`);
// The symmetric triangle's over- and under-counts largely cancel, which
// flatters the method. An asymmetric wedge does not get that help, so it is
// the honest convergence test: grid vs the exact shoelace, at two resolutions.
const wedge = [
  [y0, x0],
  [y0 + (y1 - y0) * 0.13, x1],
  [y1, x0 + (x1 - x0) * 0.41],
  [y0 + (y1 - y0) * 0.62, x0 + (x1 - x0) * 0.07],
];
const w40 = analyseConstraints([[wedge]], [], { n: 40 });
const w200 = analyseConstraints([[wedge]], [], { n: 200 });
check('asymmetric shape: grid within 2% of exact at n=40',
      w40.site.gridVsExactError <= 0.02, pct(w40.site.gridVsExactError));
check('asymmetric shape: error falls as resolution rises',
      w200.site.gridVsExactError < w40.site.gridVsExactError,
      `n=40 ${pct(w40.site.gridVsExactError)} -> n=200 ${pct(w200.site.gridVsExactError)}`);

check('reported uncertainty band covers the actual error',
      t40.unionUncertaintyM2 >= 0 &&
      Math.abs(t40.site.areaM2 - 500000) <
        Math.max(t40.grid.resolutionM.ns * t40.grid.resolutionM.ew * t40.grid.n, 1),
      `actual ${Math.round(Math.abs(t40.site.areaM2 - 500000)).toLocaleString()} m2 ` +
      `vs one boundary row ${Math.round(t40.grid.resolutionM.ns * t40.grid.resolutionM.ew * t40.grid.n).toLocaleString()} m2`);

console.log(`\n${failed === 0 ? 'ALL CHECKS PASSED' : `${failed} CHECK(S) FAILED`}`);
process.exit(failed === 0 ? 0 : 1);
