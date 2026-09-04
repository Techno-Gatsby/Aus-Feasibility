/* Runs api/schema.sql on a real PostgreSQL 16 (PGlite, the same engine compiled
   to WASM), then the twelve-project seed, then a parcel carrying a full gis
   object, and checks what the trigger actually produced. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/* the repo root, from this file - so the harness runs from anywhere */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..") + "/";
const db = new PGlite();
let fail = 0;
const ok = (l, c, e = "") => { if (!c) fail++; console.log((c ? "  ok   " : "  FAIL ") + l + (e === "" ? "" : "  " + e)); };
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

/* 1 - the schema applies, exactly as db.mjs applies it: one multi-statement query */
await db.exec(readFileSync(ROOT + "api/schema.sql", "utf8"));
ok("schema.sql applies on an empty database", true);
/* and again - db.mjs re-applies it on every cold start */
await db.exec(readFileSync(ROOT + "api/schema.sql", "utf8"));
ok("schema.sql is idempotent (applied twice)", true);

const tables = (await db.query(
  "select table_name from information_schema.tables where table_schema='public' order by 1")).rows.map(r => r.table_name);
ok("tables and views created", tables.length >= 9, tables.join(", "));

/* 2 - the real twelve-project seed */
await db.exec(readFileSync(ROOT + "api/seed-au.sql", "utf8"));
const seeded = await one("select count(*)::int n from appraisal where region='AU'");
ok(`seed-au.sql loads (${seeded.n} projects)`, seeded.n === 12);

const inputs = await one(
  "select count(*)::int n, count(distinct input_key)::int k from appraisal_input where region='AU'");
ok(`appraisal_input exposes every input (${inputs.n} rows, ${inputs.k} distinct keys)`, inputs.k > 300);

const priced = await one(
  "select appraisal_name, input_number from appraisal_input where input_key='pr' and input_number is not null order by input_number desc limit 1");
ok("a numeric input reads back as a number", Number.isFinite(Number(priced && priced.input_number)),
   priced ? `${priced.appraisal_name} pr=${priced.input_number}` : "none");

/* 3 - a parcel with the full map payload the page writes */
const gis = {
  base: "satellite", zoom: 15.2, layers: { cadastre: true }, searchLabel: "400 Glenmore Road, Paddington NSW",
  searchPoint: [151.2299, -33.8853], savedSiteId: "f-site", primaryId: "f-site",
  features: { type: "FeatureCollection", features: [
    { id: "f-site", type: "Feature", properties: { name: "Site polygon - Lot 7", saved: true, cadastre: "7//DP123456" },
      geometry: { type: "Polygon", coordinates: [[[151.2295,-33.8850],[151.2303,-33.8850],[151.2303,-33.8856],[151.2295,-33.8856],[151.2295,-33.8850]]] } },
    { id: "f-ring", type: "Feature", properties: { name: "1 km", km: 1 },
      geometry: { type: "Polygon", coordinates: [[[151.22,-33.88],[151.24,-33.88],[151.24,-33.89],[151.22,-33.89],[151.22,-33.88]]] } },
    { id: "f-line", type: "Feature", properties: { name: "Measured line" },
      geometry: { type: "LineString", coordinates: [[151.2295,-33.8850],[151.2303,-33.8856]] } },
    { id: "f-pin", type: "Feature", properties: { name: "Point" },
      geometry: { type: "Point", coordinates: [151.2299,-33.8853] } },
    { id: "f-draft", type: "Feature", properties: { draft: 1 }, geometry: null } ] },
  terrainStats: { featureId: "f-site", samples: 169, minElevation: 28.4, meanElevation: 33.1, maxElevation: 41.7 },
  siteIntel: {
    featureId: "f-site", updatedAt: 1756900000000, centroid: [151.2299, -33.8853], area: 4046.86,
    location: { label: "400 Glenmore Road, Paddington", suburb: "Paddington", state: "NSW", lga: "Woollahra", postcode: "2021" },
    demographics: { population: 12000, medianIncome: 98000 },
    planning: { zoneCode: "R1", zoneName: "General Residential", instrument: "Woollahra LEP 2014",
      planningAuthority: "Woollahra Municipal Council", sourceAgency: "NSW Department of Planning, Housing and Infrastructure",
      sourceStatus: "Official NSW Planning Portal live GIS", dataCurrency: "Current as at 2026-08-30",
      sourceUrl: "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/ePlanning/Planning_Portal_Principal_Planning/MapServer/19",
      maxHeight: "9.5 m", fsr: "Not mapped / not returned", minLotSize: "Not mapped / not returned" },
    proximity: { radius: 12000,
      sources: { station: "Photon / OpenStreetMap", school: "Photon / OpenStreetMap", shopping: "Photon / OpenStreetMap", hospital: "Photon / OpenStreetMap" },
      status:  { station: "ok", school: "ok", shopping: "empty", hospital: "error" },
      errors:  { hospital: "Overpass timed out" } },
    availability: { context: true, reverse: true, planning: true, proximity: true } }
};
const env = { v: 7, region: "AU", active: 0, parcels: [
  { id: "p1", name: "400 Glenmore Road", loc: "Paddington NSW",
    inputs: { pr: "12000", acresGross: "1.0", acresDed: "0.1" }, gis } ] };

