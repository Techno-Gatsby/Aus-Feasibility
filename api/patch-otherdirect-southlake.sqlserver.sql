/* One-time data fix: Southlake - Landowner Co's "Other Direct Cost" was saved
   as $3,750,000 (labelled "demolition and site clearance"). Per the reference
   workbooks, this line should be zero for now.

   seed-us.sqlserver.sql already carries the corrected value, but its insert
   is guarded by IF NOT EXISTS keyed on id, so re-running it is a no-op
   against a database this row already exists in - it will not touch what is
   already there. This file is what actually fixes it.

   Run this ONCE, any time after seed-us.sqlserver.sql has been run at least
   once. Safe to run again afterwards, or on a database that never had this
   row at all: the UPDATE is guarded on the stored value actually differing
   from the correct one, so a second run touches nothing. */

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.otherdirect', cast(0 as int)),
    updated_by = N'patch-otherdirect-southlake.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'c0d638fc-912b-58d7-a5b2-2976bc68e138'
  and json_value(envelope, '$.parcels[0].id') = 'pltmxdz'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.otherdirect') as int) <> 0;

/* Verify: expect one row back showing otherdirect = 0. */
select id, json_value(envelope, '$.name') as name,
       json_value(envelope, '$.parcels[0].name') as parcel_name,
       json_value(envelope, '$.parcels[0].inputs.otherdirect') as stored_otherdirect
from dbo.appraisal
where id = 'c0d638fc-912b-58d7-a5b2-2976bc68e138';
