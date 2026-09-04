# Land Intel — Melissa & Prosper, Collin County TX

## Live: https://land-intel-chi.vercel.app · PIN 2911

## What is plugged in today

**One county for parcels: Collin.** That single layer covers **33 cities**,
because Collin CAD maps every parcel in the county:

Allen · Anna · Blue Ridge · Carrollton · Celina · Dallas · Fairview ·
Farmersville · Frisco · Garland · Josephine · Lavon · Leonard ·
Lowry Crossing · Lucas · McKinney · Melissa · Murphy · Nevada · New Hope ·
Parker · Plano · Princeton · Prosper · Richardson · Rockwall · Royse City ·
Sachse · St Paul · Van Alstyne · Weston · Whitewright · Wylie

Coverage by layer:

| Layer | Coverage |
|---|---|
| Parcels, ownership, CAD valuation | Collin County (33 cities above) |
| Zoning | **Prosper, Anna, Murphy, Princeton** (4 of 33 cities) |
| PD, future land use, development pipeline | Town of Prosper only |
| Floodplain, streams, lakes, thoroughfare plan, Outer Loop | Collin County |
| Water & sewer CCN, oil/gas wells, pipelines, traffic (AADT) | **All Texas** |
| Wetlands, elevation, soils, demographics | **Nationwide** |

So "Collin County" understates it for everything except zoning.

### Zoning, city by city

There is no county-wide zoning layer and there cannot be one — **Texas counties
have no zoning authority.** Only cities zone, so each publishes its own or
nothing. Wired and verified:

| City | Zone code | Extras | Layer id |
|---|---|---|---|
| Prosper | `SF-10` | PD number, ordinances, future land use | 0 |
| Anna | `SF-1 (SF-7.2)` | ordinance | **18** |
| Murphy | `P/SP` | full district name, ordinance no., adoption date, **link to the ordinance PDF** | **16** |
| Princeton | `SF-1` | **Municode link to the zoning article** | **79** |

**None of these are layer 0.** Querying id 0 returns either "Invalid URL" or an
empty array that reads as "no zoning here" — the same silent-zero trap as the
sewer CCN and the flood layer. Always enumerate the FeatureServer root first.

No public zoning GIS found for **Melissa, McKinney, Celina, Frisco, Allen,
Wylie, Plano** or the smaller towns. McKinney publishes 87 services but zoning
is not among them (only comprehensive-plan placetypes). For these the app says
**"does not publish zoning as GIS — treat as unknown, not unzoned"**, which is
a different statement from unincorporated land where there genuinely is no
zoning to find.

One distinction that matters: the CAD's `situsCity` is a **mailing** city, not
city limits. The largest tract with a Melissa address sits outside Melissa's
limits and is therefore genuinely unzoned. Zoning is keyed off the city-limits
polygon, not the mailing address.

## 3D and street-level views

**3D terrain (built in, free, no key).** The `3D` button renders a real surface
of the tract from USGS 3DEP — 1,296 samples, drag to rotate, scroll to zoom,
with a vertical-exaggeration slider and the parcel boundary draped on the
ground. On the Prosper tract the creek valley and the western ridge are
immediately visible; that is the drainage pattern, which the 2D map never
showed. This is ground shape, not photography — it answers "where does water go
and what will I cut and fill", which is the question that costs money on raw
land.

Built on `3DEPElevation/ImageServer/getSamples`, which accepts **hundreds of
points in a single POST** (900 points in ~11 s) — far better than EPQS, which is
one point per request.

**The main analysis now uses this too.** Every grid cell gets its own real
elevation in one round trip, instead of 48 scattered EPQS calls with the slope
borrowed from the nearest sample. EPQS remains as an automatic fallback (3DEP
is intermittently flaky), and the response reports which path ran via
`terrain.source` = `bulk-3dep` | `epqs-fallback`.

