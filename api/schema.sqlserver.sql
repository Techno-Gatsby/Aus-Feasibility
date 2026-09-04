/* Saved appraisals - Azure SQL Database (SQL Server) port of schema.sql.
   Target: sqldb-mdo-landfeasibility-uat on sql-mdo-landfeasibility-uat-01.

   Same design as the PostgreSQL original, and the reasoning there still holds:

   - The v:7 envelope the page already writes is stored WHOLE, in `envelope`,
     rather than shredded into columns. It gains keys whenever a lever is added
     to GROUPS, and the page's load path already migrates older versions, so
     shredding would put that migration in two places and force a DDL change per
     lever. `envelope` is nvarchar(max) with an ISJSON check - Azure SQL's newer
     native `json` type is deliberately not used, so this file runs on any
     supported SQL Server too.
   - Everything below `appraisal` and `appraisal_version` is a DERIVED
     PROJECTION: rebuilt from the envelope by one trigger on every write, never
     written to directly, and therefore incapable of drifting from what the page
     saved. If a column here is ever wrong, the fix is this file, not a data
     repair.

   Every statement is idempotent, so re-running this is never a migration event.
   Run it in SSMS, Azure Data Studio, sqlcmd or the portal query editor; the GO
   separators are batch terminators, not SQL, and a driver executing this file
   programmatically must split on them.
*/

/* ═════════════════════════════════════════════════════════════════════════════
   1. The store itself
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.appraisal', N'U') is null
create table dbo.appraisal (
  id          uniqueidentifier not null constraint df_appraisal_id default newid(),
  name        nvarchar(200)    not null,
  location    nvarchar(200)    null,
  envelope    nvarchar(max)    not null,
  envelope_v  int              not null,
  /* Both pages write v:7 over different DEF keys - the Australian envelope
     carries sourceData the US one does not - so the version number cannot tell
     them apart and the region has to be explicit. The list route filters on it,
     the update predicate matches on it, and each page refuses the other's. */
  region      nvarchar(2)      null,
  /* Bumped on every write. The client sends the version it loaded and the
     update fails if it no longer matches, so two people editing the same
     appraisal get a conflict instead of one silently overwriting the other. */
  version     int              not null constraint df_appraisal_version default 1,
  created_by  nvarchar(200)    not null,
  created_at  datetime2(3)     not null constraint df_appraisal_created default sysutcdatetime(),
  updated_by  nvarchar(200)    not null,
  updated_at  datetime2(3)     not null constraint df_appraisal_updated default sysutcdatetime(),
  deleted_at  datetime2(3)     null,
  constraint pk_appraisal primary key (id),
  constraint ck_appraisal_envelope check (isjson(envelope) = 1),
  constraint ck_appraisal_region   check (region in (N'US', N'AU'))
);
GO

/* Rows saved before `region` existed, classified by the one structural
   difference between the two envelopes. A guess, but a checkable one, and it
   only ever runs while such rows exist. */
update dbo.appraisal
set region = case when json_query(envelope, '$.sourceData') is not null then N'AU' else N'US' end
where region is null;
GO

if not exists (select 1 from sys.indexes where name = N'ix_appraisal_live' and object_id = object_id(N'dbo.appraisal'))
  create index ix_appraisal_live on dbo.appraisal (updated_at desc) where deleted_at is null;
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_region' and object_id = object_id(N'dbo.appraisal'))
  create index ix_appraisal_region on dbo.appraisal (region, updated_at desc) where deleted_at is null;
GO

/* Full history. One row per save, and nothing here is ever destroyed - the
   DELETE route is a soft delete precisely so this stays intact. */
if object_id(N'dbo.appraisal_version', N'U') is null
create table dbo.appraisal_version (
  appraisal_id uniqueidentifier not null,
  version      int              not null,
  name         nvarchar(200)    not null,
  envelope     nvarchar(max)    not null,
  envelope_v   int              not null,
  saved_by     nvarchar(200)    not null,
  saved_at     datetime2(3)     not null constraint df_appraisal_version_saved default sysutcdatetime(),
  note         nvarchar(500)    null,
  constraint pk_appraisal_version primary key (appraisal_id, version),
  constraint fk_appraisal_version foreign key (appraisal_id) references dbo.appraisal(id) on delete cascade,
  constraint ck_appraisal_version_envelope check (isjson(envelope) = 1)
);
GO

/* ═════════════════════════════════════════════════════════════════════════════
   2. Helpers

   JSON_VALUE yields nvarchar, and the page writes some numeric inputs as
   strings and some planning answers as prose ("Not mapped / not returned"). A
   bare CAST on those would either fail or, worse, turn an unanswered query into
   a zero - CAST('' AS float) is 0 in T-SQL, which is exactly the silent lie to
   avoid.
   ════════════════════════════════════════════════════════════════════════════ */

create or alter function dbo.appraisal_num(@v nvarchar(4000)) returns float
with schemabinding
as
begin
  if @v is null or ltrim(rtrim(@v)) = N'' return null;
  return try_convert(float, @v);
