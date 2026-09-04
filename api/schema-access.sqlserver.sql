/* Access control - Azure SQL Database. Companion to schema.sqlserver.sql, same
   target (sqldb-mdo-landfeasibility-uat), same conventions, run the same way:
   by hand, in SSMS / Azure Data Studio / sqlcmd, after schema.sqlserver.sql.

   Everything in this file is AUTHORITATIVE DATA, not a trigger-derived
   projection - unlike appraisal_site and its neighbours in schema.sqlserver.sql,
   nothing here is rebuilt from another table. A row here is the fact itself:
   who this person is, what they were granted, and by whom.

   Every statement is idempotent, so re-running this is never a migration event.
   The GO separators are batch terminators, not SQL; a driver executing this
   file programmatically must split on them.
*/

/* ═════════════════════════════════════════════════════════════════════════════
   1. Who signs in, and what they can see

   One row per person, keyed on their sign-in email. There is no external
   identity provider - password_hash below is this app's own credential,
   verified by api/access.mjs against exactly this table. Everything in this
   section is worthless as a security boundary until SESSION_SECRET is set
   (signs the session cookie) and the bootstrap admin has run
   POST /api/bootstrap-admin - see api/README.md.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.app_user', N'U') is null
create table dbo.app_user (
  user_id       uniqueidentifier not null constraint df_app_user_id default newid(),
  /* the sign-in email, lower-cased at write time so a lookup never depends on
     how someone happens to capitalise it. Not an Entra UPN - there is no
     Microsoft identity provider here; this is this app's own login. */
  upn           nvarchar(200)    not null,
  /* unused now that sign-in is internal rather than Entra, kept nullable
     rather than dropped - a later Entra integration would populate it, not
     need a new column */
  entra_oid     nvarchar(100)    null,
  display_name  nvarchar(200)    null,
  /* salt:hash, both hex, from node:crypto scrypt - see hashPassword in
     access.mjs. Null means the admin has not set this person's password yet
     (or, for the bootstrap admin, has not completed /api/bootstrap-admin) -
     login refuses a null hash rather than treating it as "no password". */
  password_hash nvarchar(300)    null,
  /* set on account creation and on an admin-triggered reset, so a temporary
     password can be required to be changed before anything else works */
  must_change_password bit       not null constraint df_app_user_mustchange default 0,
  is_admin      bit              not null constraint df_app_user_admin default 0,
  disabled_at   datetime2(3)     null,
  first_seen_at datetime2(3)     not null constraint df_app_user_first default sysutcdatetime(),
  last_seen_at  datetime2(3)     not null constraint df_app_user_last  default sysutcdatetime(),
  created_by    nvarchar(200)    not null,
  updated_by    nvarchar(200)    not null,
  updated_at    datetime2(3)     not null constraint df_app_user_updated default sysutcdatetime(),
  constraint pk_app_user primary key (user_id),
  constraint uq_app_user_upn unique (upn)
);
GO

/* Backfill for a database created before password_hash/must_change_password
   existed - ALTER TABLE has no IF NOT EXISTS, so this is the T-SQL idiom for
   the same idempotence every other statement in this file already has. */
if not exists (select 1 from sys.columns where object_id = object_id(N'dbo.app_user') and name = N'password_hash')
  alter table dbo.app_user add password_hash nvarchar(300) null;
if not exists (select 1 from sys.columns where object_id = object_id(N'dbo.app_user') and name = N'must_change_password')
  alter table dbo.app_user add must_change_password bit not null constraint df_app_user_mustchange default 0;
GO

if not exists (select 1 from sys.indexes where name = N'ix_app_user_entra_oid' and object_id = object_id(N'dbo.app_user'))
  create index ix_app_user_entra_oid on dbo.app_user (entra_oid) where entra_oid is not null;
GO

/* One row per (user, region) rather than two bit columns on app_user - a grant
   carries who made it and when, which a column cannot, and a third region
   later (or a region-specific note) needs a row, not a schema change. */
