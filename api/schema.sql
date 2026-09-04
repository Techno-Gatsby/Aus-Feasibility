/* Saved appraisals. Applied on boot by db.mjs; every statement is idempotent so
   a restart is never a migration event.

   The v:7 envelope the app already writes is stored whole in `envelope` rather
   than shredded into columns. It gains keys whenever a lever is added to GROUPS,
   and the client's load path already migrates older envelope versions - shredding
   would put that migration in two places and force a DDL change per lever. */

create table if not exists appraisal (
  id          uuid primary key default gen_random_uuid(),
  name        text        not null,
  location    text,
  envelope    jsonb       not null,
  envelope_v  integer     not null,
  /* Bumped on every write. The client sends the version it loaded and the update
     fails if it no longer matches, so two people editing the same appraisal get a
     conflict instead of one silently overwriting the other. */
  version     integer     not null default 1,
  created_by  text        not null,
  created_at  timestamptz not null default now(),
  updated_by  text        not null,
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);

create index if not exists appraisal_live_idx on appraisal (updated_at desc) where deleted_at is null;
create index if not exists appraisal_name_idx on appraisal (lower(name))     where deleted_at is null;

/* Which model wrote it. Both pages write `v:7` over different DEF keys - the
   Australian envelope carries `sourceData` the US one does not, and each has
   levers the other has never heard of - so the version number alone cannot tell
   them apart, and one shared store would otherwise hold two incompatible
   shapes indistinguishably. The list route filters on this, and the page
   refuses an envelope whose region is not its own.

   Left nullable so adding it to a populated table cannot fail; the routes
   require it on every insert, so only pre-existing rows can lack one. */
alter table appraisal add column if not exists region text;

/* Rows saved before the column existed, classified by the one structural
   difference between the two envelopes. A guess, but a checkable one, and it
   only ever runs while such rows exist. */
update appraisal set region = case when envelope ? 'sourceData' then 'AU' else 'US' end
where region is null;

do $fn$ begin
  if not exists (select 1 from pg_constraint where conname = 'appraisal_region_ck') then
    alter table appraisal add constraint appraisal_region_ck check (region in ('US', 'AU'));
  end if;
end $fn$;

create index if not exists appraisal_region_idx on appraisal (region, updated_at desc) where deleted_at is null;

/* Full history. Postgres TOASTs and compresses jsonb over ~2 kB, which matters
   here because every envelope carries a copy of sourceData (~61 kB uncompressed). */
create table if not exists appraisal_version (
  appraisal_id uuid        not null references appraisal(id) on delete cascade,
  version      integer     not null,
  name         text        not null,
  envelope     jsonb       not null,
  envelope_v   integer     not null,
  saved_by     text        not null,
  saved_at     timestamptz not null default now(),
  note         text,
  primary key (appraisal_id, version)
);

/* ─────────────────────────────────────────────────────────────────────────────
   Saved sites — a queryable projection of the map section

   The envelope above already contains every saved site: each parcel carries a
   `gis` object holding the drawn FeatureCollection, which polygon is the saved
   site (`savedSiteId`), the resolved site intelligence (address, jurisdiction,
   zoning, demographics, proximity), the terrain sample and the map view. So
   nothing below adds information - it makes that information *addressable*, so
   a map or a portfolio list can ask "every saved site in Texas" without
   pulling and parsing every envelope.

   It is strictly derived. `appraisal.envelope` stays the only authoritative
   copy, these rows are rebuilt from it by trigger on every write, and the
   projection is therefore incapable of drifting from what the page saved. If a
   column below is ever wrong the fix is here, not a data repair. That is the
   difference between this and shredding the envelope into columns, which the
   note at the top of this file rejects and still rejects: a lever added to
   GROUPS must never require a migration.
   ──────────────────────────────────────────────────────────────────────────── */

/* jsonb ->> yields text, and the page writes some numeric inputs as strings.
   A bare ::numeric cast on "" or "Not mapped" aborts the whole trigger, so
   every numeric read goes through here. */
