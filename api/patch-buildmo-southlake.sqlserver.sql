/* One-time data fix: Southlake - Homebuilder Co's build/closing duration was
   saved as 10 months. The reference workbook ("south lake cashflow mom 620
   3units month.xlsx", sheet "Homebuilde Projectwise cashflow", cell F91:
   =($D66*1.5/57)/12) spreads each unit's construction cost over 12 months,
   not 10 - the total build cost is unchanged either way (buildpsf x BUA),
   only the monthly timing shifts.

   seed-us.sqlserver.sql already carries the corrected value, but its insert
   is guarded by IF NOT EXISTS keyed on id, so re-running it is a no-op
   against a database this row already exists in - it will not touch what is
   already there. This file is what actually fixes it.

   Run this ONCE, any time after seed-us.sqlserver.sql has been run at least
   once. Safe to run again afterwards, or on a database that never had this
   row at all: the UPDATE is guarded on the stored value actually differing
   from the correct one, so a second run touches nothing.

   Deliberately does not insert an appraisal_version row: this corrects an
   input value entered before the reference workbook was checked against,
   the same class of fix as patch-firbfee.sqlserver.sql, not a save made
   through the app itself. */

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[1].inputs.buildmo', cast(12 as int)),
    updated_by = N'patch-buildmo-southlake.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'c0d638fc-912b-58d7-a5b2-2976bc68e138'
  and json_value(envelope, '$.parcels[1].id') = 'p2njs7e'
  and try_cast(json_value(envelope, '$.parcels[1].inputs.buildmo') as int) <> 12;

/* Verify: expect one row back showing buildmo = 12. */
select id, json_value(envelope, '$.name') as name,
       json_value(envelope, '$.parcels[1].name') as parcel_name,
       json_value(envelope, '$.parcels[1].inputs.buildmo') as stored_buildmo
from dbo.appraisal
where id = 'c0d638fc-912b-58d7-a5b2-2976bc68e138';
