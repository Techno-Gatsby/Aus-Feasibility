/* Who the web app connects as. Run this INSIDE sqldb-mdo-landfeasibility-uat
   (not master), as a user with permission to create users - the SQL admin login
   or the Entra admin on sql-mdo-landfeasibility-uat-01.

   Two options. Take the first unless something blocks it.
*/

/* ─────────────────────────────────────────────────────────────────────────────
   OPTION A - managed identity (recommended: no password exists anywhere)

   Prerequisites, both in the portal:
     1. sql-mdo-landfeasibility-uat-01 -> Settings -> Microsoft Entra ID ->
        set an Entra admin (a group is better than a person).
     2. app-mdo-fe-landfeasibility-uat -> Settings -> Identity ->
        System assigned -> On. Note the object (principal) ID.

   Then run this while signed in to the database as that Entra admin. The user
   name must be the app's name exactly - that is how Entra resolves it.
   ──────────────────────────────────────────────────────────────────────────── */

if not exists (select 1 from sys.database_principals where name = N'app-mdo-fe-landfeasibility-uat')
  create user [app-mdo-fe-landfeasibility-uat] from external provider;
GO

alter role db_datareader add member [app-mdo-fe-landfeasibility-uat];
alter role db_datawriter add member [app-mdo-fe-landfeasibility-uat];
GO

/* The routes call the refresh procedures only through the trigger, but a manual
   rebuild and the schema's own boot-time apply both need EXECUTE. */
grant execute on schema::dbo to [app-mdo-fe-landfeasibility-uat];
GO

/* ─────────────────────────────────────────────────────────────────────────────
   OPTION B - a contained SQL login, if managed identity is not available

   The password then has to live somewhere. Put it in Key Vault and reference it
   from the app setting - never as a literal in App Service, and never in git.
   ──────────────────────────────────────────────────────────────────────────── */

-- if not exists (select 1 from sys.database_principals where name = N'landfeasibility_app')
--   create user landfeasibility_app with password = '<generate 32+ chars, store in Key Vault>';
-- alter role db_datareader add member landfeasibility_app;
-- alter role db_datawriter add member landfeasibility_app;
-- grant execute on schema::dbo to landfeasibility_app;

/* ─────────────────────────────────────────────────────────────────────────────
   Neither option grants DDL. The schema is applied by whoever runs
   schema.sqlserver.sql - a person, once - rather than by the app on boot, which
   is a deliberate difference from the PostgreSQL version: an application login
   that can CREATE TABLE can also DROP one.

   If you would rather keep the boot-time apply, add:
     alter role db_ddladmin add member [app-mdo-fe-landfeasibility-uat];
   and accept that trade.
   ──────────────────────────────────────────────────────────────────────────── */

/* Check what the app can actually do, after granting: */
select dp.name as principal, dp.type_desc, r.name as role_membership
from sys.database_principals dp
left join sys.database_role_members m on m.member_principal_id = dp.principal_id
left join sys.database_principals r on r.principal_id = m.role_principal_id
where dp.name in (N'app-mdo-fe-landfeasibility-uat', N'landfeasibility_app');