create or replace function appraisal_num(v text) returns double precision
language sql immutable parallel safe as $fn$
  select case when v ~ '^[+-]?([0-9]+\.?[0-9]*|\.[0-9]+)([eE][+-]?[0-9]+)?$'
              then v::double precision end;
$fn$;

create table if not exists appraisal_site (
  appraisal_id    uuid    not null references appraisal(id) on delete cascade,
  /* Position in envelope->parcels. The page's own parcel id (`parcel_key`) is
     regenerated on some load paths, so ordinality is the stable handle. */
  parcel_ord      integer not null,
  parcel_key      text,
  parcel_name     text    not null,
  parcel_location text,
  /* copied down from the appraisal, so a map can filter without a join */
  region          text,

  /* the saved polygon itself - this is what the map redraws */
  feature_id      text,
  geometry        jsonb,
  centroid_lng    double precision,
  centroid_lat    double precision,

  /* Areas: measured off the polygon, and what the appraisal is actually priced
     on. They differ until someone presses "Apply site area", and the gap
     between them is worth being able to see across the portfolio. */
  area_acres      double precision,
  acres_gross     double precision,
  acres_deducted  double precision,

  /* resolved location */
  address         text,
  suburb          text,
  state_code      text,
  lga             text,
  postcode        text,

  /* Official planning controls as returned by the jurisdiction source. Kept as
     text because those sources return prose sentinels ("Not mapped / not
     returned") as often as numbers, and losing that distinction would turn an
     unanswered query into a zero. */
  zone_code           text,
  zone_name           text,
  planning_instrument text,
  planning_authority  text,
  planning_source     text,
  max_height          text,
  fsr                 text,
  min_lot_size        text,

  /* terrain screening */
  elev_min        double precision,
  elev_mean       double precision,
  elev_max        double precision,
  elev_samples    integer,

  /* everything else, unabridged: demographics, proximity, availability flags */
  intel           jsonb,
  /* base map, zoom, rings, overlay toggles, search label - so reopening an
     appraisal restores the view it was saved in */
  map_view        jsonb,

  refreshed_at    timestamptz not null default now(),
  primary key (appraisal_id, parcel_ord)
);

create index if not exists appraisal_site_region_idx   on appraisal_site (region);
create index if not exists appraisal_site_state_idx    on appraisal_site (state_code, lga);
create index if not exists appraisal_site_postcode_idx on appraisal_site (postcode);
create index if not exists appraisal_site_bbox_idx     on appraisal_site (centroid_lat, centroid_lng);
create index if not exists appraisal_site_zone_idx     on appraisal_site (zone_code);
create index if not exists appraisal_site_name_idx     on appraisal_site (lower(parcel_name));

/* Rebuild the projection for one appraisal. Delete-then-insert rather than
   upsert: a parcel removed from the envelope has to lose its row, and at one
   row per parcel the cost is nil. */