end
GO

create or alter function dbo.appraisal_bool(@v nvarchar(20)) returns bit
with schemabinding
as
begin
  if @v is null return null;
  return case when @v in (N'true', N'1') then 1 else 0 end;
end
GO

/* Stable key for a source: region + collector + provider, slugged. T-SQL has no
   portable regexp_replace, so this is the character loop that would otherwise
   be one call. */
create or alter function dbo.appraisal_slug(@v nvarchar(4000)) returns nvarchar(400)
with schemabinding
as
begin
  declare @s nvarchar(4000) = lower(ltrim(rtrim(coalesce(@v, N''))));
  declare @out nvarchar(4000) = N'';
  declare @i int = 1, @c nchar(1);
  while @i <= len(@s)
  begin
    set @c = substring(@s, @i, 1);
    if @c like N'[a-z0-9]' set @out = @out + @c;
    else if len(@out) > 0 and right(@out, 1) <> N'-' set @out = @out + N'-';
    set @i = @i + 1;
  end
  while len(@out) > 0 and right(@out, 1) = N'-' set @out = left(@out, len(@out) - 1);
  return nullif(left(@out, 400), N'');
end
GO

/* Vertex count without spatial types. Null for a shape this does not know,
   which is the honest answer - a zero would read as an empty ring. */
create or alter function dbo.appraisal_vertices(@geometry nvarchar(max)) returns int
as
begin
  declare @t nvarchar(50) = json_value(@geometry, '$.type');
  if @t = N'Point' return 1;
  if @t = N'LineString'   return (select count(*) from openjson(@geometry, '$.coordinates'));
  if @t = N'Polygon'      return (select count(*) from openjson(@geometry, '$.coordinates[0]'));
  if @t = N'MultiPolygon' return (select count(*) from openjson(@geometry, '$.coordinates[0][0]'));
  return null;
end
GO

/* The refresh procedures take a set of ids, because a SQL Server trigger fires
   once per statement with every affected row in `inserted` - unlike Postgres,
   where it is per row. */
if type_id(N'dbo.AppraisalIdList') is null
  create type dbo.AppraisalIdList as table (id uniqueidentifier not null primary key);
GO

/* ═════════════════════════════════════════════════════════════════════════════
   3. Saved sites - a queryable projection of the map section

   The envelope already contains every saved site: each parcel carries a `gis`
   object holding the drawn FeatureCollection, which polygon is the saved site
   (savedSiteId), the resolved site intelligence, the terrain sample and the map
   view. Nothing here adds information - it makes that information addressable,
   so a portfolio map can ask "every saved site in NSW" without pulling and
   parsing every envelope.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.appraisal_site', N'U') is null
create table dbo.appraisal_site (
  appraisal_id    uniqueidentifier not null,
  /* Position in envelope.parcels. The page's own parcel id is regenerated on
     some load paths, so the index is the stable handle. */
  parcel_ord      int              not null,
  parcel_key      nvarchar(100)    null,
  parcel_name     nvarchar(300)    not null,
  parcel_location nvarchar(400)    null,
  region          nvarchar(2)      null,

  /* the saved polygon itself - this is what the map redraws */
  feature_id      nvarchar(100)    null,
  geometry        nvarchar(max)    null,
  centroid_lng    float            null,
  centroid_lat    float            null,

  /* Areas: measured off the polygon, and what the appraisal is actually priced
     on. They differ until someone presses "Apply site area", and the gap is
     worth being able to see across the portfolio. */
  area_acres      float            null,
  acres_gross     float            null,
  acres_deducted  float            null,

  address         nvarchar(400)    null,
  suburb          nvarchar(200)    null,
  state_code      nvarchar(100)    null,
  lga             nvarchar(200)    null,
  postcode        nvarchar(20)     null,

  /* Official planning controls as the jurisdiction returned them. Kept as text
     because those sources return prose sentinels as often as numbers. */
  zone_code           nvarchar(200) null,
  zone_name           nvarchar(400) null,
  planning_instrument nvarchar(400) null,
  planning_authority  nvarchar(400) null,
  planning_source     nvarchar(400) null,
  max_height          nvarchar(200) null,
  fsr                 nvarchar(200) null,
  min_lot_size        nvarchar(200) null,

  elev_min        float null,
  elev_mean       float null,
  elev_max        float null,
  elev_samples    int   null,

  /* everything else, unabridged: demographics, proximity, availability flags */
  intel           nvarchar(max) null,
  /* base map, zoom, rings, overlay toggles, search label - so reopening an
     appraisal restores the view it was saved in */
  map_view        nvarchar(max) null,

  refreshed_at    datetime2(3) not null constraint df_appraisal_site_refreshed default sysutcdatetime(),
  constraint pk_appraisal_site primary key (appraisal_id, parcel_ord),
  constraint fk_appraisal_site foreign key (appraisal_id) references dbo.appraisal(id) on delete cascade
);
GO

