# Land Intel — Handoff

**GIS site-feasibility screening for US land acquisition.**
Built for Sobha USA land buys in Collin County, Texas.

| | |
|---|---|
| **Live** | https://land-intel-chi.vercel.app |
| **Access** | PIN `2911` |
| **Source** | `MD market intellegence/land-intel/` (OneDrive) |
| **Vercel project** | `land-intel` (`prj_OgJdfmxlAAaLUauqlJYsvh1bTwWT`) — **separate from `sobha-mdi`** |
| **Cost to run** | $0/month. Every data source is free and public. |

---

## 1. What it does

Point it at a tract — by owner name, address, CAD property id, lat/lon, or by
clicking any parcel on the map — and it answers, in about 12 seconds:

1. **Who owns it**, legal description, appraised value, agricultural exemption
2. **What can be built** — zoning, PD district, future land use, ETJ status
3. **What can't be built on** — floodplain, wetlands, ponds, creek buffers, steep slope
4. **Whether anyone must serve it** — water and sewer CCN holders
5. **What's underneath and around** — soils, terrain, pipelines, wells, traffic, demographics
6. **Net developable acres** → indicative unit count
7. **A printable Investment Note** in the Oxlade/New Farm format

The core output is the **buildable envelope**: gross acres minus real physical
constraints minus ROW minus open space = net developable acres. That is the
number a feasibility model actually needs, and it is usually assumed rather
than measured.

---

## 2. Two deliverables

### A. Web app — `web/` (the product)
Next.js 15 + React 19 on Vercel. Interactive map, 3D terrain, Street View,
live-recalculating assumptions, one-click Investment Note.

### B. Python CLI — `site_intel.py` (1,063 lines, stdlib only)
Same engine, no dependencies, no server. Useful for batch runs and for
verifying the web app's numbers independently.

```bash
python3 site_intel.py --prop-id 2950861 --density 2.2 --json out.json
python3 site_intel.py --address "870 Sagebrush Dr, Prosper, TX"
python3 site_intel.py --latlon 33.2562,-96.8116
```

Both were cross-checked and produce identical figures (Melissa tract: union
88.96 ac, net developable 148.11 ac).

---

## 3. Module map

```
land-intel/
├── HANDOFF.md              ← this file
├── README.md               ← deeper technical notes, endpoint list, gotchas
├── site_intel.py           ← standalone Python CLI (same engine)
├── prosper_190ac.json      ← sample output
├── melissa_325ac.json      ← sample output
└── web/                    ← the deployed app
```

### `web/lib/` — the engine (no React, fully testable)

| File | Lines | Responsibility |
|---|---|---|
| `analyse.ts` | 637 | **The orchestrator.** Locates the parcel, fans out ~25 spatial queries, builds the sample grid, classifies every cell, assembles the result. Start here. |
| `layers.ts` | 138 | **Every data source in one place.** ArcGIS endpoints, per-city zoning registry (`CITY_ZONING`), cities with no zoning GIS (`NO_ZONING_GIS`), FEMA SFHA zone codes. |
| `geo.ts` | 120 | Geometry maths — local ft projection, shoelace area, ray-cast point-in-polygon, distance-to-segment. No dependencies. |
| `yield.ts` | 108 | **Net developable acreage.** Shared client+server so sliders recompute instantly. Deducts the *union* of constraints, never the sum. |
| `arcgis.ts` | 126 | ArcGIS query wrapper — retries, per-layer TTL, `dualLayer()` town/county fallback with explicit coverage reporting. |
| `cache.ts` | 92 | Vercel Runtime Cache wrapper. Per-upstream-call caching, TTL policy, **never caches failures**. |
| `demographics.ts` | 136 | Census ACS 5-year — tract + county stats, 2018→2023 change. |
| `auth.ts` | 38 | PIN gate crypto — HMAC token, constant-time compare. |
| `mapStyle.ts` | 29 | Layer colours + visibility type. Kept Leaflet-free so the server bundle stays clean. |

### `web/app/api/` — endpoints

| Route | Purpose |
|---|---|
| `site/` | Full tract analysis. The main one. |
| `parcels/` | Neighbouring parcels for the viewport (up to 1,200, with owner + acres). |
| `suggest/` | Typeahead over owner names and situs addresses. |
| `terrain/` | Dense elevation grid (36×36) for the 3D view. |
| `streetview/` | Street View availability + embed URL. |
| `gate/` | PIN validation, sets the session cookie. |