create or replace function appraisal_site_refresh(p_id uuid) returns void
language plpgsql as $fn$
begin
  delete from appraisal_site where appraisal_id = p_id;

  insert into appraisal_site (
    appraisal_id, parcel_ord, parcel_key, parcel_name, parcel_location, region,
    feature_id, geometry, centroid_lng, centroid_lat,
    area_acres, acres_gross, acres_deducted,
    address, suburb, state_code, lga, postcode,
    zone_code, zone_name, planning_instrument, planning_authority, planning_source,
    max_height, fsr, min_lot_size,
    elev_min, elev_mean, elev_max, elev_samples,
    intel, map_view)
  select
    a.id,
    pc.ord::int,
    pc.parcel ->> 'id',
    coalesce(nullif(pc.parcel ->> 'name', ''), 'Unnamed parcel'),
    pc.parcel ->> 'loc',
    a.region,

    site.feature ->> 'id',
    site.feature -> 'geometry',
    /* The site-intelligence centroid is the polygon's own centroid; the search
       pin is the fallback for a site saved before intelligence was built. */
    coalesce(appraisal_num(gj.gis -> 'siteIntel' -> 'centroid' ->> 0), appraisal_num(gj.gis -> 'searchPoint' ->> 0)),
    coalesce(appraisal_num(gj.gis -> 'siteIntel' -> 'centroid' ->> 1), appraisal_num(gj.gis -> 'searchPoint' ->> 1)),

    /* The US model records areaAcres; the Australian one records only `area`,
       in square metres. Reading just the first would leave every Australian
       site with a null area. */
    coalesce(appraisal_num(gj.gis -> 'siteIntel' ->> 'areaAcres'),
             appraisal_num(gj.gis -> 'siteIntel' ->> 'area') / 4046.8564224),
    appraisal_num(pc.parcel -> 'inputs' ->> 'acresGross'),
    appraisal_num(pc.parcel -> 'inputs' ->> 'acresDed'),

    coalesce(nullif(gj.gis -> 'siteIntel' -> 'location' ->> 'label', ''),
             nullif(gj.gis ->> 'searchLabel', ''),
             pc.parcel ->> 'loc'),
    gj.gis -> 'siteIntel' -> 'location' ->> 'suburb',
    coalesce(gj.gis -> 'siteIntel' -> 'location' ->> 'state',    gj.gis -> 'jurisdiction' ->> 'state'),
    coalesce(gj.gis -> 'siteIntel' -> 'location' ->> 'lga',      gj.gis -> 'jurisdiction' ->> 'lga'),
    coalesce(gj.gis -> 'siteIntel' -> 'location' ->> 'postcode', gj.gis -> 'jurisdiction' ->> 'postcode'),

    gj.gis -> 'siteIntel' -> 'planning' ->> 'zoneCode',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'zoneName',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'instrument',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'planningAuthority',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'sourceAgency',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'maxHeight',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'fsr',
    gj.gis -> 'siteIntel' -> 'planning' ->> 'minLotSize',

    appraisal_num(gj.gis -> 'terrainStats' ->> 'minElevation'),
    appraisal_num(gj.gis -> 'terrainStats' ->> 'meanElevation'),
    appraisal_num(gj.gis -> 'terrainStats' ->> 'maxElevation'),
    appraisal_num(gj.gis -> 'terrainStats' ->> 'samples')::int,

    gj.gis -> 'siteIntel',
    jsonb_strip_nulls(jsonb_build_object(
      'base',        gj.gis ->> 'base',
      'zoom',        gj.gis -> 'zoom',
      'rings',       gj.gis -> 'rings',
      'layers',      gj.gis -> 'layers',
      'searchLabel', gj.gis ->> 'searchLabel',
      'searchPoint', gj.gis -> 'searchPoint',
      'savedSiteId', gj.gis ->> 'savedSiteId',
      'primaryId',   gj.gis ->> 'primaryId'))
  from appraisal a
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(a.envelope -> 'parcels') = 'array'
         then a.envelope -> 'parcels' else '[]'::jsonb end)
    with ordinality as pc(parcel, ord)
  cross join lateral (
    select case when jsonb_typeof(pc.parcel -> 'gis') = 'object'
                then pc.parcel -> 'gis' else '{}'::jsonb end as gis) gj
  /* The saved site is whichever polygon the page itself would pick:
     savedSiteId, then primaryId, then any polygon flagged saved. Mirrors
     savedSite() in the page. A left join, so a parcel with no polygon still
     gets its row - the inputs and the map view are worth having on their own. */
  left join lateral (
    select f.feature
    from jsonb_array_elements(
      case when jsonb_typeof(gj.gis -> 'features' -> 'features') = 'array'
           then gj.gis -> 'features' -> 'features' else '[]'::jsonb end) as f(feature)
    where f.feature -> 'geometry' ->> 'type' in ('Polygon', 'MultiPolygon')
      and (f.feature ->> 'id' = gj.gis ->> 'savedSiteId'
        or f.feature ->> 'id' = gj.gis ->> 'primaryId'
        or f.feature -> 'properties' ->> 'saved' in ('true', '1'))
    order by (f.feature ->> 'id' = gj.gis ->> 'savedSiteId') desc nulls last,
             (f.feature ->> 'id' = gj.gis ->> 'primaryId')   desc nulls last
    limit 1) site on true
  where a.id = p_id
    and a.deleted_at is null;