if not exists (select 1 from sys.indexes where name = N'ix_appraisal_site_region' and object_id = object_id(N'dbo.appraisal_site'))
  create index ix_appraisal_site_region on dbo.appraisal_site (region);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_site_state' and object_id = object_id(N'dbo.appraisal_site'))
  create index ix_appraisal_site_state on dbo.appraisal_site (state_code, lga);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_site_postcode' and object_id = object_id(N'dbo.appraisal_site'))
  create index ix_appraisal_site_postcode on dbo.appraisal_site (postcode);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_site_bbox' and object_id = object_id(N'dbo.appraisal_site'))
  create index ix_appraisal_site_bbox on dbo.appraisal_site (centroid_lat, centroid_lng);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_site_zone' and object_id = object_id(N'dbo.appraisal_site'))
  create index ix_appraisal_site_zone on dbo.appraisal_site (zone_code);
GO

/* Delete-then-insert rather than a merge: a parcel removed from the envelope
   has to lose its row, and at one row per parcel the cost is nil. */
create or alter procedure dbo.appraisal_site_refresh @ids dbo.AppraisalIdList readonly
as
begin
  set nocount on;

  delete s from dbo.appraisal_site s join @ids i on i.id = s.appraisal_id;

  insert into dbo.appraisal_site (
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
    cast(pc.[key] as int) + 1,
    json_value(pc.value, '$.id'),
    coalesce(nullif(json_value(pc.value, '$.name'), N''), N'Unnamed parcel'),
    json_value(pc.value, '$.loc'),
    a.region,

    json_value(site.feature, '$.id'),
    json_query(site.feature, '$.geometry'),
    /* The site-intelligence centroid is the polygon's own centroid; the search
       pin is the fallback for a site saved before intelligence was built. */
    coalesce(dbo.appraisal_num(json_value(g.gis, '$.siteIntel.centroid[0]')),
             dbo.appraisal_num(json_value(g.gis, '$.searchPoint[0]'))),
    coalesce(dbo.appraisal_num(json_value(g.gis, '$.siteIntel.centroid[1]')),
             dbo.appraisal_num(json_value(g.gis, '$.searchPoint[1]'))),

    /* The US model records areaAcres; the Australian one records only `area`,
       in square metres. Reading just the first would leave every Australian
       site with a null area. */
    coalesce(dbo.appraisal_num(json_value(g.gis, '$.siteIntel.areaAcres')),
             dbo.appraisal_num(json_value(g.gis, '$.siteIntel.area')) / 4046.8564224),
    dbo.appraisal_num(json_value(pc.value, '$.inputs.acresGross')),
    dbo.appraisal_num(json_value(pc.value, '$.inputs.acresDed')),

    coalesce(nullif(json_value(g.gis, '$.siteIntel.location.label'), N''),
             nullif(json_value(g.gis, '$.searchLabel'), N''),
             json_value(pc.value, '$.loc')),
    json_value(g.gis, '$.siteIntel.location.suburb'),
    coalesce(json_value(g.gis, '$.siteIntel.location.state'),    json_value(g.gis, '$.jurisdiction.state')),
    coalesce(json_value(g.gis, '$.siteIntel.location.lga'),      json_value(g.gis, '$.jurisdiction.lga')),
    coalesce(json_value(g.gis, '$.siteIntel.location.postcode'), json_value(g.gis, '$.jurisdiction.postcode')),

    json_value(g.gis, '$.siteIntel.planning.zoneCode'),
    json_value(g.gis, '$.siteIntel.planning.zoneName'),
    json_value(g.gis, '$.siteIntel.planning.instrument'),
    json_value(g.gis, '$.siteIntel.planning.planningAuthority'),
    json_value(g.gis, '$.siteIntel.planning.sourceAgency'),
    json_value(g.gis, '$.siteIntel.planning.maxHeight'),
    json_value(g.gis, '$.siteIntel.planning.fsr'),
    json_value(g.gis, '$.siteIntel.planning.minLotSize'),

    dbo.appraisal_num(json_value(g.gis, '$.terrainStats.minElevation')),
    dbo.appraisal_num(json_value(g.gis, '$.terrainStats.meanElevation')),
    dbo.appraisal_num(json_value(g.gis, '$.terrainStats.maxElevation')),
    cast(dbo.appraisal_num(json_value(g.gis, '$.terrainStats.samples')) as int),

    json_query(g.gis, '$.siteIntel'),
    /* FOR JSON omits nulls, so an absent key does not become a null key */
    (select json_value(g.gis, '$.base')                    as base,
            dbo.appraisal_num(json_value(g.gis, '$.zoom')) as zoom,
            json_query(g.gis, '$.rings')                   as rings,
            json_query(g.gis, '$.layers')                  as layers,
            json_value(g.gis, '$.searchLabel')             as searchLabel,
            json_query(g.gis, '$.searchPoint')             as searchPoint,
            json_value(g.gis, '$.savedSiteId')             as savedSiteId,
            json_value(g.gis, '$.primaryId')               as primaryId
     for json path, without_array_wrapper)
  from dbo.appraisal a
  join @ids i on i.id = a.id
  cross apply openjson(a.envelope, '$.parcels') pc
  cross apply (values (coalesce(json_query(pc.value, '$.gis'), N'{}'))) g(gis)
  /* The saved site is whichever polygon the page itself would pick: savedSiteId,
     then primaryId, then any polygon flagged saved. Mirrors savedSite() in the
     page. OUTER APPLY, so a parcel with no polygon still gets its row - the
     inputs and the map view are worth having on their own. */
  outer apply (
    select top 1 f.value as feature
    from openjson(g.gis, '$.features.features') f
    where json_value(f.value, '$.geometry.type') in (N'Polygon', N'MultiPolygon')
      and (json_value(f.value, '$.id') = json_value(g.gis, '$.savedSiteId')
        or json_value(f.value, '$.id') = json_value(g.gis, '$.primaryId')
        or json_value(f.value, '$.properties.saved') in (N'true', N'1'))
    order by case when json_value(f.value, '$.id') = json_value(g.gis, '$.savedSiteId') then 0
                  when json_value(f.value, '$.id') = json_value(g.gis, '$.primaryId')   then 1
                  else 2 end) site
  where a.deleted_at is null;
end
GO

/* ═════════════════════════════════════════════════════════════════════════════
   4. Everything drawn on the map

   appraisal_site carries the one saved site polygon. This carries EVERYTHING
   drawn - radius rings, measured lines, dropped points, and any polygon that is
   not the saved site - because "the map data I added" is the whole
   FeatureCollection, not just the parcel boundary.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.appraisal_feature', N'U') is null
create table dbo.appraisal_feature (
  appraisal_id  uniqueidentifier not null,
  parcel_ord    int              not null,
  /* position within gis.features.features - the drawing order the page kept */
  feature_ord   int              not null,
  feature_id    nvarchar(100)    null,
  parcel_name   nvarchar(300)    not null,
  region        nvarchar(2)      null,

  kind          nvarchar(50)     null,   /* geometry type: Polygon, LineString, Point */
  name          nvarchar(300)    null,   /* properties.name - "Site polygon", "Measured line" */
  cadastre      nvarchar(200)    null,   /* the lot label, when the polygon came from a cadastre pick */
  is_saved_site bit              not null constraint df_appraisal_feature_saved default 0,
  is_draft      bit              not null constraint df_appraisal_feature_draft default 0,
  ring_km       float            null,   /* properties.km on a radius ring */
  vertices      int              null,

  geometry      nvarchar(max)    not null,  /* feed straight back to MapLibre */
  properties    nvarchar(max)    null,
  /* only for Point features; a polygon's centroid lives on appraisal_site */
  lng           float            null,
  lat           float            null,

  refreshed_at  datetime2(3) not null constraint df_appraisal_feature_refreshed default sysutcdatetime(),
  constraint pk_appraisal_feature primary key (appraisal_id, parcel_ord, feature_ord),
  constraint fk_appraisal_feature foreign key (appraisal_id) references dbo.appraisal(id) on delete cascade
);
GO