Sampling every cell **changes the terrain figures, and they were previously too
flat.** Prosper 190 ac:

| | old (47 scattered EPQS) | new (138 cells, all sampled) |
|---|---|---|
| Relief | 90.5 ft | **98.5 ft** |
| Mean slope | 4.74% | **6.05%** |
| p90 slope | 6.87% | **9.16%** |
| Max slope | ~7% | **13.68%** |

Net developable acreage is unchanged (99.56 ac) because nothing on this tract
exceeds the 15% threshold — but max slope moving from ~7% to 13.68% is the
difference between "flat site" and "close to the limit", and the old figure was
smoothing that away.

Two traps in `getSamples`: values are **metres** (×3.28084), and samples are
keyed by `locationId` and **not guaranteed to arrive in request order** — index
by id, never zip positionally.

**Relief basemap.** A third 2D basemap using Esri World Hillshade — free, no
key — for terrain shading under the constraint overlays.

**Street View is embedded in-app** (the `Street` view button) — but needs a key.

Setup (~5 min, no ongoing cost):
1. Create a Google Cloud project and **enable billing** on it. Both APIs below
   are free of charge, but Google will not issue a usable key without a billing
   account attached.
2. Enable **Maps Embed API** and **Street View Static API**.
3. Create an API key and **restrict it**: HTTP referrers →
   `land-intel-chi.vercel.app/*`, and API restrictions → those two APIs only.
4. `cd land-intel/web && vercel env add GOOGLE_MAPS_API_KEY production`

⚠️ **The key is visible in the iframe `src` in the DOM.** That is inherent to
the Embed API, not a flaw here — which is exactly why the referrer restriction
in step 3 is mandatory, not optional. An unrestricted key pasted in is a
billable liability.

Two details worth knowing:
- The app checks **Street View metadata first** (also free) and reports whether
  imagery exists, how far away it is, and its capture date — rather than
  rendering a grey void. Raw exurban tracts frequently have none; there are
  1 km / 3 km re-search buttons and a Google Maps fallback link.
- The camera **heading is computed to face the tract**, not wherever the car
  happened to be pointing. The panel still states the distance, because the
  nearest road may not actually front the land.

Without a key the view degrades to those setup instructions, not a blank frame.

**Google Earth 3D** remains a deep link (`earth.google.com/web/@lat,lon,…`) —
free. Google's photorealistic 3D tiles, which would allow flying through in-app,
are a **paid** API and are not wired.

Google's photorealistic 3D tiles (true 3D buildings/trees) are a **paid** API.
The Earth deep link gives the same visual for free, just in another tab.

## Demographics & traffic

**Traffic** — TxDOT AADT, statewide, no key. Busiest reading per route within
~0.5 mi. The Prosper tract fronts US 380 at 48,737 vehicles/day and FM 2478 at
30,356.

**Demographics** — Census ACS 5-year, nationwide. **Key is set and live.**
Note the Census API 302s to a "Missing Key" HTML page (with HTTP 200) rather
than returning JSON when the key is absent, so the parser checks for `[` before
trusting the body. Rotate with:

```bash
cd land-intel/web && vercel env rm CENSUS_API_KEY production --yes && vercel env add CENSUS_API_KEY production
```

Prosper tract reads: population 6,268 · median household income $226,364 ·
median home value $876,100 · 97.6% owner-occupied · 39.7% bachelor's+.
Collin County 1,116,601, **up 18.2% since 2018**.
Tract-level population, median income, home value, rent, age, owner-occupancy,
vacancy and education, benchmarked against the county plus 2018→2023 county
population change.

## Search

Typeahead over **owner names and situs addresses**, not exact-match only. Typing
an owner name returns their whole portfolio ranked by acreage — searching
"chambliss" surfaces 8 tracts across Melissa, Blue Ridge and Anna. Debounced,
with stale-response guarding so a slow earlier request cannot overwrite a newer
one. SQL is escaped before interpolation into the ArcGIS `where` clause.