end $fn$;

create or replace function appraisal_site_sync() returns trigger
language plpgsql as $fn$
begin
  perform appraisal_site_refresh(new.id);
  perform appraisal_feature_refresh(new.id);
  perform appraisal_source_refresh(new.id);
  return null;
end $fn$;

/* Fires on the envelope changing and on a soft delete or undelete - the
   refresh drops every row for a deleted appraisal, so the site list needs no
   deleted_at filter of its own. */
drop trigger if exists appraisal_site_sync_trg on appraisal;
create trigger appraisal_site_sync_trg
  after insert or update of envelope, deleted_at on appraisal
  for each row execute function appraisal_site_sync();

/* One row per parcel for the map: the geometry, where it is, what it is zoned
   and what the appraisal makes of it. */
create or replace view saved_site as
select s.appraisal_id, a.name as appraisal_name, a.updated_at, a.updated_by, s.region,
       s.parcel_ord, s.parcel_name, s.address, s.suburb, s.state_code, s.lga, s.postcode,
       s.centroid_lng, s.centroid_lat, s.geometry,
       s.area_acres, s.acres_gross, s.acres_deducted,
       s.zone_code, s.zone_name, s.planning_instrument,
       s.elev_min, s.elev_mean, s.elev_max,
       s.map_view
from appraisal_site s
join appraisal a on a.id = s.appraisal_id and a.deleted_at is null;

/* Backfill anything already stored. Idempotent, and a no-op on a fresh
   database - so this file stays safe to run on every boot. */
do $fn$
declare r record;
begin
  for r in select id from appraisal where deleted_at is null
             and not exists (select 1 from appraisal_site s where s.appraisal_id = appraisal.id)
  loop
    perform appraisal_site_refresh(r.id);
  end loop;
end $fn$;

/* ─────────────────────────────────────────────────────────────────────────────
   Everything drawn on the map, and every source the map data came from

   Two more projections of the same envelope, on the same terms as
   appraisal_site above: derived, rebuilt by the trigger on every write, never
   written to directly, and adding no information the envelope does not already
   hold - only making it addressable.

   appraisal_site carries the one saved site polygon. appraisal_feature carries
   *everything drawn* - the radius rings, measured lines, dropped points and any
   polygon that is not the saved site - because "the map data I added" is the
   whole FeatureCollection, not just the parcel boundary.

   appraisal_source records, per parcel, which external service answered each
   part of site intelligence, whether it answered, and what it said about its own
   currency. data_source is the registry those rows point into.
   ──────────────────────────────────────────────────────────────────────────── */

/* Stable key for a source: region + collector + provider, slugged. */
create or replace function appraisal_slug(v text) returns text
language sql immutable parallel safe as $fn$
  select nullif(trim(both '-' from regexp_replace(lower(coalesce(v, '')), '[^a-z0-9]+', '-', 'g')), '');
$fn$;

/* Vertex count without PostGIS. Null for a geometry shape this does not know,
   which is the honest answer - a zero would read as an empty ring. */
create or replace function appraisal_vertices(g jsonb) returns integer
language sql immutable parallel safe as $fn$
  select case g ->> 'type'
    when 'Point'        then 1
    when 'LineString'   then case when jsonb_typeof(g -> 'coordinates') = 'array'
                                  then jsonb_array_length(g -> 'coordinates') end
    when 'Polygon'      then case when jsonb_typeof(g -> 'coordinates' -> 0) = 'array'
                                  then jsonb_array_length(g -> 'coordinates' -> 0) end
    when 'MultiPolygon' then case when jsonb_typeof(g -> 'coordinates' -> 0 -> 0) = 'array'
                                  then jsonb_array_length(g -> 'coordinates' -> 0 -> 0) end
  end;
$fn$;

/* ── every drawn feature ─────────────────────────────────────────────────── */

