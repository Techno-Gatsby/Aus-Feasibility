/* One-time data fix: every one of the 17 Australian projects carried a
   copy-pasted firbfee placeholder rather than an actually-calculated one -
   several shared the identical figure despite having different land prices,
   which is how the bug was found. firbfee is now auto-calculated (as a
   reference badge, still an editable field) from the FIRB Schedule of Fees
   v8 (Treasury, 1 July 2026), Table 1: Notifiable actions against the
   Commercial land/tenements/businesses/entities consideration band - see
   AU_FIRB_TABLE and auFirbFeeRef() in Australia_Land_Feasibility_.html.

   seed-au.sqlserver.sql already carries the corrected values, but its
   inserts are guarded by IF NOT EXISTS keyed on id, so re-running it is a
   no-op against a database these 17 rows already exist in - it will not
   touch what is already there. This file is what actually fixes those rows.

   Run this ONCE, any time after seed-au.sqlserver.sql has been run at least
   once. Safe to run again afterwards, or on a database that never had these
   rows at all: every UPDATE is guarded on the stored value actually
   differing from the correct one, so a second run touches nothing.

   Deliberately does not insert an appraisal_version row: this corrects data
   entered before the calculation existed, the same class of fix as a
   dataset_release row in schema.sqlserver.sql, not a save made through the
   app itself. appraisal_site/appraisal_feature/appraisal_source still
   re-derive correctly - the trigger fires on any envelope update regardless
   of which column inside it changed.
*/

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(93900 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'a8b7c8ea-9869-5236-9a20-1914f3cf211b'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 93900; -- 400 Glenmore Road Paddington - 4:1 FSR

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(62600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'd4411837-9a4b-555d-b4a7-b4be3851cfed'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 62600; -- 400 Glenmore Road Paddington - 2.86:1 FSR

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(62600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = '27e59676-c3bf-5d5c-8dbf-abc8d09a7e37'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 62600; -- Drummoyne, Sydney

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(93900 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = '11945347-2f32-5270-ba5f-99185a9b5139'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 93900; -- Drummoyne Uplifted

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(31300 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = '7a3ec326-177e-54cb-b684-8db671c4b881'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 31300; -- 70-72 Oxlade Drive, Brisbane

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(15600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'cc60e110-af3f-5b6b-aacf-8a3f00a83de8'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 15600; -- 70-72 Oxlade Drive, Brisbane - original

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(31300 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'f58e8567-1fd7-5a86-93c4-0c2e796c0f06'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 31300; -- SP Boulevard, Gold Coast

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(31300 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = '81ce4c08-30c1-53ed-bd1f-63af74a7e29a'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 31300; -- 421 Brunswick Street, Brisbane

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(31300 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'b2a2da53-53cd-5c34-9f8d-67fb595c39b8'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 31300; -- 16 Terry Road, Box Hill

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(15600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'fb9072f4-c751-53e8-874c-21f42ac9bfd7'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 15600; -- Menin Road, NSW

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(15600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'a7539b88-33d3-5440-845b-94426cd48ba6'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 15600; -- Beckett Road, Queensland

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(15600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'ca84c370-2fa8-575e-a138-d2b36072d17b'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 15600; -- Hendra, Brisbane - Lots

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(62600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'e79a608e-03e1-417f-b1d3-10819b0242a5'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 62600; -- Project 4, Sydney (Apartments)

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(15600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'ab0d348d-3a31-450c-bc47-f30e7a39ea93'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 15600; -- Project 5, Queensland (Lots)

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(62600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = '887259c1-11f1-414a-bf4c-dd1ee98f8151'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 62600; -- Project 6, Sydney (Apartments)

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(31300 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'e03056eb-be9a-4025-8c3d-3189cd594c12'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 31300; -- Project 7, Gold Coast (Apartments)

update dbo.appraisal
set envelope = json_modify(envelope, '$.parcels[0].inputs.firbfee', cast(62600 as int)),
    updated_by = N'patch-firbfee.sqlserver.sql', updated_at = sysutcdatetime()
where id = 'c3e78ebe-628c-451a-865a-29a186aab8f0'
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) <> 62600; -- Project 9, Sydney (Apartments)

/* Verify: expect zero rows back - every stored firbfee should now match
   what auFirbFeeRef() would show as the "calc:" badge for the same parcel. */
select id, json_value(envelope, '$.name') as name,
       json_value(envelope, '$.parcels[0].inputs.firbfee') as stored_firbfee
from dbo.appraisal
where region = 'AU' and deleted_at is null
  and id in (
    'a8b7c8ea-9869-5236-9a20-1914f3cf211b','d4411837-9a4b-555d-b4a7-b4be3851cfed',
    '27e59676-c3bf-5d5c-8dbf-abc8d09a7e37','11945347-2f32-5270-ba5f-99185a9b5139',
    '7a3ec326-177e-54cb-b684-8db671c4b881','cc60e110-af3f-5b6b-aacf-8a3f00a83de8',
    'f58e8567-1fd7-5a86-93c4-0c2e796c0f06','81ce4c08-30c1-53ed-bd1f-63af74a7e29a',
    'b2a2da53-53cd-5c34-9f8d-67fb595c39b8','fb9072f4-c751-53e8-874c-21f42ac9bfd7',
    'a7539b88-33d3-5440-845b-94426cd48ba6','ca84c370-2fa8-575e-a138-d2b36072d17b',
    'e79a608e-03e1-417f-b1d3-10819b0242a5','ab0d348d-3a31-450c-bc47-f30e7a39ea93',
    '887259c1-11f1-414a-bf4c-dd1ee98f8151','e03056eb-be9a-4025-8c3d-3189cd594c12',
    'c3e78ebe-628c-451a-865a-29a186aab8f0')
  and try_cast(json_value(envelope, '$.parcels[0].inputs.firbfee') as bigint) not in
    (93900,62600,62600,93900,31300,15600,31300,31300,31300,15600,15600,15600,62600,15600,62600,31300,62600);