const ins = await one(
  "insert into appraisal (name, location, region, envelope, envelope_v, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6) returning id",
  ["400 Glenmore Road", "Paddington NSW", "AU", JSON.stringify(env), 7, "test@local"]);
const id = ins.id;

const site = await one("select * from appraisal_site where appraisal_id=$1", [id]);
ok("appraisal_site row built by the trigger", !!site);
ok("  saved polygon captured", site && site.feature_id === "f-site" && !!site.geometry);
ok("  centroid from site intelligence", site && Math.abs(site.centroid_lat + 33.8853) < 1e-9);
ok("  area converted from square metres to acres", site && Math.abs(site.area_acres - 1) < 0.001, site && String(site.area_acres));
ok("  address, LGA, postcode resolved", site && site.suburb === "Paddington" && site.lga === "Woollahra" && site.postcode === "2021");
ok("  zoning kept as text, sentinels intact", site && site.zone_code === "R1" && site.fsr === "Not mapped / not returned");
ok("  terrain sampled", site && site.elev_samples === 169 && Math.abs(site.elev_max - 41.7) < 1e-9);
ok("  map view restored", site && site.map_view && site.map_view.base === "satellite");

const feats = (await db.query("select * from appraisal_feature where appraisal_id=$1 order by feature_ord", [id])).rows;
ok(`appraisal_feature has every drawable feature (${feats.length} of 5, the null geometry dropped)`, feats.length === 4);
ok("  the saved site is flagged, and only it", feats.filter(f => f.is_saved_site).length === 1 && feats[0].is_saved_site);
ok("  the radius ring carries its km", feats.some(f => Number(f.ring_km) === 1));
ok("  the line's vertices are counted", feats.some(f => f.kind === "LineString" && f.vertices === 2));
ok("  the point carries lng/lat", feats.some(f => f.kind === "Point" && Math.abs(f.lng - 151.2299) < 1e-9));
ok("  the polygon's ring is counted, not its rings", feats[0].vertices === 5, String(feats[0].vertices));

const srcs = (await db.query("select * from appraisal_source where appraisal_id=$1 order by collector", [id])).rows;
ok(`appraisal_source has one row per collector (${srcs.length})`, srcs.length === 7, srcs.map(s => s.collector).join(", "));
const plan = srcs.find(s => s.collector === "planning");
ok("  the planning source names itself", plan && plan.provider.startsWith("NSW Department of Planning"));
ok("  its currency and status survive", plan && plan.currency === "Current as at 2026-08-30" && /Official NSW/.test(plan.status));
ok("  resolved_at comes back as a timestamp", plan && plan.resolved_at instanceof Date, plan && String(plan.resolved_at));
const hosp = srcs.find(s => s.collector === "hospital");
ok("  a failed collector records ok=false and the error", hosp && hosp.ok === false && hosp.error === "Overpass timed out");
const shop = srcs.find(s => s.collector === "shopping");
ok("  an empty collector is not an error", shop && shop.ok === false && shop.status === "empty" && shop.error === null);

const reg = (await db.query("select * from data_source where source_key like 'au-planning%'")).rows;
ok("the planning agency registered itself", reg.length === 1 && reg[0].official === true, reg.map(r => r.source_key).join(", "));

const used = (await db.query("select * from data_source_used where appraisal_id=$1 and collector in ('context','reverse','station')", [id])).rows;
ok("data_source_used fills providers in from the registry",
   used.length === 3 && used.every(u => !!u.provider),
   used.map(u => `${u.collector}=${u.provider}`).join("; "));

/* 4 - the projection follows the envelope */
const env2 = JSON.parse(JSON.stringify(env));
env2.parcels[0].gis.features.features = env2.parcels[0].gis.features.features.slice(0, 2);
await db.query("update appraisal set envelope=$1, version=version+1 where id=$2", [JSON.stringify(env2), id]);
const after = await one("select count(*)::int n from appraisal_feature where appraisal_id=$1", [id]);
ok("removing a feature removes its row", after.n === 2, String(after.n));

await db.query("update appraisal set deleted_at=now() where id=$1", [id]);
const gone = await one(
  "select (select count(*) from appraisal_site where appraisal_id=$1)::int s, (select count(*) from appraisal_feature where appraisal_id=$1)::int f, (select count(*) from appraisal_source where appraisal_id=$1)::int r", [id]);
ok("a soft delete clears all three projections", gone.s === 0 && gone.f === 0 && gone.r === 0, JSON.stringify(gone));

const geo = await one(`select jsonb_build_object('type','FeatureCollection','features',
  coalesce(jsonb_agg(jsonb_build_object('type','Feature','geometry',geometry,
    'properties', jsonb_build_object('parcel', parcel_name))), '[]'::jsonb)) fc
  from saved_site where geometry is not null`);
ok("the portfolio GeoJSON query runs", !!geo.fc && geo.fc.type === "FeatureCollection");

await db.close();
console.log(fail ? `\n${fail} FAILED` : "\nall checks passed");
process.exit(fail ? 1 : 0);