create table if not exists appraisal_feature (
  appraisal_id  uuid    not null references appraisal(id) on delete cascade,
  parcel_ord    integer not null,
  /* position within gis.features.features - the drawing order the page kept */
  feature_ord   integer not null,
  feature_id    text,
  parcel_name   text    not null,
  region        text,

  kind          text,               /* geometry type: Polygon, LineString, Point */
  name          text,               /* properties.name - "Site polygon", "Measured line" */
  cadastre      text,               /* the lot label, when the polygon came from a cadastre pick */
  is_saved_site boolean not null default false,
  is_draft      boolean not null default false,
  ring_km       double precision,   /* properties.km on a radius ring */
  vertices      integer,

  geometry      jsonb   not null,   /* feed straight back to MapLibre */
  properties    jsonb,
  /* only for Point features; a polygon's centroid lives on appraisal_site */
  lng           double precision,
  lat           double precision,

  refreshed_at  timestamptz not null default now(),
  primary key (appraisal_id, parcel_ord, feature_ord)
);

create index if not exists appraisal_feature_kind_idx  on appraisal_feature (region, kind);
create index if not exists appraisal_feature_saved_idx on appraisal_feature (appraisal_id) where is_saved_site;

create or replace function appraisal_feature_refresh(p_id uuid) returns void
language plpgsql as $fn$
begin
  delete from appraisal_feature where appraisal_id = p_id;

  insert into appraisal_feature (
    appraisal_id, parcel_ord, feature_ord, feature_id, parcel_name, region,
    kind, name, cadastre, is_saved_site, is_draft, ring_km, vertices,
    geometry, properties, lng, lat)
  select
    a.id,
    pc.ord::int,
    ft.ord::int,
    ft.feature ->> 'id',
    coalesce(nullif(pc.parcel ->> 'name', ''), 'Unnamed parcel'),
    a.region,
    ft.feature -> 'geometry' ->> 'type',
    ft.feature -> 'properties' ->> 'name',
    ft.feature -> 'properties' ->> 'cadastre',
    /* the page's own test for the saved site, plus the flag it writes on it */
    (coalesce(ft.feature ->> 'id' = gj.gis ->> 'savedSiteId', false)
     or coalesce(ft.feature -> 'properties' ->> 'saved' in ('true', '1'), false)),
    coalesce(ft.feature -> 'properties' ->> 'draft' in ('true', '1'), false),
    appraisal_num(ft.feature -> 'properties' ->> 'km'),
    appraisal_vertices(ft.feature -> 'geometry'),
    ft.feature -> 'geometry',
    ft.feature -> 'properties',
    case when ft.feature -> 'geometry' ->> 'type' = 'Point'
         then appraisal_num(ft.feature -> 'geometry' -> 'coordinates' ->> 0) end,
    case when ft.feature -> 'geometry' ->> 'type' = 'Point'
         then appraisal_num(ft.feature -> 'geometry' -> 'coordinates' ->> 1) end
  from appraisal a
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(a.envelope -> 'parcels') = 'array'
         then a.envelope -> 'parcels' else '[]'::jsonb end)
    with ordinality as pc(parcel, ord)
  cross join lateral (
    select case when jsonb_typeof(pc.parcel -> 'gis') = 'object'
                then pc.parcel -> 'gis' else '{}'::jsonb end as gis) gj
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(gj.gis -> 'features' -> 'features') = 'array'
         then gj.gis -> 'features' -> 'features' else '[]'::jsonb end)
    with ordinality as ft(feature, ord)
  where a.id = p_id
    and a.deleted_at is null
    and jsonb_typeof(ft.feature -> 'geometry') = 'object';
end $fn$;

/* ── the registry of external sources ────────────────────────────────────── */

create table if not exists data_source (
  source_key    text primary key,
  /* 'AU', 'US', or 'ALL' for a service both models call */
  region        text not null default 'ALL',
  /* which part of site intelligence it answers: planning, context, reverse,
     station, school, shopping, hospital, elevation, basemap, market */
  collector     text,
  provider      text not null,
  endpoint      text,
  kind          text,              /* api | tiles | file */
  official      boolean,           /* a government planning source, as against OSM */
  notes         text,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now()
);