### `web/app/` + `web/components/` — UI

| File | Lines | Responsibility |
|---|---|---|
| `page.tsx` | 779 | Main app shell — search, map/3D/street switching, tabbed panel, assumption sliders, navigation history. |
| `components/SiteMap.tsx` | 227 | Leaflet map — constraint overlays, neighbouring parcels, basemap switching. |
| `components/Terrain3D.tsx` | 238 | Three.js terrain surface from USGS elevation. |
| `components/StreetView.tsx` | 93 | Street View embed with availability check. |
| `app/report/page.tsx` | 375 | **Investment Note** — print-ready, 11 sections, auto-written risk assessment. |
| `middleware.ts` | 34 | PIN gate on every route. **Fails closed.** |
| `app/globals.css` | — | All styling. Responsive 280px → desktop. |

---

## 4. Data sources — all free, no licence

| Layer | Source | Coverage |
|---|---|---|
| Parcels, ownership, valuation | Collin CAD | Collin County (33 cities) |
| Zoning | Prosper, Anna, Murphy, Princeton city GIS | 4 cities |
| Floodplain, streams, lakes, thoroughfare | Collin County + Town of Prosper | Collin County |
| Wetlands | USFWS National Wetlands Inventory | **Nationwide** |
| Elevation / terrain | USGS 3DEP | **Nationwide** |
| Soils | USDA SSURGO | **Nationwide** |
| Demographics | US Census ACS 5-year | **Nationwide** |
| Water & sewer CCN | Texas PUC | **All Texas** |
| Wells & pipelines | Texas Railroad Commission | **All Texas** |
| Traffic (AADT) | TxDOT | **All Texas** |
| Basemaps | CARTO, Esri World Imagery, Esri Hillshade | Global |

**Only parcels and zoning are county-by-county.** Everything else already works
anywhere in the US.

---

## 5. Environment variables

Set in Vercel for production, preview and development. **Never commit these.**

| Variable | Required | Purpose |
|---|---|---|
| `LAND_INTEL_PIN` | **Yes** | Access PIN (currently `2911`) |
| `LAND_INTEL_SECRET` | **Yes** | HMAC secret for the session cookie |
| `CENSUS_API_KEY` | Optional | Demographics. Free at `api.census.gov/data/key_signup.html` |
| `GOOGLE_MAPS_API_KEY` | Optional | Street View embed |

Without the optional two, those features show a clear "not configured" message
rather than failing silently. Without the required two, the whole site returns
503 — it fails closed by design, so a misconfigured deploy can never publish
itself.

```bash
cd land-intel/web
vercel env add LAND_INTEL_PIN production
vercel env pull .env.local --environment=development   # for local dev
```

---

## 6. Running and deploying

```bash
cd land-intel/web
npm install
vercel env pull .env.local --environment=development
npm run dev                 # http://localhost:3210

npm run build               # verify before deploying
vercel deploy --prod --yes  # deploy
```

> ⚠️ **Always deploy from `land-intel/web`.** The parent OneDrive folder is
> Vercel-linked to the **`sobha-mdi`** project. Running `vercel deploy` from
> the repo root would overwrite the live MDI app.

---

## 7. Findings this tool produced

Real results, not demos.

**Melissa, 324 ac (Chambliss Land LLC, $9.8M assessed)**
- 34.9 ac (10.8%) in FEMA Zone A — the town's own GIS doesn't cover it and
  returned a confident zero. Only the county layer showed it. ~$1M of error.
- **No sewer CCN at all.** Nobody is legally obligated to serve it.
- Two overlapping water CCNs — North Collin SUD and City of Melissa.
- 30.2 ac of wetlands the flood and stream layers missed.

**Prosper, 190 ac (JEN Texas 40 LLC)**
- PD-114 — bespoke ordinance, no API exposes its setbacks or lot mix.
- Creek valley and ridge clearly visible in 3D; 119 ft of relief.
- Fronts US 380 at 48,737 vehicles/day.
- 4 pipelines within half a mile.

**Both tracts** sit on Blackland Prairie clay — Houston Black, plasticity index
44–47, "very high" shrink-swell. Drives foundation cost and is almost never in
a screening budget.

---

## 8. Limits — read before trusting output

