# Saved appraisals

Stores the appraisal envelope the app already builds (`v:7` — every parcel, the
active index, scenario, columns, metrics and portfolio settings) in Postgres, so
inputs are shared across the team instead of living in a `.json` file on one
laptop.

The Australian page goes further: its twelve projects are **only** here, one row
each, and the page carries none of them. See the last section.

The `Save` / `Open` file buttons are unchanged. `Save to server` and
`Open from server` sit beside them and use the **same** envelope —
`buildEnvelope()` and `applyEnvelope()` in the page are the single source for
both paths, so a file and a stored row can never diverge.

| | |
|---|---|
| `schema.sql` | Tables. Idempotent, applied on boot. |
| `db.mjs` | Pool, schema init, `query()` / `tx()`. |
| `appraisals.mjs` | Routes. Framework-agnostic — returns `true` only when it owns the request. |

> **The UAT target is Azure SQL Database, not PostgreSQL.**
> `sqldb-mdo-landfeasibility-uat` on `sql-mdo-landfeasibility-uat-01`, Standard S0,
> already exists in the same resource group. Everything below describes the
> PostgreSQL design and still explains *why* the store is shaped the way it is,
> but for that server use the ported files:
>
> | | |
> |---|---|
> | `schema.sqlserver.sql` | the tables, projections, trigger and views, in T-SQL |
> | `schema-access.sqlserver.sql` | who signs in and what they can see - see **Access control** below |
> | `seed-au.sqlserver.sql` | the twelve Australian projects (generated from `seed-au.sql` by `port-seed-to-sqlserver.mjs`) |
> | `grant.sqlserver.sql` | the app login - managed identity, or a contained SQL user |
> | `verify.sqlserver.sql` | post-install checks, including a trigger smoke test that rolls itself back |
>
> Run order: `schema` → `schema-access` → `grant` → `seed-au` → `verify`. Unlike
> the PostgreSQL version the schema is **not** applied on boot, because an
> application login that can CREATE TABLE can also DROP one.
>
> `db.mjs` and `appraisals.mjs` are now ported to `mssql` and `@p1..@pn` named
> parameters - `pg` is gone from `Deploy/package.json`. Still unproven against a
> real server: there is no SQL Server or Docker on this machine, so the port is
> verified by syntax/parameter-arity checks and a full run of `Deploy/server.js`
> against stub `access.mjs`/`appraisals.mjs` modules (the request-routing logic,
> not the SQL), not by a live query. See **Access control** below for what else
> changed alongside the port.

## 1. Provision

Flexible Server with **private access** in the same VNet as the web app; the
main site already refuses everything outside the App Gateway subnet, and the
database should not be reachable from the internet at all.

```bash
RG=rg-sr-mdo-sobha-landfeasibility-uat
LOC=uaenorth
PGNAME=pg-mdo-landfeasibility-uat

az postgres flexible-server create \
  --resource-group $RG --name $PGNAME --location $LOC \
  --tier Burstable --sku-name Standard_B1ms --storage-size 32 \
  --version 16 --database-name landfeasibility \
  --admin-user pgadmin --admin-password '<generate-and-store-in-key-vault>' \
  --vnet <the app's vnet> --subnet <a delegated subnet> \
  --public-access None
```

`Standard_B1ms` is deliberate — this table takes a handful of writes a day. Move
up only if the portfolio list gets slow, which it will not at this size.

## 2. App settings

```bash
az webapp config appsettings set -g $RG -n app-mdo-fe-landfeasibility-uat --settings \
  PGHOST=$PGNAME.postgres.database.azure.com \
  PGDATABASE=landfeasibility \
  PGUSER=pgadmin \
  PGPASSWORD='@Microsoft.KeyVault(SecretUri=...)'
```

Use a Key Vault reference for the password, not a literal. The app also needs
VNet integration switched on to reach a privately-networked server.

## 3. Turn Easy Auth on — before enabling the routes