if object_id(N'dbo.user_region_access', N'U') is null
create table dbo.user_region_access (
  user_id     uniqueidentifier not null,
  region      nvarchar(2)      not null,
  granted_by  nvarchar(200)    not null,
  granted_at  datetime2(3)     not null constraint df_user_region_access_granted default sysutcdatetime(),
  constraint pk_user_region_access primary key (user_id, region),
  constraint fk_user_region_access foreign key (user_id) references dbo.app_user(user_id) on delete cascade,
  /* the same two-region check the appraisal table already enforces - kept in
     lockstep deliberately, not shared, since these are independent facts that
     happen to share a domain */
  constraint ck_user_region_access_region check (region in (N'US', N'AU'))
);
GO

/* ═════════════════════════════════════════════════════════════════════════════
   2. What a new person asked for

   A signed-in person with no grant lands on the request page rather than a
   blank one; this is what that page writes to, and what the admin panel reads.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.access_request', N'U') is null
create table dbo.access_request (
  request_id    uniqueidentifier not null constraint df_access_request_id default newid(),
  user_id       uniqueidentifier not null,
  region        nvarchar(2)      not null,
  message       nvarchar(500)    null,
  status        nvarchar(20)     not null constraint df_access_request_status default N'pending',
  requested_at  datetime2(3)     not null constraint df_access_request_requested default sysutcdatetime(),
  decided_by    nvarchar(200)    null,
  decided_at    datetime2(3)     null,
  constraint pk_access_request primary key (request_id),
  constraint fk_access_request foreign key (user_id) references dbo.app_user(user_id) on delete cascade,
  constraint ck_access_request_region check (region in (N'US', N'AU')),
  constraint ck_access_request_status check (status in (N'pending', N'approved', N'declined'))
);
GO

/* One pending ask per person per region - so clicking "request" twice queues
   nothing, it just re-shows the ask that is already sitting with an admin. */
if not exists (select 1 from sys.indexes where name = N'ix_access_request_pending' and object_id = object_id(N'dbo.access_request'))
  create unique index ix_access_request_pending on dbo.access_request (user_id, region) where status = N'pending';
GO

/* ═════════════════════════════════════════════════════════════════════════════
   3. Sessions - derived, not declared

   No cookie of this app's own exists to key a session on; Easy Auth already
   owns the sign-in cookie, and a second token here would only be key
   management with no benefit. So a session is a run of activity: a person's
   first gated request after a period of inactivity opens a row, and later
   requests within that window just touch last_seen_at. Nothing ever sets
   ended_at from inside a request - the admin view treats a gap past the idle
   window as the session having ended, computed at read time, in
   dbo.user_session_ended below.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.user_session', N'U') is null
create table dbo.user_session (
  session_id     uniqueidentifier not null constraint df_user_session_id default newid(),
  user_id        uniqueidentifier not null,
  upn            nvarchar(200)    not null,
  started_at     datetime2(3)     not null constraint df_user_session_started  default sysutcdatetime(),
  last_seen_at   datetime2(3)     not null constraint df_user_session_lastseen default sysutcdatetime(),
  /* set the first time this session saves to a region, so the admin list shows
     "AU session" without joining out to appraisal_audit for every row */
  region_touched nvarchar(2)      null,
  constraint pk_user_session primary key (session_id),
  constraint fk_user_session foreign key (user_id) references dbo.app_user(user_id) on delete cascade,
  constraint ck_user_session_region check (region_touched is null or region_touched in (N'US', N'AU'))
);
GO

if not exists (select 1 from sys.indexes where name = N'ix_user_session_user' and object_id = object_id(N'dbo.user_session'))
  create index ix_user_session_user on dbo.user_session (user_id, last_seen_at desc);
GO

/* ═════════════════════════════════════════════════════════════════════════════
   4. What happened, forever

   Two feeds. access_audit is every change to who-can-see-what: signing in for
   the first time, asking for a region, a grant or revoke, an admin toggle.
   appraisal_audit is every change to the appraisals themselves: a save is
   already recorded in appraisal_version (schema.sqlserver.sql), but a DELETE
   only sets appraisal.deleted_at and would otherwise leave no trace here - so
   this table, not appraisal_version, is what the admin session view reads,
   and it covers creates, updates and deletes alike in one place.

   Both are append-only. Nothing here is ever updated or deleted; a mistake is
   corrected by writing a new row, the same way the appraisal store itself
   never overwrites appraisal_version.
   ════════════════════════════════════════════════════════════════════════════ */