create index if not exists data_source_region_idx on data_source (region, collector);

/* The services the pages call for every site, whatever the jurisdiction. Seeded
   because the envelope records that these ran, not what they were - unlike a
   planning source, which names itself in the response and is registered
   automatically below. An upsert, so re-running never duplicates and never
   overwrites a note somebody added. */
insert into data_source (source_key, region, collector, provider, endpoint, kind, official) values
  ('all-reverse-photon-komoot',          'ALL', 'reverse',   'Photon (Komoot) over OpenStreetMap', 'https://photon.komoot.io',                                'api',   false),
  ('all-proximity-photon-openstreetmap', 'ALL', 'proximity', 'Photon / OpenStreetMap',             'https://photon.komoot.io',                                'api',   false),
  ('all-proximity-overpass',             'ALL', 'proximity', 'Overpass API over OpenStreetMap',    'https://overpass-api.de/api/interpreter',                 'api',   false),
  ('all-elevation-aws-terrain-tiles',    'ALL', 'elevation', 'AWS Terrain Tiles (terrarium)',      'https://s3.amazonaws.com/elevation-tiles-prod/terrarium', 'tiles', false),
  ('all-basemap-openfreemap',            'ALL', 'basemap',   'OpenFreeMap / OpenStreetMap',        'https://tiles.openfreemap.org',                           'tiles', false),
  ('all-basemap-esri-world-imagery',     'ALL', 'basemap',   'Esri World Imagery',                 'https://server.arcgisonline.com',                         'tiles', false),
  ('au-context-abs',                     'AU',  'context',   'Australian Bureau of Statistics',    'https://geo.abs.gov.au',                                  'api',   true),
  ('au-market-cotality',                 'AU',  'market',    'Cotality monthly market trends',     null,                                                      'file',  false),
  ('us-context-census-tigerweb',         'US',  'context',   'U.S. Census Bureau TIGERweb',        'https://tigerweb.geo.census.gov',                         'api',   true)
on conflict (source_key) do nothing;

/* ── which source answered, per parcel ───────────────────────────────────── */

create table if not exists appraisal_source (
  appraisal_id uuid    not null references appraisal(id) on delete cascade,
  parcel_ord   integer not null,
  collector    text    not null,
  region       text,
  parcel_name  text    not null,

  /* What the envelope itself names. Null for the collectors that record only
     that they ran - the registry above supplies the provider for those. */
  provider     text,
  endpoint     text,
  /* The source's own words: "Official NSW Planning Portal live GIS", or the
     page's ok / empty / error for a proximity search. */
  status       text,
  currency     text,
  instrument   text,
  ok           boolean,
  error        text,
  /* siteIntel.updatedAt - when this parcel's intelligence was last resolved */
  resolved_at  timestamptz,
  source_key   text,
  refreshed_at timestamptz not null default now(),
  primary key (appraisal_id, parcel_ord, collector)
);

create index if not exists appraisal_source_key_idx      on appraisal_source (source_key);
create index if not exists appraisal_source_provider_idx on appraisal_source (region, collector, provider);