if not exists (select 1 from sys.indexes where name = N'ix_appraisal_feature_kind' and object_id = object_id(N'dbo.appraisal_feature'))
  create index ix_appraisal_feature_kind on dbo.appraisal_feature (region, kind);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_feature_saved' and object_id = object_id(N'dbo.appraisal_feature'))
  create index ix_appraisal_feature_saved on dbo.appraisal_feature (appraisal_id) where is_saved_site = 1;
GO

create or alter procedure dbo.appraisal_feature_refresh @ids dbo.AppraisalIdList readonly
as
begin
  set nocount on;

  delete f from dbo.appraisal_feature f join @ids i on i.id = f.appraisal_id;

  insert into dbo.appraisal_feature (
    appraisal_id, parcel_ord, feature_ord, feature_id, parcel_name, region,
    kind, name, cadastre, is_saved_site, is_draft, ring_km, vertices,
    geometry, properties, lng, lat)
  select
    a.id,
    cast(pc.[key] as int) + 1,
    cast(ft.[key] as int) + 1,
    json_value(ft.value, '$.id'),
    coalesce(nullif(json_value(pc.value, '$.name'), N''), N'Unnamed parcel'),
    a.region,
    json_value(ft.value, '$.geometry.type'),
    json_value(ft.value, '$.properties.name'),
    json_value(ft.value, '$.properties.cadastre'),
    /* the page's own test for the saved site, plus the flag it writes on it */
    cast(case when json_value(ft.value, '$.id') = json_value(g.gis, '$.savedSiteId')
                or json_value(ft.value, '$.properties.saved') in (N'true', N'1')
              then 1 else 0 end as bit),
    cast(case when json_value(ft.value, '$.properties.draft') in (N'true', N'1') then 1 else 0 end as bit),
    dbo.appraisal_num(json_value(ft.value, '$.properties.km')),
    dbo.appraisal_vertices(json_query(ft.value, '$.geometry')),
    json_query(ft.value, '$.geometry'),
    json_query(ft.value, '$.properties'),
    case when json_value(ft.value, '$.geometry.type') = N'Point'
         then dbo.appraisal_num(json_value(ft.value, '$.geometry.coordinates[0]')) end,
    case when json_value(ft.value, '$.geometry.type') = N'Point'
         then dbo.appraisal_num(json_value(ft.value, '$.geometry.coordinates[1]')) end
  from dbo.appraisal a
  join @ids i on i.id = a.id
  cross apply openjson(a.envelope, '$.parcels') pc
  cross apply (values (coalesce(json_query(pc.value, '$.gis'), N'{}'))) g(gis)
  cross apply openjson(g.gis, '$.features.features') ft
  where a.deleted_at is null
    /* a feature the page kept without a geometry has nothing to draw */
    and json_query(ft.value, '$.geometry') is not null;
