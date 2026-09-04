/* Access control: who signs in, what region they can see, and the admin panel
   behind it. Loaded by Deploy/server.js the same way api/appraisals.mjs is -
   a dynamic import that degrades to "not enabled" on failure - and consulted
   by api/appraisals.mjs for the same entitlement check the page gate applies.

   Identity comes from exactly one header, X-MS-CLIENT-PRINCIPAL-NAME, and it
   is only trustworthy because Easy Auth strips any copy the browser tried to
   send - see the identical warning in appraisals.mjs. Do not enable the gate
   in server.js (ACCESS_ENFORCE=1) until Easy Auth is actually on. */
import { query, tx } from "./db.mjs";
import { send, readBody } from "./http.mjs";

const REGIONS = new Set(["US", "AU"]);
const SESSION_IDLE_MINUTES = 30;

export function principal(req) {
  const name = req.headers["x-ms-client-principal-name"];
  if (name) return String(name).trim().toLowerCase();
  if (process.env.ALLOW_ANON_DEV === "1") return "dev@local";
  return null;
}

/* ─────────────────────────────────────────────────────────────────────────
   Resolving a caller: who they are, what they can see, and which session
   this request belongs to - all three in one round trip, cached per UPN.

   The cache is why this is safe to call on every gated page load and every
   API request: a hit costs nothing, and a miss happens at most once per
   CACHE_TTL_MS per person, which is also the outside bound on how long a
   revoke takes to apply (the plan's "within a minute" - one cache window,
   not a separate invalidation mechanism, since a TTL that short makes a
   version counter no simpler and no faster in practice).

   The same round trip open-or-touches this person's session (§3 of the plan):
   a session_id already cached and still within the idle window is reused and
   its last_seen_at bumped; otherwise a new one starts. Because the whole
   resolution shares the cache TTL, a session's last_seen_at is only as fresh
   as the last cache miss - a person active for an hour touches it roughly
   once a minute, not on every request, which is the point.
   ───────────────────────────────────────────────────────────────────────── */

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // upn -> { at, result }

const RESOLVE_SQL = `
declare @upn nvarchar(200) = @p1;
declare @now datetime2(3) = sysutcdatetime();

merge dbo.app_user as t
using (select @upn as upn) as s
on t.upn = s.upn
when matched then update set last_seen_at = @now
when not matched then insert (upn, created_by, updated_by) values (s.upn, @upn, @upn);

declare @uid uniqueidentifier = (select user_id from dbo.app_user where upn = @upn);

if not exists (select 1 from dbo.access_audit where subject_upn = @upn and action = N'signin')
  insert into dbo.access_audit (actor_upn, subject_upn, action) values (@upn, @upn, N'signin');

declare @sid uniqueidentifier = (
  select top 1 session_id from dbo.user_session
  where user_id = @uid and datediff(minute, last_seen_at, @now) <= ${SESSION_IDLE_MINUTES}
  order by last_seen_at desc);

if @sid is null
begin
  set @sid = newid();
  insert into dbo.user_session (session_id, user_id, upn, started_at, last_seen_at) values (@sid, @uid, @upn, @now, @now);
end
else
  update dbo.user_session set last_seen_at = @now where session_id = @sid;

select u.user_id, u.upn, u.is_admin, u.disabled_at, @sid as session_id,
       (select string_agg(r.region, ',') from dbo.user_region_access r where r.user_id = u.user_id) as regions
from dbo.app_user u where u.upn = @upn;`;

/* `req` -> null (not signed in) or { upn, userId, isAdmin, disabled, regions, sessionId }.
   `regions` is a Set, always - empty for a brand-new or disabled user, never
   undefined, so every caller can write `caller.regions.has("AU")` without a
   null check. */
export async function grantsFor(req) {
  const upn = principal(req);
  if (!upn) return null;

  const cached = cache.get(upn);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const { rows } = await query(RESOLVE_SQL, [upn]);
  const row = rows[0];
  const result = {
    upn,
    userId: row.user_id,
    isAdmin: !!row.is_admin,
    disabled: !!row.disabled_at,
    regions: new Set(String(row.regions || "").split(",").filter(Boolean)),
    sessionId: row.session_id,
  };
  cache.set(upn, { at: Date.now(), result });
  return result;
}

/* ─────────────────────────────────────────────────────────────────────────
   Routes. Same contract as appraisals.mjs: handle() returns true only when
   it owns the request.
   ───────────────────────────────────────────────────────────────────────── */

/* Each admin sub-resource gets its own anchored pattern rather than one
   combined regex with optional groups - a combined pattern let a malformed
   path like /api/admin/requests/<uuid>/regions satisfy the same capture
   groups as /api/admin/users/<uuid>/regions and reach the wrong handler. */