## Scaling beyond Collin County

There are **3,144 counties / county-equivalents** in the US. Wiring them the
way Collin is wired does not scale — Collin took a day for *one* county, and
every county runs its own ArcGIS server with its own schema and field names.
3,144 × that is not a project, it's a product.

The layers split cleanly in two:

| | Coverage today | Effort to go national |
|---|---|---|
| Wetlands (NWI), elevation (3DEP), soils (SSURGO), demographics (Census) | **Already national** — verified working in Georgia | **Zero.** Same endpoints, any lat/lon |
| FEMA flood | National service exists; this build uses Prosper/Collin republished copies because `hazards.fema.gov` is unreachable from the corp network | Small — swap in a reachable national NFHL source |
| **Parcels, ownership, zoning** | Collin County only | **This is the wall** |

So the honest recommendation *changes with scope*. For Melissa + Prosper,
skip Regrid — the CAD data is fresher and free, and Prosper's PD zoning cannot
be flattened by any standardized product. For a national screening funnel,
Regrid is exactly the right purchase: one API, ~150M parcels, standardized
schema. Buying it for two cities was wrong; buying it for fifty states is
correct. Same fact, different scope.

## Request cost and caching — DONE

Caching is live via the Vercel Runtime Cache, applied at the level of the
**individual upstream call** rather than the whole analysis (analysis payloads
for a big tract can exceed the 2 MB item limit, and per-call caching lets
unrelated tracts share work — the same elevation point, the same flood polygon,
the same parcel query while panning).

Measured in production: **38.6 s cold → 3.5 s warm.** After moving elevation to
the bulk endpoint, a fresh tract is **~12 s cold**.

⚠️ **Cached values outlive deploys.** Changing a cached function's return shape
without changing its key hands the old shape to the new code — that is exactly
how `values.map is not a function` happened after the bulk-elevation switch.
Version the key (`elevbulk-v2`) whenever the cached shape changes, and validate
the shape on read.

TTLs: elevation 1 year · soils 180 d · FEMA/NWI/CCN/RRC 30 d · parcels and
zoning 7 d · development applications 6 h.

Two guards that matter:
- **Failures are never cached.** A transient upstream 500 — or a `null` from
  EPQS, which drops requests under load — would otherwise be pinned for the
  whole TTL and reported as truth. Caching a `null` elevation for a year would
  silently hollow out the terrain model.
- Items over ~1.8 MB are skipped rather than failing the write.

## Investment Note

`/report?propId=…` renders a print-ready note modelled on the Oxlade/New Farm
deck: cover, executive summary, site & ownership, jurisdiction & entitlement,
buildable envelope, CCN, ground conditions, mineral estate, competitive
context, an auto-written risk assessment, open diligence, and sources. One
click from the panel; "Save as PDF" in the print dialog to file it.

The assessment section is generated from the data, not templated — it raises
missing CCNs, overlapping CCNs, high shrink-swell, PD zoning, missing zoning
GIS, ag rollback, pipeline crossings, and heavily constrained tracts.

### Historical note

**There was no caching at all.** Every lookup hit every upstream service live.

Per tract: ~22–26 ArcGIS/soils requests, plus up to 48 USGS elevation samples
with up to 3 retries each — so roughly **70–170 HTTP requests per tract**,
taking 30–90 seconds. Map panning above zoom 15 fires one additional parcel
query per movement (up to 1,200 parcels each).

Nothing is rate-limited on our side, and the upstream services publish no
documented quotas — which means the ceiling is unknown rather than generous.
This is the most obvious weakness in the current build. The fix is
straightforward and not yet done:

- Elevation never changes → cache permanently
- Soils change on a multi-year cycle → cache indefinitely
- Parcels, zoning, flood → cache 24h–30d
- Only the development-application layer wants to be near-live

That would cut a repeat lookup from ~150 requests to near zero.

