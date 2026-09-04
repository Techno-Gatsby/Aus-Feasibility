/* Sanity checks after schema.sqlserver.sql (and, for Australia, after
   seed-au.sqlserver.sql). Read-only - nothing here changes anything. */

/* 1. objects that should exist: 7 tables, 4 views, 1 type, 4 procedures, 1 trigger */
select 'tables'     as what, count(*) as found, 7 as expected from sys.tables  where name in ('appraisal','appraisal_version','appraisal_site','appraisal_feature','appraisal_source','data_source','dataset_release')
union all select 'views',      count(*), 4 from sys.views  where name in ('saved_site','saved_map_feature','data_source_used','appraisal_input')
union all select 'procedures', count(*), 4 from sys.procedures where name in ('appraisal_site_refresh','appraisal_feature_refresh','appraisal_source_refresh','appraisal_projection_refresh')
union all select 'functions',  count(*), 4 from sys.objects where type in ('FN','IF','TF') and name in ('appraisal_num','appraisal_bool','appraisal_slug','appraisal_vertices')
union all select 'triggers',   count(*), 1 from sys.triggers where name = 'appraisal_projection_sync'
union all select 'table type', count(*), 1 from sys.table_types where name = 'AppraisalIdList';

/* 2. the trigger is enabled - a disabled trigger would let the projections rot
      silently, which is the one failure this design cannot detect on its own */
select name, is_disabled from sys.triggers where name = 'appraisal_projection_sync';

/* 3. what is stored, by region. Expect AU = 12 once the seed has run. */
select region, count(*) as appraisals, min(created_at) as first_saved, max(updated_at) as last_saved
from dbo.appraisal where deleted_at is null group by region;

/* 4. the projections. The twelve seeded projects carry no map data, so sites,
      features and source rows stay 0 until somebody saves an analysed site;
      registered_sources should be 9 immediately - the seeded services. */
select (select count(*) from dbo.appraisal_site)    as sites,
       (select count(*) from dbo.appraisal_feature) as drawn_features,
       (select count(*) from dbo.appraisal_source)  as source_rows,
       (select count(*) from dbo.data_source)       as registered_sources;

/* 5. inputs are queryable without a column per lever */
select region, count(distinct input_key) as distinct_input_keys, count(*) as input_values
from dbo.appraisal_input group by region;

/* 6. every stored envelope is valid JSON and carries the region it claims */
select id, name,
       isjson(envelope) as json_ok,
       json_value(envelope, '$.region') as envelope_region,
       region as row_region
from dbo.appraisal
where deleted_at is null
  and (isjson(envelope) <> 1 or json_value(envelope, '$.region') <> region);
/* expect zero rows */

/* 7. sources used, once a site has been analysed */
select region, collector, provider, count(*) as parcels, max(resolved_at) as last_resolved
from dbo.data_source_used group by region, collector, provider order by region, collector, provider;

/* 8. prove the trigger fires, without leaving anything behind */
begin transaction;
  insert into dbo.appraisal (name, region, envelope, envelope_v, created_by, updated_by)
  values (N'trigger smoke test', N'AU',
          N'{"v":7,"region":"AU","active":0,"parcels":[{"id":"p1","name":"Smoke","inputs":{"acresGross":"1"},
             "gis":{"savedSiteId":"f1","features":{"type":"FeatureCollection","features":[
               {"id":"f1","properties":{"saved":true,"name":"Site polygon"},
                "geometry":{"type":"Polygon","coordinates":[[[151,-33],[151.1,-33],[151.1,-33.1],[151,-33.1],[151,-33]]]}}]},
              "siteIntel":{"updatedAt":1756900000000,"area":4046.86,"centroid":[151.05,-33.05],
                "planning":{"zoneCode":"R1","sourceAgency":"Smoke test agency"},
                "availability":{"planning":true,"context":true,"reverse":true},
                "proximity":{"sources":{"station":"Photon / OpenStreetMap"},"status":{"station":"ok"}}}}}]}',
          7, N'verify@local', N'verify@local');
  select (select count(*) from dbo.appraisal_site    where parcel_name = N'Smoke') as site_rows,
         (select count(*) from dbo.appraisal_feature where parcel_name = N'Smoke') as feature_rows,
         (select count(*) from dbo.appraisal_source  where parcel_name = N'Smoke') as source_rows;
  /* expect 1, 1, 4 */
rollback transaction;