end
GO

/* ═════════════════════════════════════════════════════════════════════════════
   5. Every data source used

   data_source is the registry; appraisal_source records, per parcel, which
   service answered each part of site intelligence, whether it answered, and
   what it said about its own currency.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.data_source', N'U') is null
create table dbo.data_source (
  source_key    nvarchar(400) not null,
  /* 'AU', 'US', or 'ALL' for a service both models call */
  region        nvarchar(3)   not null constraint df_data_source_region default N'ALL',
  /* which part of site intelligence it answers: planning, context, reverse,
     station, school, shopping, hospital, elevation, basemap, market */
  collector     nvarchar(50)  null,
  provider      nvarchar(400) not null,
  endpoint      nvarchar(1000) null,
  kind          nvarchar(20)  null,   /* api | tiles | file */
  official      bit           null,   /* a government planning source, as against OSM */
  notes         nvarchar(1000) null,
  first_seen_at datetime2(3)  not null constraint df_data_source_first default sysutcdatetime(),
  last_seen_at  datetime2(3)  not null constraint df_data_source_last  default sysutcdatetime(),
  constraint pk_data_source primary key (source_key)
);
GO

if not exists (select 1 from sys.indexes where name = N'ix_data_source_region' and object_id = object_id(N'dbo.data_source'))
  create index ix_data_source_region on dbo.data_source (region, collector);
GO

/* The services the pages call for every site, whatever the jurisdiction. Seeded
   because the envelope records that these ran, not what they were - unlike a
   planning source, which names itself in the response and registers itself
   below. Insert-if-absent, so re-running never duplicates and never overwrites
   a note somebody added. */
merge dbo.data_source as t
using (values
  (N'all-reverse-photon-komoot',          N'ALL', N'reverse',   N'Photon (Komoot) over OpenStreetMap', N'https://photon.komoot.io',                                N'api',   cast(0 as bit)),
  (N'all-proximity-photon-openstreetmap', N'ALL', N'proximity', N'Photon / OpenStreetMap',             N'https://photon.komoot.io',                                N'api',   cast(0 as bit)),
  (N'all-proximity-overpass',             N'ALL', N'proximity', N'Overpass API over OpenStreetMap',    N'https://overpass-api.de/api/interpreter',                 N'api',   cast(0 as bit)),
  (N'all-elevation-aws-terrain-tiles',    N'ALL', N'elevation', N'AWS Terrain Tiles (terrarium)',      N'https://s3.amazonaws.com/elevation-tiles-prod/terrarium', N'tiles', cast(0 as bit)),
  (N'all-basemap-openfreemap',            N'ALL', N'basemap',   N'OpenFreeMap / OpenStreetMap',        N'https://tiles.openfreemap.org',                           N'tiles', cast(0 as bit)),
  (N'all-basemap-esri-world-imagery',     N'ALL', N'basemap',   N'Esri World Imagery',                 N'https://server.arcgisonline.com',                         N'tiles', cast(0 as bit)),
  (N'au-context-abs',                     N'AU',  N'context',   N'Australian Bureau of Statistics',    N'https://geo.abs.gov.au',                                  N'api',   cast(1 as bit)),
  (N'au-market-cotality',                 N'AU',  N'market',    N'Cotality monthly market trends',     null,                                                       N'file',  cast(0 as bit)),
  (N'us-context-census-tigerweb',         N'US',  N'context',   N'U.S. Census Bureau TIGERweb',        N'https://tigerweb.geo.census.gov',                         N'api',   cast(1 as bit))
) as s(source_key, region, collector, provider, endpoint, kind, official)
on t.source_key = s.source_key
when not matched by target then
  insert (source_key, region, collector, provider, endpoint, kind, official)
  values (s.source_key, s.region, s.collector, s.provider, s.endpoint, s.kind, s.official);