**Texas is a non-disclosure state.** Sale prices are **not public record**. The
appraisal district gives assessed value only. The two most quantitative pages
of the Oxlade Investment Note — land benchmarking and selling-price
benchmarking — **cannot be reproduced from public data at any price**. You need
a north-Collin land broker (usually free if you're a credible buyer), CoStar or
MLS via a licensed agent, plus Zonda or John Burns for absorption pace.

**Other honest limits:**
- Constraint areas are grid-sampled (~200–400 points), not exact polygon clips.
  Accurate to about one grid cell per boundary.
- Slope is screening resolution. Localised steep creek banks get smoothed.
- Parcel geometry is appraisal-district mapping, **not a survey**.
- NWI wetlands are a desktop screen. A USACE jurisdictional determination is
  required before relying on them.
- The Railroad Commission shows what is *permitted and mapped*, **not who owns
  the minerals** — that is a title question, and a clean-looking site can still
  be encumbered.
- ROW and open-space percentages are analyst assumptions, not ordinance lookups.
- Zoning exists for only 4 of 33 cities. Melissa, McKinney, Celina, Frisco,
  Allen, Wylie and Plano publish none — the app says "not published, treat as
  unknown", which is deliberately different from "unzoned".

---

## 9. Design decisions worth preserving

These were learned the hard way. Changing them will reintroduce real bugs.

**1. Never report a missing layer as zero.** A town layer queried outside its
boundary returns an empty array, not an error. That is how 35 acres of
floodplain read as zero. Every layer reports its provenance, and says
`NO COVERAGE` when it has none.

**2. Deduct the union of constraints, never the sum.** Ponds sit inside
floodplain; creeks run through both. On the Melissa tract the naive sum is
141 ac against a true union of 89 ac.

**3. Never cache a failure.** A transient upstream 500 — or a `null` from a
dropped elevation request — pinned for a year would silently hollow out the
terrain model and look like real data.

**4. Version the cache key when a cached shape changes.** Cached values outlive
deploys. Changing a return type without changing the key hands old data to new
code.

**5. Check the layer id.** Sewer CCN is layer 1, Anna zoning is 18, Murphy 16,
Princeton 79. Almost none are 0, and querying the wrong id returns empty rather
than erroring. Always enumerate the FeatureServer root first.

**6. Mailing city ≠ city limits.** The CAD's `situsCity` is postal. Zoning is
keyed off the city-limits polygon, or every ETJ tract gets confidently wrong
zoning.

**7. Fail closed on auth.** Missing PIN config returns 503, never an open site.

**8. Beware OneDrive placeholders when packaging.** The source lives in a
OneDrive folder. Files can exist as cloud placeholders that report a real size
via `ls` but read as **zero bytes** — `zip` and `rsync` will silently archive an
empty file. This actually happened to `app/api/streetview/route.ts` while
building the handoff archive; the clean-room build caught it. Always stage via
`cat` into a local directory and verify no zero-byte files before shipping an
archive, and rebuild from the archive to prove it.

---

## 10. Roadmap

**Next, free:**
- Zoning for more cities as they publish GIS (registry in `layers.ts` — adding
  a city is ~6 lines)
- City development-permit portals for the true competitive pipeline
- School ratings and attendance boundaries

**Next, paid — worth it:**
- **Land comps** via broker relationship — the single biggest gap
- **Zonda** for absorption pace; swings IRR more than any other input
- **Drive-time isochrones** (~$100–300/mo) — far more meaningful to a US buyer
  than radius distance

**If this goes national:** there are 3,144 US counties. Wiring each one is not
viable — Collin alone took a day. Buy **Regrid** (~150M parcels, one API,
standardised schema). Note this reverses the advice for two cities, where
Regrid is the wrong purchase because Collin's data is fresher and free and
Prosper's PD zoning can't be flattened by any standardised product. Same fact,
different scope.

---

## 11. Open items

- [ ] **Rotate the Google Maps API key** — it was shared in chat and is
      currently unrestricted across all ~35 Maps APIs, including paid ones
      (Map Tiles, Aerial View, Routes). Restrict to **Maps Embed API** and
      **Street View Static API** only, plus an HTTP-referrer lock to
      `land-intel-chi.vercel.app/*`. Set a $1 budget alert.
- [ ] **Confirm the Street View panorama renders** in a normal browser. The
      metadata layer is verified working (imagery 113 m away, captured
      2018-11); the panorama itself could not be visually confirmed in an
      automated browser, which blocks third-party frames.
- [ ] Request Melissa's zoning shapefile by Public Information Request
      (10-day statutory response).
- [ ] Consider Vercel Pro if this needs stronger access control than a shared
      PIN — Hobby cannot apply platform-level protection to production.