if object_id(N'dbo.access_audit', N'U') is null
create table dbo.access_audit (
  audit_id    bigint identity(1,1) not null,
  at          datetime2(3)  not null constraint df_access_audit_at default sysutcdatetime(),
  session_id  uniqueidentifier null,
  actor_upn   nvarchar(200) not null,
  /* the person the action was about - equal to actor_upn for a signin or a
     self-service request, different for anything an admin does to someone else */
  subject_upn nvarchar(200) not null,
  action      nvarchar(30)  not null,
  region      nvarchar(2)   null,
  detail      nvarchar(1000) null,
  constraint pk_access_audit primary key (audit_id),
  constraint fk_access_audit_session foreign key (session_id) references dbo.user_session(session_id),
  constraint ck_access_audit_action check (action in (
    N'signin', N'request', N'grant_region', N'revoke_region',
    N'grant_admin', N'revoke_admin', N'disable', N'enable', N'bootstrap',
    N'login', N'logout', N'created_user', N'reset_password', N'change_password')),
  constraint ck_access_audit_region check (region is null or region in (N'US', N'AU'))
);
GO

/* T-SQL has no ALTER CHECK, so a database from before login/logout/
   created_user/reset_password/change_password existed needs the constraint
   dropped and recreated - safe to run whether or not it already has them. */
if exists (select 1 from sys.check_constraints where name = N'ck_access_audit_action')
  alter table dbo.access_audit drop constraint ck_access_audit_action;
alter table dbo.access_audit add constraint ck_access_audit_action check (action in (
  N'signin', N'request', N'grant_region', N'revoke_region',
  N'grant_admin', N'revoke_admin', N'disable', N'enable', N'bootstrap',
  N'login', N'logout', N'created_user', N'reset_password', N'change_password'));
GO

if not exists (select 1 from sys.indexes where name = N'ix_access_audit_subject' and object_id = object_id(N'dbo.access_audit'))
  create index ix_access_audit_subject on dbo.access_audit (subject_upn, at desc);
if not exists (select 1 from sys.indexes where name = N'ix_access_audit_session' and object_id = object_id(N'dbo.access_audit'))
  create index ix_access_audit_session on dbo.access_audit (session_id) where session_id is not null;
GO

if object_id(N'dbo.appraisal_audit', N'U') is null
create table dbo.appraisal_audit (
  audit_id     bigint identity(1,1) not null,
  at           datetime2(3)     not null constraint df_appraisal_audit_at default sysutcdatetime(),
  session_id   uniqueidentifier null,
  actor_upn    nvarchar(200)    not null,
  action       nvarchar(20)     not null,
  appraisal_id uniqueidentifier not null,
  name         nvarchar(200)    not null,
  region       nvarchar(2)      not null,
  version      int              null,
  constraint pk_appraisal_audit primary key (audit_id),
  constraint fk_appraisal_audit_session foreign key (session_id) references dbo.user_session(session_id),
  constraint ck_appraisal_audit_action check (action in (N'created', N'updated', N'deleted')),
  constraint ck_appraisal_audit_region check (region in (N'US', N'AU'))
);
GO

if not exists (select 1 from sys.indexes where name = N'ix_appraisal_audit_appraisal' and object_id = object_id(N'dbo.appraisal_audit'))
  create index ix_appraisal_audit_appraisal on dbo.appraisal_audit (appraisal_id, at desc);
if not exists (select 1 from sys.indexes where name = N'ix_appraisal_audit_session' and object_id = object_id(N'dbo.appraisal_audit'))
  create index ix_appraisal_audit_session on dbo.appraisal_audit (session_id) where session_id is not null;
GO

/* ═════════════════════════════════════════════════════════════════════════════
   5. Views - the admin panel and the gate both read these, not the tables
   ════════════════════════════════════════════════════════════════════════════ */

