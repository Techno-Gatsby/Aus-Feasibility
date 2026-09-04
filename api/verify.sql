/* Sanity checks to run after schema.sql (and, on the Australian side, after
   seed-au.sql). Read-only - nothing here changes anything.

   psql "$PGCONN" -f api/verify.sql
*/

\echo '== 1. objects that should exist =='
select table_name,
       case when table_type = 'VIEW' then 'view' else 'table' end as kind
from information_schema.tables
where table_schema = 'public'
  and table_name in ('appraisal','appraisal_version','appraisal_site','appraisal_feature',
                     'appraisal_source','data_source','dataset_release',
                     'saved_site','saved_map_feature','data_source_used','appraisal_input')
order by 2, 1;
/* expect 7 tables and 4 views. Anything missing means schema.sql did not finish. */

\echo '== 2. the trigger that keeps the projections honest =='
select tgname, tgenabled from pg_trigger where tgrelid = 'appraisal'::regclass and not tgisinternal;
/* expect appraisal_site_sync_trg, tgenabled = O */

\echo '== 3. what is stored, by region =='
select region, count(*) as appraisals, min(created_at)::date as first_saved, max(updated_at) as last_saved
from appraisal where deleted_at is null group by region order by region;
/* expect AU = 12 once seed-au.sql has run; US grows as people save */

\echo '== 4. the projections, which are derived and should never be empty for a mapped site =='
select (select count(*) from appraisal_site)    as sites,
       (select count(*) from appraisal_feature) as drawn_features,
       (select count(*) from appraisal_source)  as source_rows,
       (select count(*) from data_source)       as registered_sources;
/* The twelve seeded projects carry no map data, so sites/features/source rows
   stay 0 until somebody saves an appraisal with a drawn site. registered_sources
   should be 9 immediately - the seeded always-run services. */

\echo '== 5. inputs are queryable without a column per lever =='
select region, count(distinct input_key) as distinct_input_keys, count(*) as input_values
from appraisal_input group by region order by region;

\echo '== 6. sources used, once a site has been analysed =='
select region, collector, provider, count(*) as parcels, max(resolved_at) as last_resolved
from data_source_used group by 1,2,3 order by 1,2,3;