Interactive map version in [`web/`](web/) — parcel and constraint overlays,
click-through popups, and assumption sliders that recompute yield instantly.
The Python CLI below is the same engine and stays useful for batch runs.

**Deployment is a separate Vercel project (`land-intel`) from `sobha-mdi`.**
The repo root is linked to sobha-mdi, so always deploy from `land-intel/web`,
never from the root.

```bash
cd land-intel/web && npm run dev     # local, port 3210
vercel deploy --prod --yes           # from land-intel/web only
```

### Access

The account is on the Vercel **Hobby** plan, which does not allow Vercel's own
password or SSO protection on production deployments. The gate is therefore
implemented in the app: `middleware.ts` blocks every route until a PIN is
entered, and it **fails closed** — if `LAND_INTEL_PIN` / `LAND_INTEL_SECRET`
are missing the site returns 503 rather than silently publishing itself.

The cookie stores an HMAC of the PIN under a server-only secret, never the PIN.
Rotating `LAND_INTEL_SECRET` invalidates every existing session. `/api/*`
returns a clean 401 rather than an HTML login page, and PIN attempts are
throttled to 8/minute per IP.

To change the PIN:
```bash
cd land-intel/web && vercel env rm LAND_INTEL_PIN production --yes && vercel env add LAND_INTEL_PIN production
```

Upgrading the Vercel account to Pro would allow real Deployment Protection in
front of the app; the PIN gate is the best available on Hobby, not the
strongest option that exists.

---


Site intelligence for land feasibility: parcel, zoning, physical constraints,
soils, terrain, competitive context → **net developable acres**.

All sources free and public. No API keys. Python stdlib only. Verified working
2026-07-26.

```bash
python3 site_intel.py --address "870 Sagebrush Dr, Prosper, TX"
python3 site_intel.py --latlon 33.2562,-96.8116
python3 site_intel.py --prop-id 2950861 --density 2.2 --json out.json
```

Assumption flags (set these per deal — they drive the yield):
`--open-space-pct 15` `--row-pct 22` `--stream-buffer-ft 50`
`--max-slope-pct 15` `--density 2.5`

Runtime ~60–90 s per tract (USGS elevation sampling dominates).

---

## Mapping to the Oxlade / New Farm Investment Note format

The Oxlade note is a **DA-approved 2,025 sqm infill site** — entitlement and
yield were already fixed, so that note is almost entirely a *pricing* exercise.
Melissa / Prosper is the opposite: 190–325 acre raw land, no entitlement, and
**yield is the unknown**. So the US note needs a Site & Entitlement section
Oxlade never needed — which is what this tool produces — and it will struggle
on the two slides Oxlade leaned on hardest.

| Oxlade slide | US equivalent | Automatable? |
|---|---|---|
| B. Australia Overview | USA Overview | Yes — Census, BEA, FRED |
| C/D. SEQ + Brisbane Key Facts | DFW + Collin County | Yes — Census ACS, BLS, NCTCOG |
| E1. Micro Market (New Farm) | Prosper / Melissa | Partly — demographics yes, median prices no |
| E2. Location Map | same | **Yes — this tool** |
| E3/E4. Proposed Site / Site Overview | same | **Yes — this tool** |
| — *(no Oxlade equivalent)* | **Entitlement & buildable envelope** | **Yes — this tool. The new section.** |
| E6i. **Land Cost Benchmarking** | land comps | **NO — see blocker** |
| E6ii. Construction Cost | cost plan | No — QS exercise (Oxlade used Planswift) |
| E6iii. **Selling Price Benchmarking** | resale + primary comps | **NO — see blocker** |
| E8. Financials / Sensitivity | feasibility + sensitivity | Already exists in your model |
| F. Recommendations | same | Judgement, not data |

### The blocker: Texas is a non-disclosure state