/* One row per user: their regions aggregated, admin flag, activity, and
   whether anything of theirs is waiting on a decision - the whole panel list
   in one query. */
create or alter view dbo.user_access as
select u.user_id, u.upn, u.display_name, u.is_admin, u.disabled_at,
       u.first_seen_at, u.last_seen_at,
       cast(case when u.password_hash is not null then 1 else 0 end as bit) as has_password,
       u.must_change_password,
       (select string_agg(r.region, ',') within group (order by r.region)
        from dbo.user_region_access r where r.user_id = u.user_id) as regions,
       (select count(*) from dbo.access_request q
        where q.user_id = u.user_id and q.status = N'pending') as pending_requests
from dbo.app_user u;
GO

/* A session's end, computed rather than stored: a gap of more than 30 minutes
   since last_seen_at means the session is over. The window is a single
   literal here, not duplicated into the application - change it in one place. */
create or alter view dbo.user_session_ended as
select s.session_id, s.user_id, s.upn, s.started_at, s.last_seen_at, s.region_touched,
       case when datediff(minute, s.last_seen_at, sysutcdatetime()) > 30
            then s.last_seen_at end as ended_at
from dbo.user_session s;
GO

/* What happened in each session: saves, deletes and access changes, merged and
   ordered by time. This is the query behind GET /api/admin/sessions/:id. */
create or alter view dbo.session_activity as
select session_id, at, actor_upn, cast(N'appraisal' as nvarchar(20)) as kind,
       action, region, name as detail, appraisal_id as subject_id
from dbo.appraisal_audit
union all
select session_id, at, actor_upn, cast(N'access' as nvarchar(20)) as kind,
       action, region, concat(action, N' -> ', subject_upn,
         case when detail is not null then N': ' + detail else N'' end) as detail,
       null as subject_id
from dbo.access_audit
where session_id is not null;
GO

/* One row per session for the admin list: who, region, when, and counts -
   the query behind GET /api/admin/sessions. */
create or alter view dbo.session_summary as
select e.session_id, e.user_id, e.upn, e.started_at, e.last_seen_at, e.ended_at, e.region_touched,
       (select count(*) from dbo.appraisal_audit a where a.session_id = e.session_id and a.action <> N'deleted') as saves,
       (select count(*) from dbo.appraisal_audit a where a.session_id = e.session_id and a.action = N'deleted') as deletes,
       (select count(*) from dbo.access_audit x where x.session_id = e.session_id) as access_changes
from dbo.user_session_ended e;
GO

/* ═════════════════════════════════════════════════════════════════════════════
   6. Bootstrapping the first admin

   A guarded insert: only fires when the table exists and holds zero admins, so
   re-running this file after an admin already exists is a no-op, not a reset.
   This creates the row and the admin flag only - password_hash stays null,
   because hashing (node:crypto scrypt) has to happen in the app, not T-SQL.

   After running this file, finish bootstrapping from the app itself:
     POST /api/bootstrap-admin { "email": "<the UPN below>", "password": "..." }
   That route only ever succeeds once - it refuses if the named admin already
   has a password_hash - so it is safe to leave deployed rather than needing
   to be removed after use.

   Replace the placeholder UPN below before running this file.
   ════════════════════════════════════════════════════════════════════════════ */

declare @bootstrap_upn nvarchar(200) = N'jay.kadam@sobharealty.com';

if not exists (select 1 from dbo.app_user where is_admin = 1)
begin
  merge dbo.app_user as t
  using (select lower(@bootstrap_upn) as upn) as s
  on t.upn = s.upn
  when matched then
    update set is_admin = 1, updated_by = N'schema-access.sqlserver.sql', updated_at = sysutcdatetime()
  when not matched then
    insert (upn, is_admin, created_by, updated_by)
    values (s.upn, 1, N'schema-access.sqlserver.sql', N'schema-access.sqlserver.sql');

  insert into dbo.access_audit (actor_upn, subject_upn, action, detail)
  values (N'schema-access.sqlserver.sql', lower(@bootstrap_upn), N'bootstrap', N'First admin, granted because none existed.');
end
GO