create or replace function appraisal_source_refresh(p_id uuid) returns void
language plpgsql as $fn$
begin
  delete from appraisal_source where appraisal_id = p_id;

  insert into appraisal_source (
    appraisal_id, parcel_ord, collector, region, parcel_name,
    provider, endpoint, status, currency, instrument, ok, error, resolved_at, source_key)
  select
    a.id, pc.ord::int, c.collector, a.region,
    coalesce(nullif(pc.parcel ->> 'name', ''), 'Unnamed parcel'),
    c.provider, c.endpoint, c.status, c.currency, c.instrument, c.ok, c.error,
    /* the page stamps Date.now(), milliseconds */
    to_timestamp(appraisal_num(si.si ->> 'updatedAt') / 1000.0),
    case when c.provider is not null
         then appraisal_slug(coalesce(a.region, 'ALL') || '-' || c.collector || '-' || c.provider) end
  from appraisal a
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(a.envelope -> 'parcels') = 'array'
         then a.envelope -> 'parcels' else '[]'::jsonb end)
    with ordinality as pc(parcel, ord)
  cross join lateral (
    select case when jsonb_typeof(pc.parcel -> 'gis' -> 'siteIntel') = 'object'
                then pc.parcel -> 'gis' -> 'siteIntel' else '{}'::jsonb end as si) si
  cross join lateral (values
    /* the official planning query - the one collector that names its source */
    ('planning',
     nullif(si.si -> 'planning' ->> 'sourceAgency', ''),
     nullif(si.si -> 'planning' ->> 'sourceUrl', ''),
     nullif(si.si -> 'planning' ->> 'sourceStatus', ''),
     nullif(si.si -> 'planning' ->> 'dataCurrency', ''),
     nullif(si.si -> 'planning' ->> 'instrument', ''),
     si.si -> 'availability' ->> 'planning' = 'true',
     null::text),
    ('context',  null::text, null::text, null::text, null::text, null::text,
     si.si -> 'availability' ->> 'context' = 'true', null::text),
    ('reverse',  null::text, null::text, null::text, null::text, null::text,
     si.si -> 'availability' ->> 'reverse' = 'true', null::text),
    ('station',  nullif(si.si -> 'proximity' -> 'sources' ->> 'station', ''), null::text,
     nullif(si.si -> 'proximity' -> 'status' ->> 'station', ''), null::text, null::text,
     si.si -> 'proximity' -> 'status' ->> 'station' = 'ok',
     nullif(si.si -> 'proximity' -> 'errors' ->> 'station', '')),
    ('school',   nullif(si.si -> 'proximity' -> 'sources' ->> 'school', ''), null::text,
     nullif(si.si -> 'proximity' -> 'status' ->> 'school', ''), null::text, null::text,
     si.si -> 'proximity' -> 'status' ->> 'school' = 'ok',
     nullif(si.si -> 'proximity' -> 'errors' ->> 'school', '')),
    ('shopping', nullif(si.si -> 'proximity' -> 'sources' ->> 'shopping', ''), null::text,
     nullif(si.si -> 'proximity' -> 'status' ->> 'shopping', ''), null::text, null::text,
     si.si -> 'proximity' -> 'status' ->> 'shopping' = 'ok',
     nullif(si.si -> 'proximity' -> 'errors' ->> 'shopping', '')),
    ('hospital', nullif(si.si -> 'proximity' -> 'sources' ->> 'hospital', ''), null::text,
     nullif(si.si -> 'proximity' -> 'status' ->> 'hospital', ''), null::text, null::text,
     si.si -> 'proximity' -> 'status' ->> 'hospital' = 'ok',
     nullif(si.si -> 'proximity' -> 'errors' ->> 'hospital', ''))
  ) as c(collector, provider, endpoint, status, currency, instrument, ok, error)
  where a.id = p_id
    and a.deleted_at is null
    /* a parcel whose site intelligence has never run contributes nothing */
    and (c.provider is not null or c.status is not null or c.ok is not null);

  /* Register whatever named itself. The jurisdiction registries in the pages run
     to a hundred-odd agencies between them; seeding those by hand would be a copy
     that drifts, so a source enters the registry the first time it actually
     answers for a site. */
  insert into data_source (source_key, region, collector, provider, endpoint, kind, official)
  select distinct on (s.source_key)
    s.source_key, coalesce(s.region, 'ALL'), s.collector, s.provider, s.endpoint,
    case when s.endpoint like 'http%' then 'api' end,
    case when s.collector = 'planning' then true end
  from appraisal_source s
  where s.appraisal_id = p_id and s.source_key is not null
  order by s.source_key, s.parcel_ord
  on conflict (source_key) do update
    set last_seen_at = now(),
        endpoint     = coalesce(excluded.endpoint, data_source.endpoint);
end $fn$;

/* ── dataset releases: the sources that ship inside the page ─────────────── */

/* Not derived, because the envelope does not record them: the Cotality market
   series is generated into the Australian page itself, so which release a number
   came from is a fact about the deployed build rather than about any one
   appraisal. Written by whoever regenerates the block. */