GO

if object_id(N'dbo.appraisal_source', N'U') is null
create table dbo.appraisal_source (
  appraisal_id uniqueidentifier not null,
  parcel_ord   int              not null,
  collector    nvarchar(50)     not null,
  region       nvarchar(2)      null,
  parcel_name  nvarchar(300)    not null,

  /* What the envelope itself names. Null for the collectors that record only
     that they ran - the registry supplies the provider for those. */
  provider     nvarchar(400)    null,
  endpoint     nvarchar(1000)   null,
  /* The source's own words - "Official NSW Planning Portal live GIS" - or the
     page's ok / empty / error for a proximity search. */
  status       nvarchar(1000)   null,
  currency     nvarchar(400)    null,
  instrument   nvarchar(400)    null,
  ok           bit              null,
  error        nvarchar(1000)   null,
  /* siteIntel.updatedAt - when this parcel's intelligence was last resolved */
  resolved_at  datetime2(3)     null,
  source_key   nvarchar(400)    null,
  refreshed_at datetime2(3) not null constraint df_appraisal_source_refreshed default sysutcdatetime(),
  constraint pk_appraisal_source primary key (appraisal_id, parcel_ord, collector),
  constraint fk_appraisal_source foreign key (appraisal_id) references dbo.appraisal(id) on delete cascade
);
GO

if not exists (select 1 from sys.indexes where name = N'ix_appraisal_source_key' and object_id = object_id(N'dbo.appraisal_source'))
  create index ix_appraisal_source_key on dbo.appraisal_source (source_key);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_source_provider' and object_id = object_id(N'dbo.appraisal_source'))
  create index ix_appraisal_source_provider on dbo.appraisal_source (region, collector, provider);
GO

create or alter procedure dbo.appraisal_source_refresh @ids dbo.AppraisalIdList readonly
as
begin
  set nocount on;

  delete s from dbo.appraisal_source s join @ids i on i.id = s.appraisal_id;

  insert into dbo.appraisal_source (
    appraisal_id, parcel_ord, collector, region, parcel_name,
    provider, endpoint, status, currency, instrument, ok, error, resolved_at, source_key)
  select
    a.id,
    cast(pc.[key] as int) + 1,
    c.collector,
    a.region,
    coalesce(nullif(json_value(pc.value, '$.name'), N''), N'Unnamed parcel'),
    c.provider, c.endpoint, c.status, c.currency, c.instrument, c.ok, c.error,
    /* the page stamps Date.now(), milliseconds since the epoch */
    case when dbo.appraisal_num(json_value(si.si, '$.updatedAt')) is not null
         then dateadd(second, cast(dbo.appraisal_num(json_value(si.si, '$.updatedAt')) / 1000.0 as bigint), cast('1970-01-01' as datetime2(3))) end,
    case when c.provider is not null
         then dbo.appraisal_slug(coalesce(a.region, N'ALL') + N'-' + c.collector + N'-' + c.provider) end
  from dbo.appraisal a
  join @ids i on i.id = a.id
  cross apply openjson(a.envelope, '$.parcels') pc
  cross apply (values (coalesce(json_query(pc.value, '$.gis.siteIntel'), N'{}'))) si(si)
  cross apply (values
    /* the official planning query - the one collector that names its source */
    (N'planning',
     nullif(json_value(si.si, '$.planning.sourceAgency'), N''),
     nullif(json_value(si.si, '$.planning.sourceUrl'), N''),
     nullif(json_value(si.si, '$.planning.sourceStatus'), N''),
     nullif(json_value(si.si, '$.planning.dataCurrency'), N''),
     nullif(json_value(si.si, '$.planning.instrument'), N''),
     dbo.appraisal_bool(json_value(si.si, '$.availability.planning')),
     cast(null as nvarchar(1000))),
    (N'context',  cast(null as nvarchar(400)), cast(null as nvarchar(1000)), cast(null as nvarchar(1000)),
     cast(null as nvarchar(400)), cast(null as nvarchar(400)),
     dbo.appraisal_bool(json_value(si.si, '$.availability.context')), cast(null as nvarchar(1000))),
    (N'reverse',  cast(null as nvarchar(400)), cast(null as nvarchar(1000)), cast(null as nvarchar(1000)),
     cast(null as nvarchar(400)), cast(null as nvarchar(400)),
     dbo.appraisal_bool(json_value(si.si, '$.availability.reverse')), cast(null as nvarchar(1000))),
    (N'station',  nullif(json_value(si.si, '$.proximity.sources.station'), N''), cast(null as nvarchar(1000)),
     nullif(json_value(si.si, '$.proximity.status.station'), N''), cast(null as nvarchar(400)), cast(null as nvarchar(400)),
     case when json_value(si.si, '$.proximity.status.station') is null then null
          when json_value(si.si, '$.proximity.status.station') = N'ok' then cast(1 as bit) else cast(0 as bit) end,
     nullif(json_value(si.si, '$.proximity.errors.station'), N'')),
    (N'school',   nullif(json_value(si.si, '$.proximity.sources.school'), N''), cast(null as nvarchar(1000)),
     nullif(json_value(si.si, '$.proximity.status.school'), N''), cast(null as nvarchar(400)), cast(null as nvarchar(400)),
     case when json_value(si.si, '$.proximity.status.school') is null then null
          when json_value(si.si, '$.proximity.status.school') = N'ok' then cast(1 as bit) else cast(0 as bit) end,
     nullif(json_value(si.si, '$.proximity.errors.school'), N'')),
    (N'shopping', nullif(json_value(si.si, '$.proximity.sources.shopping'), N''), cast(null as nvarchar(1000)),
     nullif(json_value(si.si, '$.proximity.status.shopping'), N''), cast(null as nvarchar(400)), cast(null as nvarchar(400)),
     case when json_value(si.si, '$.proximity.status.shopping') is null then null
          when json_value(si.si, '$.proximity.status.shopping') = N'ok' then cast(1 as bit) else cast(0 as bit) end,
     nullif(json_value(si.si, '$.proximity.errors.shopping'), N'')),
    (N'hospital', nullif(json_value(si.si, '$.proximity.sources.hospital'), N''), cast(null as nvarchar(1000)),
     nullif(json_value(si.si, '$.proximity.status.hospital'), N''), cast(null as nvarchar(400)), cast(null as nvarchar(400)),
     case when json_value(si.si, '$.proximity.status.hospital') is null then null
          when json_value(si.si, '$.proximity.status.hospital') = N'ok' then cast(1 as bit) else cast(0 as bit) end,
     nullif(json_value(si.si, '$.proximity.errors.hospital'), N''))
  ) as c(collector, provider, endpoint, status, currency, instrument, ok, error)
  where a.deleted_at is null
    /* a parcel whose site intelligence has never run contributes nothing */
    and (c.provider is not null or c.status is not null or c.ok is not null);

  /* Register whatever named itself. The jurisdiction registries in the pages run
     to a hundred-odd agencies between them; seeding those by hand would be a
     copy that drifts, so a source enters the registry the first time it actually
     answers for a site. */
  with named as (
    select s.source_key, s.region, s.collector, s.provider, s.endpoint,
           row_number() over (partition by s.source_key order by s.parcel_ord) as rn
    from dbo.appraisal_source s
    join @ids i on i.id = s.appraisal_id
    where s.source_key is not null)
  merge dbo.data_source as t
  using (select source_key, region, collector, provider, endpoint from named where rn = 1) as s
  on t.source_key = s.source_key
  when matched then
    update set last_seen_at = sysutcdatetime(),
               endpoint     = coalesce(t.endpoint, s.endpoint)
  when not matched by target then
    insert (source_key, region, collector, provider, endpoint, kind, official)
    values (s.source_key, coalesce(s.region, N'ALL'), s.collector, s.provider, s.endpoint,
            case when s.endpoint like N'http%' then N'api' end,
            case when s.collector = N'planning' then cast(1 as bit) end);
