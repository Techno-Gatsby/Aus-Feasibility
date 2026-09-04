# Australian Land Feasibility

Site intelligence and development feasibility for Australian land. A Next.js
app wrapping the original single-file model, which is preserved unchanged at
`legacy/Australia_Land_Feasibility_Paddington_Clean_No_Defaults.html` and
still opens by double-click.

## Run it

```bash
npm install
npm run dev          # http://localhost:3000
npm run smoke        # 20 engine + statement checks
npm run build        # production build
```

Node 20+. No database, no Docker, no external services required to start.

### Optional: Google

```bash
cp .env.example .env.local
# add GOOGLE_MAPS_API_KEY
```

Without a key the app still works: geocoding falls back to Photon, Street
View reports "not configured", elevation uses terrarium tiles. The key is
read **server-side only** and never reaches the browser.

Enable **Geocoding API** and **Street View Static API** on the key. See the
licensing note at the bottom before enabling anything else.

## What it does

**Site intelligence** — click or search a point and get zoning, cadastre,
bushfire, flood and more, drawn on the map as real geometry rather than
reported beside it.

**Feasibility** — the original engine, extracted verbatim. P&L, cashflow,
balance sheet, monthly engine, sources and uses, debt cover, sensitivity,
scenarios, optimiser, offer price, consolidation across parcels. PDF and
Excel export.

**Dossier** (`/api/dossier`) — every field the E1 lead-one-pager and D1
active-to-potential skills need, with provenance on each value. Accepts a
title schedule, a drawn polygon, or a point.

## Data coverage — read this before trusting a blank result

Australia has no national planning dataset. Each state publishes its own,
several publish nothing, and coverage is uneven:

|              | NSW | VIC | QLD | WA | TAS | ACT | SA | NT |
|--------------|-----|-----|-----|----|-----|-----|----|----|
| zoning       | ✅  | ✅  | ⚠️  | ✅ | ✅  | ✅  | ❌ | ❌ |
| cadastre     | ✅  | ✅  | ✅  | ✅ | ✅  | ✅  | ❌ | ❌ |
| bushfire     | ✅  | ✅  | ⚠️  | ✅ | ✅  | ✅  | ❌ | ❌ |
| flood        | ✅  | ✅  | ⚠️  | ✅ | ✅  | ✅  | ❌ | ❌ |
| FSR + height | ✅  | ❌  | ❌  | ❌ | ❌  | ❌  | ❌ | ❌ |
| land values  | ✅  | ❌  | ❌  | ❌ | ❌  | ❌  | ❌ | ❌ |
| sale prices  | ✅  | ❌  | ❌  | ❌ | ❌  | ❌  | ❌ | ❌ |
| contamination| ✅  | ❌  | ❌  | ❌ | ❌  | ❌  | ❌ | ❌ |

⚠️ Queensland zoning and hazard are **council-level by statute** — there is no
statewide service. Brisbane, Gold Coast, Sunshine Coast and Toowoomba are
wired; elsewhere a nil result means "no council wired here", not "unzoned".

**SA** — the statewide SAPPA service is CloudFront geo-blocked outside
Australia. It should answer from an Australian IP; the proxy allow-list
already carries it.

**NT** — a genuine absence. All 48 services on the NT government org were
enumerated; none carries zoning, cadastre, bushfire or flood.

**Ownership is not available anywhere in Australia.** A title search is paid,
per search, through the state land registry. The app surfaces the lot
identifier so that step is one copy-paste.

## Known defects

**The engine rejects any non-zero contingency.** `run()` throws
`Model reconciliation failed: profitToEquity, developmentCostRecognition`
for `contpc > 0`. Contingency is added to development cost but never flows
into a cost-of-sales bucket, so the books do not balance and the engine
correctly refuses to return figures it cannot reconcile.

This is inherited from the single-file build — the engine was extracted
verbatim — so the original tool has it too. Every real appraisal carries
contingency at 3–5%, which suggests appraisals have been run with it at zero
and are understating cost by that margin.

Not fixed here. Changing cost recognition is a financial-logic decision, not
a porting one.

## Architecture notes for whoever picks this up

`lib/engine/model.js` is the original model, extracted between its own
`MODEL_START` / `MODEL_END` markers. 122 KB, zero DOM references, runs
headless. **Do not hand-port it to TypeScript.** It is working financial
logic — deposit schedules, GST, stamp duty, FIRB, debt sizing, IRR solving —
and retyping it would introduce arithmetic bugs no type annotation catches.

`lib/layers.ts` is the data registry and the most important file to read
before adding a source. It records the traps, each of which cost real time:

- **Layer ids are not sequential and not zero-based.** NSW zoning is 19,
  flood is 230. Querying `/0` returns an error or an empty array, both of
  which read as "no data here" when they mean "wrong layer".
- **Group layers reject queries** with "Invalid or missing input
  parameters". NSW ids 9, 12, 17 and heritage 15 are groups.
- **Some layers accept `outFields=*` only** and fail on a named field list.
- **An empty feature array is not proof of absence.**
- **`shape_Area` is not square metres** — it is projected Web Mercator,
  inflated by 1/cos²(latitude), about 45% high at Sydney.
- **`esriSpatialRelIntersects` annexes neighbours** that merely share an
  edge. On a six-lot Sydney site that added $26.8M of somebody else's land
  value before it was caught.

Statements are pure functions over the engine's analysis object and never
recalculate, so the screen, the PDF and the workbook cannot disagree. The
month-to-financial-year map comes from the engine's own `fyOf` — do not
reimplement it; two implementations silently disagreed once already.

`npm run smoke` asserts the statements **articulate**: revenue less direct
cost equals gross profit, NPBT less tax equals NPAT, cashflow receipts tie to
P&L revenue, all at zero drift. If those fail, something upstream broke.

## Licensing — unresolved, needs a lawyer not an engineer

**Google Maps Platform terms** prohibit building terrain models from
Elevation API values (§3.2.3(c)), using Places lat/lng for point-in-polygon
analysis (§3.2.3(c)), and displaying Street View beside a non-Google map
(§3.2.3(e)). This app renders government layers on Leaflet and shows Street
View in the panel. Resolve before relying on Google beyond geocoding.

**NSW bulk property sales** are published CC BY-NC-ND — non-commercial, no
derivatives. This app reads the SIX Valuation MapServer instead, which
publishes no such restriction, but whether they are the same dataset under
different terms is a question for Valuation NSW.