create table if not exists dataset_release (
  source_key    text not null references data_source(source_key) on delete cascade,
  release_label text not null,
  region        text,
  period_start  date,
  period_end    date,
  embedded_in   text,              /* the file and script block that carries it */
  row_count     integer,
  generated_at  timestamptz,
  generator     text,
  notes         text,
  recorded_at   timestamptz not null default now(),
  primary key (source_key, release_label)
);

insert into dataset_release (source_key, release_label, region, period_start, period_end,
                             embedded_in, generator, notes) values
  ('au-market-cotality', '2026-02', 'AU', date '2025-04-01', date '2026-02-28',
   'Australia_Land_Feasibility_.html#sales-market-data',
   'node pipeline/cotality.mjs && node pipeline/inject.mjs',
   'Eleven months of Cotality sales counts and values by SA2 and LGA, inlined because the page also opens from file://.')
on conflict (source_key, release_label) do nothing;

/* ── views ───────────────────────────────────────────────────────────────── */

/* Every input the page holds, one row per key, without a column per lever -
   451 keys per parcel today, and no DDL when the next one is added. */
create or replace view appraisal_input as
select a.id as appraisal_id, a.name as appraisal_name, a.region, a.updated_at, a.updated_by,
       pc.ord::int as parcel_ord,
       coalesce(nullif(pc.parcel ->> 'name', ''), 'Unnamed parcel') as parcel_name,
       kv.key as input_key, kv.value as input_value, appraisal_num(kv.value) as input_number
from appraisal a
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(a.envelope -> 'parcels') = 'array'
       then a.envelope -> 'parcels' else '[]'::jsonb end)
  with ordinality as pc(parcel, ord)
cross join lateral jsonb_each_text(
  case when jsonb_typeof(pc.parcel -> 'inputs') = 'object'
       then pc.parcel -> 'inputs' else '{}'::jsonb end) as kv
where a.deleted_at is null;

create or replace view saved_map_feature as
select f.appraisal_id, a.name as appraisal_name, a.updated_at, a.updated_by, f.region,
       f.parcel_ord, f.parcel_name, f.feature_ord, f.feature_id,
       f.kind, f.name as feature_name, f.cadastre,
       f.is_saved_site, f.is_draft, f.ring_km, f.vertices, f.lng, f.lat,
       f.geometry, f.properties
from appraisal_feature f
join appraisal a on a.id = f.appraisal_id and a.deleted_at is null;

/* One row per source per parcel, with the provider filled in from the registry
   for the collectors the envelope does not name. */
create or replace view data_source_used as
select s.appraisal_id, a.name as appraisal_name, s.region, s.parcel_ord, s.parcel_name,
       s.collector,
       coalesce(s.provider, d.provider) as provider,
       coalesce(s.endpoint, d.endpoint) as endpoint,
       s.status, s.currency, s.instrument, s.ok, s.error, s.resolved_at
from appraisal_source s
join appraisal a on a.id = s.appraisal_id and a.deleted_at is null
left join lateral (
  select d.provider, d.endpoint
  from data_source d
  where (s.source_key is not null and d.source_key = s.source_key)
     or (s.source_key is null and d.collector = s.collector
         and d.region in (coalesce(s.region, 'ALL'), 'ALL'))
  order by (d.region = s.region) desc nulls last
  limit 1) d on true;

/* Backfill for a database that already holds appraisals - same shape as the
   appraisal_site backfill above, and equally a no-op on a fresh one. */
do $fn$
declare r record;
begin
  for r in select id from appraisal where deleted_at is null
             and not exists (select 1 from appraisal_feature f where f.appraisal_id = appraisal.id)
  loop
    perform appraisal_feature_refresh(r.id);
  end loop;
  for r in select id from appraisal where deleted_at is null
             and not exists (select 1 from appraisal_source s where s.appraisal_id = appraisal.id)
  loop
    perform appraisal_source_refresh(r.id);
  end loop;
end $fn$;