`principal()` in `appraisals.mjs` trusts `X-MS-CLIENT-PRINCIPAL-NAME`. App
Service Authentication validates the Entra token at the edge and **strips any
copy the browser sent**, which is what makes that header trustworthy. With Easy
Auth off, the header passes straight through and anyone can claim any identity.

The page's own sign-in (`Deploy/sobha-login-region.html`) cannot do this job: it
compares against a password list held in the page and records the result in
`sessionStorage`, both fully under the caller's control. It is a doorway, not an
authenticator.

```bash
az webapp auth microsoft update -g $RG -n app-mdo-fe-landfeasibility-uat \
  --client-id <app registration id> --issuer https://sts.windows.net/<tenant>/
az webapp auth update -g $RG -n app-mdo-fe-landfeasibility-uat \
  --enabled true --action RedirectToLoginPage --redirect-provider azureactivedirectory
```

For local work only, `ALLOW_ANON_DEV=1` stands in a `dev@local` principal. It is
opt-in and absent in App Service, so the routes fail closed by default.

## 4. Wire into `server.js`

Done, and now in the repo: `Deploy/server.js` is the wwwroot server with the
hook already in it, and `Deploy/package.json` adds `pg`. The wwwroot copy stays
the deployed truth until this one is pushed over it — `Deploy/deploy.sh probe`
shows what is actually up there.

The hook has to sit *before* the method guard, because that server allows only
`GET` and `HEAD` and the store is written with `POST`, `PUT` and `DELETE`. It is
a dynamic `import()` because `server.js` is CommonJS and `api/` is ESM:

```js
let appraisals = null;
const apiReady = import("./api/appraisals.mjs")
  .then((m) => { appraisals = m.handle; })
  .catch((err) => { console.error("Appraisal store disabled:", err.message); });

// first thing in the request handler:
if ((req.url || "").startsWith("/api/")) {
  await apiReady;
  if (appraisals && (await appraisals(req, res))) return;
  res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ error: "The appraisal store is not enabled here." }));
  return;
}
```

A failed import — `api/` not deployed, or `pg` not installed — leaves the routes
off and `/api/*` answering 404, which is what both pages already treat as "no
store": they hide their server buttons and behave as they did before it existed.
Note that the previous server answered **200** for `/api/appraisals`, because
unknown paths fall through to `index.html`; the pages read that as a store
present but broken, so this branch is what makes the fallback work at all.

### Deploying it

`Deploy/deploy.sh` does the whole push over Kudu VFS.

```bash
Deploy/deploy.sh probe          # what is deployed now
Deploy/deploy.sh push api       # api/*.mjs, schema.sql, server.js, package.json
Deploy/deploy.sh npm            # npm install --omit=dev in wwwroot
Deploy/deploy.sh restart
Deploy/deploy.sh push static    # us.html, australia.html, the landing pages
Deploy/deploy.sh health
```

It authenticates with the **publish profile**, not an ARM token: on this machine
`az account get-access-token` fails (CLI 2.88 ships Python 3.14, whose strict
X.509 check rejects the Netskope root for having no keyUsage extension) and
device-code sign-in is blocked by Conditional Access. Portal → the app →
Overview → **Download publish profile**, and take the **MSDeploy** entry; the
FTP entry's password is different and 401s. The script reads it into a curl
`--config` file so the password never reaches the terminal or the process list.

`npm` and `restart` go through Kudu's command API, since the platform restart
call needs ARM. Killing `node server.js` is the restart — the container
supervisor starts it again.

Nothing in `az` is reachable from here, so **provisioning stays a portal job**:
managed identity on the web app, the `SQL_*` app settings, the SQL firewall and
Easy Auth. The data plane — files, `npm install`, restart, the schema, the
seed — is all doable from this machine once those exist.

## Access control — who signs in, and which region they see