Slides 14 and 16 of the Oxlade note — land benchmarking and selling-price
benchmarking — are built on **publicly recorded Australian sale prices**
(64 Thorn St $30.0M Jul-25, 33 Oxlade $15.5M Aug-25, and the resale table).

Texas does not record sale prices. County Appraisal District data gives
*assessed* value only. There is no free workaround and no amount of scraping
fixes it. To reproduce those two slides you need one of:

1. **A north-Collin land broker relationship** — fastest, usually free if you
   are a credible buyer, and better quality than the paid alternatives.
2. **CoStar / MLS access** via a licensed broker.
3. **Zonda (ex-Metrostudy)** for new-home starts, closings, VDL counts and
   absorption pace — the input that swings IRR most and has no free substitute.

Worth noting the Oxlade note hit a softer version of this too: the sales agent
flagged that several benchmark transactions were unconditional but unsettled
and therefore *not publicly recorded*. Even in a disclosure market, the last
mile came from a relationship.

---

## What the tool returns

**Parcel** — geometry, computed acreage (cross-checked against CAD), owner and
mailing address, legal description, CAD land/market value, **ag-exemption
acreage** (ag rollback = 3 years of tax plus interest on change of use; a real
line item most models miss).

**Jurisdiction & entitlement** — city limits, ETJ, school district, special
districts, zoning + PD + ordinance numbers, Future Land Use, ETJ release areas
(SB 2038).

**Physical constraints** — FEMA SFHA/floodway, water bodies, stream buffer,
steep slope, **NWI wetlands**, and the **union** of all five. Layers overlap
heavily, so the union is what comes off gross acreage; the sum is reported
alongside purely to show how much double-counting was avoided.

**Mineral estate / oil & gas** — RRC pipelines crossing the site (operator,
commodity, diameter, status, operator phone) and within half a mile; wells,
orphan wells and injection/disposal wells within half a mile. In Texas the
mineral estate is **dominant** — a severed mineral owner may enter and drill
over the surface owner's objection. Reported as encumbrances, not acreage
deductions, because easement widths are negotiated rather than mapped.

**Soils** — USDA SSURGO map units with plasticity index, hydrologic soil group,
drainage class, and a shrink-swell rating from linear extensibility.

**Terrain** — USGS 3DEP samples → elevation range, relief, mean/p90/max slope.

**Context** — nearby development applications, planned thoroughfares crossing
the site, Collin County Outer Loop proximity, schools.

**Yield** — gross → less physical union → less ROW → less open space → net
developable acres → indicative units.

**Open diligence** — the things no public API answers, listed rather than faked.

---

## Two real findings from the test runs

**Melissa, 324 ac (prop_id 460174), Chambliss Land LLC.** 34.9 ac (10.8%) sits
in FEMA Zone A. The town's own GIS does not cover it — only the county layer
does. Querying the wrong layer returns a clean, confident **zero**. On a tract
assessed at $9.8M that is roughly $1M of silent error. The tool now reports
layer coverage explicitly and says `NO COVERAGE` rather than `0`.

**Wetlands are the constraint the other layers miss.** Prosper 190 ac: 19.2 ac
of NWI wetlands (mostly riverine and ponds), which pushed the unbuildable union
from 12.4 to 31.6 ac. Melissa 324 ac: 30.2 ac, union 82.6 → 89.0 ac. Roughly
6–19 acres per tract that floodplain and stream buffers did not already cover,
and each one is a Clean Water Act s.404 permitting question.

**Collin County is not oil country, but pipelines are everywhere.** 69 wells
county-wide (vs 701 in a single Tarrant County bounding box), but 675 pipeline
segments. Melissa tract: one dry hole within half a mile. Prosper tract: no
wells, 4 pipeline segments within half a mile. Low risk here — but verify per
tract, never assume.

**Both tracts sit on Blackland Prairie clay.** Houston Black with plasticity
index 44–47 and linear extensibility up to 17% — "very high" shrink-swell.
This drives foundation design and cost materially and is almost never in a
land budget at screening stage. Get a geotech report before pricing.