const ROUTE = /^\/api\/(me|access-requests|admin\/[a-z][a-z-]*(?:\/[0-9a-fA-F-]{36}(?:\/[a-z]+)?)?)\/?$/;
const UUID = "[0-9a-fA-F-]{36}";
const R_USER_REGIONS = new RegExp(`^/api/admin/users/(${UUID})/regions$`);
const R_USER_ADMIN   = new RegExp(`^/api/admin/users/(${UUID})/admin$`);
const R_REQUEST      = new RegExp(`^/api/admin/requests/(${UUID})$`);
const R_SESSION      = new RegExp(`^/api/admin/sessions/(${UUID})$`);

async function auditAccess(session, actor, subject, action, region, detail) {
  await query(
    `insert into dbo.access_audit (session_id, actor_upn, subject_upn, action, region, detail) values (@p1,@p2,@p3,@p4,@p5,@p6)`,
    [session || null, actor, subject, action, region || null, detail || null]);
}

export async function handle(req, res) {
  const path = (req.url || "").split("?")[0];
  const m = ROUTE.exec(path);
  if (!m) return false;

  const caller = await grantsFor(req);
  if (!caller) { send(res, 401, { error: "Not signed in." }); return true; }

  try {
    /* GET /api/me - anyone signed in. What the request page, the landing
       page's region picker and the admin-link visibility all read. */
    if (req.method === "GET" && path === "/api/me") {
      const { rows } = await query(
        `select status, region, requested_at from dbo.access_request where user_id=@p1 and status=N'pending' order by requested_at desc`,
        [caller.userId]);
      send(res, 200, {
        upn: caller.upn, isAdmin: caller.isAdmin, disabled: caller.disabled,
        regions: [...caller.regions], pendingRequests: rows,
      });
      return true;
    }

    /* POST /api/access-requests { region, message } - ask for a region. */
    if (req.method === "POST" && path === "/api/access-requests") {
      if (caller.disabled) { send(res, 403, { error: "This account is disabled." }); return true; }
      const body = await readBody(req);
      const region = String(body.region || "").toUpperCase();
      if (!REGIONS.has(region)) { send(res, 400, { error: "region must be US or AU." }); return true; }
      if (caller.regions.has(region)) { send(res, 400, { error: "You already have access to " + region + "." }); return true; }
      try {
        await query(
          `insert into dbo.access_request (user_id, region, message) values (@p1,@p2,@p3)`,
          [caller.userId, region, body.message ? String(body.message).slice(0, 500) : null]);
        await auditAccess(caller.sessionId, caller.upn, caller.upn, "request", region, body.message || null);
      } catch (err) {
        /* the partial unique index on (user_id, region) where status='pending'
           is the actual guard against duplicate asks; a violation here just
           means the request already exists, which is not an error to report */
        if (!/unique|duplicate/i.test(err.message || "")) throw err;
      }
      send(res, 201, { ok: true });
      return true;
    }

    /* Everything past this point is admin-only. */
    if (!caller.isAdmin) { send(res, 403, { error: "Admins only." }); return true; }

    if (req.method === "GET" && path === "/api/admin/users") {
      const { rows } = await query(`select * from dbo.user_access order by upn`, []);
      send(res, 200, { users: rows });
      return true;
    }

    if (req.method === "GET" && path === "/api/admin/requests") {
      const { rows } = await query(
        `select r.request_id, r.user_id, u.upn, u.display_name, r.region, r.message, r.status, r.requested_at
         from dbo.access_request r join dbo.app_user u on u.user_id = r.user_id
         where r.status = N'pending' order by r.requested_at`, []);
      send(res, 200, { requests: rows });
      return true;
    }

    /* POST /api/admin/requests/:id { decision: "approved" | "declined" } */
    const requestMatch = req.method === "POST" && R_REQUEST.exec(path);
    if (requestMatch) {
      const subId = requestMatch[1];
      const body = await readBody(req);
      const decision = String(body.decision || "");
      if (!["approved", "declined"].includes(decision)) { send(res, 400, { error: "decision must be approved or declined." }); return true; }

      const out = await tx(async (c) => {
        const cur = await c.query(
          `select user_id, region, status from dbo.access_request where request_id=@p1`, [subId]);
        if (!cur.rows.length) return null;
        const reqRow = cur.rows[0];
        if (reqRow.status !== "pending") return { alreadyDecided: reqRow.status };

        await c.query(
          `update dbo.access_request set status=@p1, decided_by=@p2, decided_at=sysutcdatetime() where request_id=@p3`,
          [decision, caller.upn, subId]);

        if (decision === "approved") {
          await c.query(
            `merge dbo.user_region_access as t using (select @p1 as user_id, @p2 as region) as s
             on t.user_id = s.user_id and t.region = s.region
             when not matched then insert (user_id, region, granted_by) values (s.user_id, s.region, @p3);`,
            [reqRow.user_id, reqRow.region, caller.upn]);
        }
        return { user_id: reqRow.user_id, region: reqRow.region };
      });

      if (!out) { send(res, 404, { error: "No such request." }); return true; }
      if (out.alreadyDecided) { send(res, 409, { error: "That request was already " + out.alreadyDecided + "." }); return true; }

      const { rows: whoRows } = await query(`select upn from dbo.app_user where user_id=@p1`, [out.user_id]);
      const subjectUpn = whoRows[0] ? whoRows[0].upn : "";
      await auditAccess(caller.sessionId, caller.upn, subjectUpn,
        decision === "approved" ? "grant_region" : "revoke_region", out.region,
        decision === "approved" ? "Approved request." : "Declined request.");
      send(res, 200, { ok: true });
      return true;
    }

    /* POST /api/admin/users/:id/regions { region, grant: true|false } */
    const regionsMatch = req.method === "POST" && R_USER_REGIONS.exec(path);
    if (regionsMatch) {
      const subId = regionsMatch[1];
      const body = await readBody(req);
      const region = String(body.region || "").toUpperCase();
      if (!REGIONS.has(region)) { send(res, 400, { error: "region must be US or AU." }); return true; }
      const grant = !!body.grant;

      const { rows: subRows } = await query(`select upn from dbo.app_user where user_id=@p1`, [subId]);
      if (!subRows.length) { send(res, 404, { error: "No such user." }); return true; }
      const subjectUpn = subRows[0].upn;

      if (grant) {
        await query(
          `merge dbo.user_region_access as t using (select @p1 as user_id, @p2 as region) as s
           on t.user_id = s.user_id and t.region = s.region
           when not matched then insert (user_id, region, granted_by) values (s.user_id, s.region, @p3);`,
          [subId, region, caller.upn]);
      } else {
        await query(`delete from dbo.user_region_access where user_id=@p1 and region=@p2`, [subId, region]);
      }
      await auditAccess(caller.sessionId, caller.upn, subjectUpn, grant ? "grant_region" : "revoke_region", region, null);
      send(res, 200, { ok: true });
      return true;
    }

    /* POST /api/admin/users/:id/admin { grant: true|false } */
    const adminMatch = req.method === "POST" && R_USER_ADMIN.exec(path);
    if (adminMatch) {
      const subId = adminMatch[1];
      const body = await readBody(req);
      const grant = !!body.grant;

      const { rows: subRows } = await query(`select upn, is_admin, disabled_at from dbo.app_user where user_id=@p1`, [subId]);
      if (!subRows.length) { send(res, 404, { error: "No such user." }); return true; }
      const subjectUpn = subRows[0].upn;

      if (!grant) {
        /* the last admin cannot be removed - the invariant this whole panel
           depends on staying reachable at all */
        const { rows: adminCount } = await query(`select count(*) as n from dbo.app_user where is_admin=1 and disabled_at is null`, []);
        if (Number(adminCount[0].n) <= 1 && subRows[0].is_admin) {
          send(res, 409, { error: "This is the last admin - grant someone else admin first." });
          return true;
        }
      }

      await query(`update dbo.app_user set is_admin=@p1, updated_by=@p2, updated_at=sysutcdatetime() where user_id=@p3`,
        [grant ? 1 : 0, caller.upn, subId]);
      await auditAccess(caller.sessionId, caller.upn, subjectUpn, grant ? "grant_admin" : "revoke_admin", null, null);
      send(res, 200, { ok: true });
      return true;
    }

    if (req.method === "GET" && path === "/api/admin/audit") {
      const { rows } = await query(`select top 500 * from dbo.access_audit order by at desc`, []);
      send(res, 200, { audit: rows });
      return true;
    }

    /* GET /api/admin/sessions - the list; GET /api/admin/sessions/:id - one
       session's saves, deletes and access changes, merged by time (§3). */
    if (req.method === "GET" && path === "/api/admin/sessions") {
      const { rows } = await query(`select top 500 * from dbo.session_summary order by last_seen_at desc`, []);
      send(res, 200, { sessions: rows });
      return true;
    }

    const sessionMatch = req.method === "GET" && R_SESSION.exec(path);
    if (sessionMatch) {
      const subId = sessionMatch[1];
      const { rows: sessionRows } = await query(`select * from dbo.session_summary where session_id=@p1`, [subId]);
      if (!sessionRows.length) { send(res, 404, { error: "No such session." }); return true; }
      const { rows: activity } = await query(
        `select * from dbo.session_activity where session_id=@p1 order by at`, [subId]);
      send(res, 200, { session: sessionRows[0], activity });
      return true;
    }

    send(res, 404, { error: "No such admin route." });
    return true;
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error("[access]", req.method, path, err);
    send(res, status, { error: status === 500 ? "The access store is unavailable." : err.message });
    return true;
  }
}

export default handle;