Identity is internal, not Microsoft/Entra: an email + password this app owns
and hashes itself (node:crypto `scrypt`, no dependency), because Easy Auth
would have made every signed-in person a Sobha Entra account, and the
requirement is the opposite - specific external people, admin-created, with no
tenant membership at all. Authorization - which region a signed-in person may
open, and who administers that - is `api/access.mjs` plus
`api/schema-access.sqlserver.sql`. Neither existed before the store had to
answer "someone with Australia access must not be able to open the US model."

| | |
|---|---|
| `schema-access.sqlserver.sql` | `app_user` (now carrying `password_hash`, `must_change_password`), `user_region_access`, `access_request`, `user_session`, `access_audit`, `appraisal_audit`, and the views the routes and the gate read - `user_access`, `session_summary`, `session_activity`. Run once, after `schema.sqlserver.sql`. Ends with a guarded bootstrap: the named UPN becomes the first admin, but with no password - see **Bootstrapping the first admin** below - and only while no admin exists, so re-running it is a no-op once one does. |
| `access.mjs` | Password hashing (`hashPassword`/`verifyPassword`), signed session cookies (`sessionCookieHeader`/`sessionIdFromRequest`, HMAC'd with the `SESSION_SECRET` app setting), `POST /api/login`, `POST /api/logout`, `POST /api/bootstrap-admin`, `POST /api/change-password`, `GET /api/me`, `POST /api/access-requests`, and `/api/admin/*` (users incl. create/reset-password, requests, sessions, audit) behind an `isAdmin` check. `grantsFor(req)` resolves a caller from their session cookie once per minute per session (cached; a revoke is visible within that window, no separate invalidation needed). |
| `Deploy/server.js` | gates `us.html`, `australia.html` and `admin.html` on the resolved region/admin flag, *after* `resolveRequestPath()` so every alias (`/us`, `/usa`, `/us.html`, …) is covered by one check. No session → redirect to `/login`; wrong or no region → 403 with `no-access.html`; the access module unreachable → 503, never a silent open. |
| `Deploy/sobha-login-region.html` | the actual sign-in form (email + password → `POST /api/login`). Aliased at `/`, `/login`. |
| `Deploy/change-password.html` | self-service password change; where `must_change_password` sends someone after a first sign-in or an admin reset. |
| `Deploy/no-access.html` | what a signed-in person without the region sees - reads `/api/me`, offers a request form, hides it if the account is disabled. |
| `Deploy/admin.html` | create a user (with a one-time temporary password), reset a password, grant/revoke a region, make/remove an admin, decide pending requests, and the session-activity view below - one page, four tabs. |

**Bootstrapping the first admin.** `schema-access.sqlserver.sql` creates the
named admin's `app_user` row but leaves `password_hash` null - hashing has to
happen in the app, not T-SQL. Finish it with one call, which only ever
succeeds once (it refuses a UPN that already has a `password_hash`, so it is
safe to leave deployed rather than needing removal after use):

```bash
curl -X POST https://uat-landfeasibility.sobhaapps.com/api/bootstrap-admin \
  -H 'content-type: application/json' \
  -d '{"email":"jay.kadam@sobharealty.com","password":"<a real password, 10+ chars>"}'
```

From there, sign in at `/login` and use `admin.html` → **Create user** for
everyone else - each gets a random temporary password shown once (there is no
email sending here, so relay it out of band) and `must_change_password` set,
which routes them to `/change-password` on their first sign-in.

**`SESSION_SECRET`** (app setting) signs the session cookie; without it,
`/api/login` and every gated request fail closed with 503 rather than falling
back to a guessable default - the same stance the rest of this file takes on
an unreachable database.

**Off by default.** `ACCESS_ENFORCE` (app setting) or `access.config.json`
(`{"enforce": true}`, a plain file next to `server.js`) turns the gate on;
neither set, and the site behaves exactly as before this existed. The file is
the kill switch that does not need portal access: `Deploy/deploy.sh enforce
on|off` PUTs it over Kudu, and `server.js` re-reads it at most every five
seconds - no restart. If `access.mjs` fails to load, or `grantsFor` throws
(the database is unreachable), a gated page answers **503**, deliberately: an
enforcement flag that quietly stops enforcing is worse than an outage, and the
outage is one Kudu PUT away from `enforce off`.

**Sessions.** `POST /api/login` creates the `user_session` row explicitly and
names it with an HMAC-signed cookie (`SESSION_SECRET`) - the id means nothing
without a matching row, so a stolen cookie is useless once that row is deleted,
which `POST /api/logout` and an admin's reset-password action both do. Unlike
the derived-from-activity design this replaced, the cookie's own 12-hour
`Max-Age` is what ends a session on its own; every request in between just
touches `last_seen_at`. A save (`appraisal_audit`,
alongside the existing `appraisal_version`) and a delete (which never touched
`appraisal_version` - this is the only record it leaves) both carry the
session's id, and so does an access change (`access_audit.session_id`). That is
what `GET /api/admin/sessions/:id` reads: everything one person did, merged and
ordered by time, visible only to admins, the same `isAdmin` check as the rest
of `/api/admin/*`.

**Region enforcement closed four gaps that region *scoping* had left open** in
`appraisals.mjs`: `GET /:id`, both versions routes and `DELETE` carried no
region predicate at all before this, so a filtered list was not the same as
being unable to reach a row by id. All four now match a missing row and a
forbidden one identically - a 404, never a 403 that would confirm a row exists
in a region the caller cannot see.

## Routes

| | |
|---|---|
| `GET /api/appraisals` | List. `?region=US|AU` filters; envelopes excluded, since the list opens far more often than any appraisal loads. |
| `GET /api/appraisals?region=AU&expand=1` | Every envelope for one region, in `created_at` order — how the Australian page opens all twelve projects at once. Region required. |
| `GET /api/appraisals/:id` | One appraisal, envelope included. |
| `POST /api/appraisals` | Create. Body `{name, location, region, envelope}`. |
| `PUT /api/appraisals/:id` | Update. Body adds `expected_version`. |
| `DELETE /api/appraisals/:id` | Soft delete; versions are kept. |
| `GET /api/appraisals/:id/versions` | History. |
| `GET /api/appraisals/:id/versions/:n` | One past envelope. |

**Concurrency.** Every save sends the version it loaded. If someone else saved in
between, the update matches nothing and comes back `409` naming them, and the
page offers to overwrite. Without this the second save silently wins — the exact
failure that makes a shared store worse than the files it replaces.

**Why the envelope is stored whole.** It gains keys whenever a lever is added to
`GROUPS`, and the client's load path already migrates older `v` values. Shredding
`parcels` into columns would duplicate that migration and force a DDL change per
lever. Postgres TOASTs and compresses jsonb over ~2 kB, which matters because
the US envelope carries a copy of `sourceData` (~52 kB raw). The Australian rows do not — see **The Australian projects live here** below.

**Trust.** Nothing here interprets the envelope. Anything loaded — file or
server — goes back through `cleanStoredInputs` and `enforceAccountingPolicy` in
the page, so the accounting-policy fields stay fixed centrally and a stored
payload is trusted no further than one read off disk.

## Saved sites

`schema.sql` adds `appraisal_site` — one row per parcel, carrying the saved site
polygon and everything the map section resolved about it. It is **derived**: a
trigger rebuilds it from `appraisal.envelope` on every write, so it cannot drift
from what the page saved, and nothing writes to it directly.

Why it exists at all, when the envelope already holds the same data: the
envelope is the right shape for *loading one appraisal* and the wrong shape for
*asking a question across all of them*. "Every saved site in Travis County",
"which sites are zoned SF-2", "put all our sites on one map" each mean parsing
every envelope without it.

| | |
|---|---|
| `geometry` | The saved polygon, GeoJSON, exactly as the page drew it — feed it straight back to MapLibre. |
| `centroid_lng` / `centroid_lat` | Polygon centroid from site intelligence, falling back to the search pin. |
| `area_acres` | Measured off the polygon. |
| `acres_gross` / `acres_deducted` | What the appraisal is *priced* on. These differ from `area_acres` until someone presses **Apply site area** — the gap is worth being able to see. |
| `address` `suburb` `state_code` `lga` `postcode` | Resolved location. |
| `zone_code` `zone_name` `planning_instrument` `max_height` `fsr` `min_lot_size` | Official planning controls, as text — the sources return `Not mapped / not returned` as often as a number, and casting that to a numeric column would turn an unanswered query into a zero. |
| `elev_min` / `elev_mean` / `elev_max` | Terrain screening, when **Analyse site** has been run. |
| `intel` | The whole `siteIntel` object — demographics, 3S proximity, per-source availability flags. |
| `map_view` | Base map, zoom, radius rings, overlay toggles, search label. Restores the view the appraisal was saved in. |

Every one of the 46 jsonb keys these columns read is checked against the page's
own writers (`state()`, `runSiteIntelligence()`, `analyzeSite()`, the save
envelope) — a typo would be silent, since a wrong path just yields null.

`saved_site` is the view to query: it joins the appraisal, excludes soft-deleted
rows, and drops the bulky `intel` blob.

### The queries

Every saved site, for a portfolio map:

```sql
select appraisal_id, parcel_name, address, state_code, lga,
       centroid_lng, centroid_lat, area_acres, zone_code, geometry
from saved_site
where geometry is not null
order by updated_at desc;
```

As a GeoJSON FeatureCollection the map can consume with no client assembly:

```sql
select jsonb_build_object(
  'type', 'FeatureCollection',
  'features', coalesce(jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'id',   appraisal_id || ':' || parcel_ord,
      'geometry', geometry,
      'properties', jsonb_build_object(
        'appraisal',  appraisal_name,
        'parcel',     parcel_name,
        'address',    address,
        'acres',      area_acres,
        'acresPriced',acres_gross,
        'zone',       zone_code,
        'zoneName',   zone_name,
        'lga',        lga,
        'state',      state_code))), '[]'::jsonb))
from saved_site
where geometry is not null;
```

Within 5 km of a point, without PostGIS — the haversine is cheap at this row
count, and the bounding-box predicate in front of it uses
`appraisal_site_bbox_idx`:

```sql
with p as (select $1::float8 as lng, $2::float8 as lat, $3::float8 as km)
select s.parcel_name, s.address, s.area_acres, s.zone_code,
       6371 * 2 * asin(sqrt(
         sin(radians(s.centroid_lat - p.lat) / 2) ^ 2 +
         cos(radians(p.lat)) * cos(radians(s.centroid_lat)) *
         sin(radians(s.centroid_lng - p.lng) / 2) ^ 2)) as km
from saved_site s, p
where s.centroid_lat between p.lat - p.km / 111.0 and p.lat + p.km / 111.0
  and s.centroid_lng between p.lng - p.km / (111.0 * cos(radians(p.lat)))
                        and p.lng + p.km / (111.0 * cos(radians(p.lat)))
  and s.centroid_lat is not null
order by km
limit 200;
```

One input across every appraisal — `acresGross` here, but any of the 451 keys in
`GROUPS` works the same way, with no schema change:

```sql
select a.name, p.parcel ->> 'name' as parcel,
       appraisal_num(p.parcel -> 'inputs' ->> 'acresGross') as acres_gross,
       appraisal_num(p.parcel -> 'inputs' ->> 'pr')         as land_price
from appraisal a
cross join lateral jsonb_array_elements(coalesce(a.envelope -> 'parcels', '[]'::jsonb)) as p(parcel)
where a.deleted_at is null
order by a.name;
```

Rebuild the projection by hand, if a column definition here ever changes:

```sql
select appraisal_site_refresh(id) from appraisal where deleted_at is null;
```

### If you want real spatial queries later

Flexible Server supports PostGIS once `postgis` is added to the server's
`azure.extensions` parameter. Then add a generated column and a GiST index, and
the distance query above becomes `st_dwithin`:

```sql
create extension if not exists postgis;
alter table appraisal_site
  add column if not exists geom geography(Geometry, 4326)
  generated always as (st_geomfromgeojson(geometry)::geography) stored;
create index if not exists appraisal_site_geom_idx on appraisal_site using gist (geom);
```

Not done by default, because it turns a schema that applies itself on boot into
one that needs a server parameter changed and a restart first — and nothing in
the app needs it yet.

### Status

The SQL is verified as far as it can be without a server: it parses under the
PostgreSQL grammar (`pgsql-parser`, function bodies parsed separately), the
insert's 31 columns match its 31 values, dollar quoting is balanced, there are no
bind placeholders to break the multi-statement boot query, and every jsonb key
resolves to a key the page writes. It has **not** been run against a live
database — there is no Postgres on this machine — so column resolution and the
trigger firing are unproven until `db.mjs` applies it on first boot.

### The page side

`buildEnvelope()` and `applyEnvelope()` now exist in both pages, extracted from
the inline `btnSave` literal and the `fileIn.onchange` body. **Save to server**
and **Open from server** sit beside the file buttons and go through the same
two functions, so a stored row and a saved `.json` cannot diverge. The store
block (`<script id="appraisal-store">`) is last in the document and hides both
buttons if the routes return 404, so a deployment without them behaves exactly
as before.

The envelope also gained a `region` — `"US"` or `"AU"`. Both models write `v:7`
over different `DEF` keys (the Australian envelope carries `sourceData` the US
one no longer has), so the version number alone cannot tell them apart. The
region is checked in three places: `applyEnvelope` refuses another model's
envelope by name, the list route filters on it, and the update statement matches
on it so a cross-model write cannot land even with a valid id and version.

Verified in the real page context (`scratchpad/envrt.js`, 9 checks on each
file): every key the old inline literal wrote is still written, real inputs and
a parcel's whole `gis` — polygon, `savedSiteId`, site intelligence, terrain —
survive a round trip byte-for-byte, the computed `_`-prefixed display fields are
correctly dropped and recomputed, the other model's envelope is refused, an
envelope predating `region` still loads, and every invariant still holds
afterwards (75 on each US parcel, 72 on each of the 12 Australian ones, with
`npbt` unmoved). The routes themselves have 16 tests against a stubbed database
(`scratchpad/routes.mjs`) covering region validation, both 409 causes and the
placeholder/parameter count of every statement.

Still outstanding: `server.js` in `wwwroot` needs the two-line hook from
section 4 above, `npm install pg` in `wwwroot`, and Easy Auth switched on
before the routes are enabled.

## The Australian projects live here, not in the page

`Australia_Land_Feasibility_.html` used to carry its twelve projects as
hardcoded `newParcel()` literals. They are now twelve rows in this store, and
the page holds none of them.

**One row per project**, loaded together. The page fetches them all at startup
(`GET /api/appraisals?region=AU&expand=1`, about 85 kB) so the project switcher
and the consolidation panes still see the whole portfolio — but a save writes
only the project that changed, so two people working on different projects never
collide. `expand` requires a region, so no caller can pull both models'
envelopes in one request.

That list is ordered by **`created_at` ascending**, not by recency. The seed
stamps the twelve one second apart, so the switcher keeps a stable order instead
of reshuffling every time somebody saves.

### Seeding

`seed-au.sql` is a one-time migration, run by hand — `db.mjs` applies only
`schema.sql` on boot, and a seed that re-ran on every restart would fight
whatever people had since edited.

```bash
psql "$PGCONN" -f api/schema.sql     # if the schema is not already applied
psql "$PGCONN" -f api/seed-au.sql
```

It was generated from the running page rather than by reading the HTML,
because each parcel's literal contained computed expressions
(`195000000/6243`) and deliberate duplicate keys where a later "round 2" value
overrode an earlier one. Only the evaluated object is the truth, so the
generator boots the page and serialises what the model actually ran on.

Row ids are derived from the project name (a v5-style UUID over a fixed
namespace), so running the seed twice conflicts on the primary key and does
nothing. Random ids would have quietly produced twelve duplicates.

**Verified before the projects were removed from the page**: fed back one row per
project into the stripped file, all twelve reload with inputs identical *key by
key*, 72 invariants each, `npbt` and gross revenue unchanged to the dollar, the
`sourceKey` on 9 of the 12 still linking to `sourceData`, and the portfolio still
spanning all twelve. `scratchpad/reload.js`.

### What did not move

`SOURCE_BP_DEFAULT` — the 52 kB business-plan comparison data — stays in the
page. The only write to `APP.sourceData` anywhere is in `applyEnvelope`, and
`sourceEditTarget` is read by nothing, so it is reference material belonging to
the app rather than project data. Copying it into all twelve rows would store
the same thing twelve times and let the copies diverge.

`BUSINESS_PLAN_PROJECTS`, `makeBusinessPlanInputs` and `BP_INPUTS` were removed
outright — 14.5 kB whose only purpose was building those twelve literals, with
no reference anywhere else in the file.

### Saving is explicit

Nothing autosaves. **Save project** writes the projects whose inputs differ from
what was loaded — the button says how many and names them in its tooltip — and
**Reload all** re-fetches, warning first if there are unsaved changes. A
concurrent save is always a decision: the conflict names who saved and offers
the overwrite, per project, rather than silently winning.

### If the store is unreachable

The page has no projects of its own to fall back on, so it says so plainly above
the switcher and offers a retry, rather than opening one empty appraisal that
looks exactly like data loss. **This makes the store a hard dependency for the
Australian page** — it must not be deployed to UAT until Postgres is
provisioned, `server.js` carries the hook, `pg` is installed in `wwwroot`, Easy
Auth is on and `seed-au.sql` has been run.

The US page is unchanged in this respect: its two parcels are Landowner Co and
Homebuilder Co of one consolidated deal rather than independent projects, so it
still stores a whole appraisal as a single row and keeps the **Open from
server** picker. The API is region-scoped, so both models share one store
without either seeing the other's envelopes.

## Everything drawn, and every source it came from

`appraisal_site` answers "where is this appraisal's site". Two further
projections, added the same way — derived from `envelope`, rebuilt by the same
trigger, never written to directly — answer the other two questions the store is
for.

| | |
|---|---|
| `appraisal_feature` | **Every** drawn feature, not just the saved site: radius rings, measured lines, dropped points, and any polygon that is not the site. One row per feature, in drawing order, with its GeoJSON geometry, `properties`, `is_saved_site`, `is_draft`, `ring_km` and vertex count. |
| `appraisal_source` | One row per parcel per collector — `planning`, `context`, `reverse`, `station`, `school`, `shopping`, `hospital` — carrying the provider the envelope names, its endpoint, its own status wording, `dataCurrency`, whether it answered, the error if it did not, and `resolved_at` from `siteIntel.updatedAt`. |
| `data_source` | The registry those rows point into. A jurisdiction source registers **itself** the first time it answers for a site, so the hundred-odd agencies in the two pages are never copied here to drift. The services that run for every site — Photon, Overpass, AWS Terrain Tiles, ABS, Census TIGERweb, the basemaps — are seeded, because the envelope records that they ran, not what they were. |
| `dataset_release` | The sources that ship *inside* the page rather than being fetched: the Cotality monthly series generated into `#sales-market-data`. Which release a number came from is a fact about the deployed build, not about one appraisal, so this table is written by whoever regenerates the block — nothing derives it. |

Query the views, not the tables: `saved_site`, `saved_map_feature`,
`data_source_used` (which fills the provider in from the registry for the
collectors the envelope does not name) and `appraisal_input`.

`appraisal_input` is the inputs, long-form — one row per key per parcel, over
`jsonb_each_text`, so every input key is queryable and the next lever added
needs no DDL - 545 distinct keys across the twelve Australian projects today.

```sql
-- every input on every Australian project, as saved
select appraisal_name, parcel_name, input_key, input_number
from appraisal_input
where region = 'AU' and input_key in ('pr', 'acresGross', 'landRate')
order by appraisal_name;

-- everything drawn on one appraisal's map, ready for MapLibre
select parcel_name, kind, feature_name, is_saved_site, ring_km, geometry
from saved_map_feature
where appraisal_id = $1
order by parcel_ord, feature_ord;

-- which sources answered, and which did not
select appraisal_name, parcel_name, collector, provider, ok, status, currency, error
from data_source_used
order by appraisal_name, parcel_ord, collector;

-- every source the portfolio has ever used, and when it was last seen
select d.region, d.collector, d.provider, d.endpoint, d.official,
       count(distinct s.appraisal_id) as appraisals, max(s.resolved_at) as last_resolved
from data_source d
left join appraisal_source s on s.source_key = d.source_key
group by 1, 2, 3, 4, 5
order by d.region, d.collector, d.provider;

-- sites whose planning came back unanswered, which is a research list
select appraisal_name, parcel_name, status, error
from data_source_used
where collector = 'planning' and coalesce(ok, false) = false;
```

Rebuild all three projections by hand, if a column definition here changes:

```sql
select appraisal_site_refresh(id), appraisal_feature_refresh(id), appraisal_source_refresh(id)
from appraisal where deleted_at is null;
```

### Both regions, one schema

`schema.sql` is region-agnostic: `appraisal.region` is `'US'` or `'AU'`, every
projection copies it down, and the routes filter and enforce on it. So the same
file is the answer to "the SQL for the US app" and "the SQL for the Australian
app" — run it once for a shared database (what the routes assume, and what makes
a single portfolio map possible), or run it unchanged in two databases if the
two are ever to be kept apart. Nothing in it is per-region except the seeded
registry rows, which carry their own `region` and are inserted `on conflict do
nothing`.