end
GO

/* ═════════════════════════════════════════════════════════════════════════════
   6. Dataset releases - the sources that ship inside the page

   Not derived, because the envelope does not record them: the Cotality market
   series is generated into the Australian page itself, so which release a number
   came from is a fact about the deployed build rather than about any one
   appraisal. Written by whoever regenerates the block.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.dataset_release', N'U') is null
create table dbo.dataset_release (
  source_key    nvarchar(400) not null,
  release_label nvarchar(100) not null,
  region        nvarchar(3)   null,
  period_start  date          null,
  period_end    date          null,
  embedded_in   nvarchar(400) null,   /* the file and script block that carries it */
  row_count     int           null,
  generated_at  datetime2(3)  null,
  generator     nvarchar(400) null,
  notes         nvarchar(1000) null,
  recorded_at   datetime2(3) not null constraint df_dataset_release_recorded default sysutcdatetime(),
  constraint pk_dataset_release primary key (source_key, release_label),
  constraint fk_dataset_release foreign key (source_key) references dbo.data_source(source_key) on delete cascade
);
GO

if not exists (select 1 from dbo.dataset_release where source_key = N'au-market-cotality' and release_label = N'2026-02')
  insert into dbo.dataset_release (source_key, release_label, region, period_start, period_end, embedded_in, generator, notes)
  values (N'au-market-cotality', N'2026-02', N'AU', '2025-04-01', '2026-02-28',
          N'Australia_Land_Feasibility_.html#sales-market-data',
          N'node pipeline/cotality.mjs && node pipeline/inject.mjs',
          N'Eleven months of Cotality sales counts and values by SA2 and LGA, inlined because the page also opens from file://.');
GO