---

## Coverage

| | Prosper | Melissa |
|---|---|---|
| Parcels, ownership, value | Town GIS + Collin CAD | Collin CAD |
| Zoning / PD / FLU | **Yes** — town GIS | **No** — PDF only, needs a PIR |
| Floodplain, streams, lakes | Town + county | County |
| Soils, terrain | Yes | Yes |
| Development pipeline | **Yes** — town GIS | No |

Prosper is almost entirely **Planned Development** districts. The zoning layer
returns `PD-8`, `PD-114` and so on, but each PD carries its own negotiated
ordinance with bespoke setbacks, lot mix, density and architectural standards.
No zoning API can flatten that — the tool surfaces the ordinance numbers so you
can pull the controlling document. This is also why Regrid and Zoneomics are
not worth buying for these two markets.

Melissa publishes zoning as PDF only. Request the shapefile by Public
Information Request (10-day statutory response), or georeference the adopted
zoning map.

---

## Endpoints

Prosper `services8.arcgis.com/8ofMLzOrtxGP9wVQ` — Planning (zoning 0, current
dev 3, thoroughfare 5, PD 9, FLU 11, SUP 12), Land_Records (subdivisions 4,
pre-construction 5, parcels 6), Environmental (lakes 0, streams 1, contours 2,
floodplain 7), Administrative_Boundaries (annexations 0, ETJ releases 10,
town/ETJ 12).

Collin CAD `services2.arcgis.com/uXyoacYrZTPTKD3R` — parcels 4, city limits 6,
school districts 2, special districts 7. 437,063 parcels, nightly refresh.

Collin County `services1.arcgis.com/fdWXd5OobWR1E3er` — Floodplain, Streams,
Lakes, Tplan, OuterLoop, ETJs.

USGS 3DEP `epqs.nationalmap.gov/v1/json` · USDA SDA
`sdmdataaccess.sc.egov.usda.gov/Tabular/post.rest` · Census geocoder.

USFWS NWI wetlands — `fwspublicservices.wim.usgs.gov/wetlandsmapservice`
layer 0. Note: `www.fws.gov/wetlandsmapservice` 301-redirects here and **POST
bodies do not survive the redirect**, so the real host must be addressed
directly. Use `fwsprimary.wim.usgs.gov` at your peril — it accepts requests
then 500s on query.

Railroad Commission — `gis.rrc.texas.gov/server/rest/services/rrc_public/`
`RRC_Public_Viewer_Srvs/MapServer`: well locations 1, orphan wells 2,
injection/disposal 4, **pipelines 14** (layer 13 is also called "Pipelines"
but exposes no queryable fields; 12 is QPipelines).

Note: `hazards.fema.gov` is unreachable from the corporate network. Not a
problem — both Prosper and Collin County republish NFHL data with the full
schema (`FLD_ZONE`, `ZONE_SUBTY`, `SFHA_TF`, `STATIC_BFE`).

---

## Known limits

- Slope comes from ~48 elevation samples per tract (~250–400 ft spacing).
  Fine for screening; localised steep creek banks get smoothed out. A real
  LiDAR DEM clip is the fix if a tract goes past screening.
- Constraint areas are grid-sampled (~400 points), not exact polygon clips.
  Accurate to roughly ±1 grid cell per boundary.
- ROW and open-space percentages are assumptions, not ordinance lookups.
- NWI wetlands are a **desktop screen only**. A USACE jurisdictional
  determination is required before relying on them.
- RRC GIS shows what is **permitted and mapped**, not who owns the minerals.
  A site that reads clear here can still be encumbered — that is a title
  question, not a GIS one.
- The RRC service throws transient 500s and USGS 3DEP drops requests under
  concurrency; both are retried. If a well query still fails the report says
  `QUERY FAILED — verify manually` rather than reporting zero.