### Verified

The schema no longer rests on parsing alone: `api/schema-test.mjs` runs it on a
real PostgreSQL 16 engine - PGlite, the Postgres source compiled to WASM, so no
server or admin rights are needed - applies it twice to prove idempotence, loads
the real twelve-project `seed-au.sql`, inserts a parcel carrying a full `gis`
object, and checks what the trigger actually produced. Thirty checks, all
passing: the saved polygon and its centroid, square metres converted to acres,
planning sentinels kept as text, four of five features projected with the null
geometry dropped, ring `km` and vertex counts, one row per collector with the
failed one carrying its error and the empty one not counted as a failure, the
NSW agency registering itself, the registry filling in the providers the
envelope does not name, a removed feature losing its row, and a soft delete
clearing all three projections.

```bash
npm i @electric-sql/pglite       # dev only, nothing ships with it
node api/schema-test.mjs
```

The static checks still run alongside it: `pgsql-parser` over the file and each
plpgsql body, insert arity (`appraisal_feature` 17 = 17, `appraisal_source`
14 = 14, `data_source` 7 = 7, `appraisal_site` 32 = 32), balanced dollar
quoting, no bind placeholders in the multi-statement boot query, and all 65
jsonb keys checked against the pages that write them.

What PGlite cannot prove is the Azure side: TLS, the pool, Easy Auth and the
private network are still unexercised, and no Flexible Server has been reached
from this machine.