/* ═════════════════════════════════════════════════════════════════════════════
   7. One trigger keeps all three projections true

   Fires on the envelope changing and on a soft delete or undelete - the refresh
   drops every row for a deleted appraisal, so the site list needs no deleted_at
   filter of its own. A SQL Server trigger fires once per statement, so the ids
   go in as a set.
   ════════════════════════════════════════════════════════════════════════════ */

create or alter procedure dbo.appraisal_projection_refresh @ids dbo.AppraisalIdList readonly
as
begin
  set nocount on;
  exec dbo.appraisal_site_refresh    @ids;
  exec dbo.appraisal_feature_refresh @ids;
  exec dbo.appraisal_source_refresh  @ids;
end
GO

create or alter trigger dbo.appraisal_projection_sync on dbo.appraisal
after insert, update
as
begin
  set nocount on;
  if not (update(envelope) or update(deleted_at)) return;

  declare @ids dbo.AppraisalIdList;
  insert into @ids (id) select distinct id from inserted;
  exec dbo.appraisal_projection_refresh @ids;
end
GO

/* ═════════════════════════════════════════════════════════════════════════════
   8. Views - query these, not the tables
   ════════════════════════════════════════════════════════════════════════════ */

/* Every input the page holds, one row per key, without a column per lever -
   545 distinct keys across the twelve Australian projects today, and no DDL
   when the next one is added. */
create or alter view dbo.appraisal_input as
select a.id as appraisal_id, a.name as appraisal_name, a.region, a.updated_at, a.updated_by,
       cast(pc.[key] as int) + 1 as parcel_ord,
       coalesce(nullif(json_value(pc.value, '$.name'), N''), N'Unnamed parcel') as parcel_name,
       kv.[key] as input_key,
       kv.value as input_value,
       dbo.appraisal_num(kv.value) as input_number
from dbo.appraisal a
cross apply openjson(a.envelope, '$.parcels') pc
cross apply openjson(coalesce(json_query(pc.value, '$.inputs'), N'{}')) kv
where a.deleted_at is null;
GO

/* One row per parcel for the map: the geometry, where it is, what it is zoned
   and what the appraisal makes of it. */
create or alter view dbo.saved_site as
select s.appraisal_id, a.name as appraisal_name, a.updated_at, a.updated_by, s.region,
       s.parcel_ord, s.parcel_name, s.address, s.suburb, s.state_code, s.lga, s.postcode,
       s.centroid_lng, s.centroid_lat, s.geometry,
       s.area_acres, s.acres_gross, s.acres_deducted,
       s.zone_code, s.zone_name, s.planning_instrument,
       s.elev_min, s.elev_mean, s.elev_max,
       s.map_view
from dbo.appraisal_site s
join dbo.appraisal a on a.id = s.appraisal_id and a.deleted_at is null;
GO

create or alter view dbo.saved_map_feature as
select f.appraisal_id, a.name as appraisal_name, a.updated_at, a.updated_by, f.region,
       f.parcel_ord, f.parcel_name, f.feature_ord, f.feature_id,
       f.kind, f.name as feature_name, f.cadastre,
       f.is_saved_site, f.is_draft, f.ring_km, f.vertices, f.lng, f.lat,
       f.geometry, f.properties
from dbo.appraisal_feature f
join dbo.appraisal a on a.id = f.appraisal_id and a.deleted_at is null;
GO

/* One row per source per parcel, with the provider filled in from the registry
   for the collectors the envelope does not name. */
create or alter view dbo.data_source_used as
select s.appraisal_id, a.name as appraisal_name, s.region, s.parcel_ord, s.parcel_name,
       s.collector,
       coalesce(s.provider, d.provider) as provider,
       coalesce(s.endpoint, d.endpoint) as endpoint,
       s.status, s.currency, s.instrument, s.ok, s.error, s.resolved_at
from dbo.appraisal_source s
join dbo.appraisal a on a.id = s.appraisal_id and a.deleted_at is null
outer apply (
  select top 1 d.provider, d.endpoint
  from dbo.data_source d
  where (s.source_key is not null and d.source_key = s.source_key)
     or (s.source_key is null and d.collector = s.collector
         and d.region in (coalesce(s.region, N'ALL'), N'ALL'))
  order by case when d.region = s.region then 0 else 1 end) d;
GO

/* ═════════════════════════════════════════════════════════════════════════════
   9. Backfill - for a database that already holds appraisals. Idempotent, and a
      no-op on a fresh one, so this file stays safe to run repeatedly.
   ════════════════════════════════════════════════════════════════════════════ */

declare @backfill dbo.AppraisalIdList;
insert into @backfill (id)
select a.id from dbo.appraisal a
where a.deleted_at is null
  and (not exists (select 1 from dbo.appraisal_site    s where s.appraisal_id = a.id)
   and not exists (select 1 from dbo.appraisal_feature f where f.appraisal_id = a.id)
   and not exists (select 1 from dbo.appraisal_source  r where r.appraisal_id = a.id));
if exists (select 1 from @backfill) exec dbo.appraisal_projection_refresh @backfill;
GO
