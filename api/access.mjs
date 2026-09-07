/* Access control: who signs in, what region they can see, and the admin panel
   behind it. Loaded by Deploy/server.js the same way api/appraisals.mjs is -
   a dynamic import that degrades to "not enabled" on failure - and consulted
   by api/appraisals.mjs for the same entitlement check the page gate applies.

   Identity is internal, not Microsoft/Entra: an email + password this app
   owns, hashed with node:crypto's scrypt (see hashPassword/verifyPassword
   below) - no external identity provider, no app registration, nothing that
   depends on the tenant. A session is a row in dbo.user_session, created by
   POST /api/login and named by an HMAC-signed cookie (see signSession/
   sessionIdFromRequest) so the cookie cannot be forged without SESSION_SECRET.
   Do not enable the gate in server.js (ACCESS_ENFORCE=1) until at least the
   bootstrap admin can sign in - see api/README.md. */
import { randomUUID, randomBytes, scryptSync, timingSafeEqual, createHmac } from "node:crypto";
import { query, tx } from "./db.mjs";
import { send, readBody } from "./http.mjs";

const REGIONS = new Set(["US", "AU"]);
const COOKIE_NAME = "sid";
const COOKIE_MAX_AGE_S = 60 * 60 * 12; // 12 hours

/* Second factor in front of the admin panel specifically, independent of
   whose account is signed in - a shared PIN the whole admin group knows,
   checked here, not trusted from the page. Hardcoded rather than an app
   setting on purpose: changing it is an edit + deploy, not a portal step
   someone could flip without it showing up in git history. */
const ADMIN_PIN = "221144";
const PIN_COOKIE_NAME = "apin";
const PIN_COOKIE_MAX_AGE_S = 60 * 60 * 12; // 12 hours, same lifetime as a session

/* ─────────────────────────────────────────────────────────────────────────
   Passwords. scrypt rather than bcrypt/argon2 so this needs no dependency -
   node:crypto already ships it. Stored as "<salt hex>:<hash hex>", one
   column, so a lookup is a single string compare after decoding.
   ───────────────────────────────────────────────────────────────────────── */

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

function verifyPassword(password, stored) {
  if (!stored || typeof password !== "string" || !password) return false;
  const sep = stored.indexOf(":");
  if (sep < 0) return false;
  const salt = Buffer.from(stored.slice(0, sep), "hex");
  const expected = Buffer.from(stored.slice(sep + 1), "hex");
  if (!salt.length || !expected.length) return false;
  const actual = scryptSync(password, salt, expected.length);
  return timingSafeEqual(actual, expected);
}

/* A fixed, valid-shape hash with no real account behind it, so /api/login can
   run verifyPassword() even when the email does not match a row - a wrong
   password and a wrong email then cost the same scrypt call, and the response
   time itself cannot be used to enumerate which emails have accounts. */
const DUMMY_HASH = hashPassword("no-such-account-timing-guard");

/* A temporary password shown once to the admin who creates or resets an
   account, for them to relay out of band - there is no email sending here.
   Excludes visually-confusable characters (0/O, 1/l/I) on purpose. */
function randomTempPassword() {
  const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(14);
  let out = "";
  for (let i = 0; i < 14; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

/* ─────────────────────────────────────────────────────────────────────────
   Sessions. The cookie carries only a session id and its HMAC, signed with
   SESSION_SECRET (an app setting) - the id itself means nothing without a
   database lookup, so a stolen cookie is useless once the row is deleted
   (POST /api/logout, or an admin reset - see the admin routes below).

   Missing SESSION_SECRET fails closed: signSession throws a 503 rather than
   falling back to a guessable default, the same "an outage beats a silently
   open gate" stance the rest of this file already takes.
   ───────────────────────────────────────────────────────────────────────── */

/* Shared signed-cookie mechanics for both the session cookie and the admin
   PIN cookie below. `purpose` is mixed into the HMAC so a valid session
   cookie cannot be replayed as a pin cookie or vice versa even though both
   are signed with the same SESSION_SECRET. */
function signValue(purpose, value) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw Object.assign(new Error("Sign-in is not configured on this server."), { status: 503 });
  return createHmac("sha256", secret).update(purpose + ":" + value).digest("hex");
}

function cookieHeader(name, purpose, value, maxAgeS) {
  const cookieValue = `${value}.${signValue(purpose, value)}`;
  const attrs = [`${name}=${encodeURIComponent(cookieValue)}`, "Path=/", "HttpOnly", "Secure", "SameSite=Lax"];
  attrs.push(maxAgeS > 0 ? `Max-Age=${maxAgeS}` : "Max-Age=0");
  return attrs.join("; ");
}

function valueFromCookie(req, name, purpose) {
  const header = req.headers.cookie;
  if (!header) return null;
  const found = header.split(";").map((s) => s.trim()).find((s) => s.startsWith(name + "="));
  if (!found) return null;
  const raw = decodeURIComponent(found.slice(name.length + 1));
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const value = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  let expected;
  try { expected = signValue(purpose, value); } catch { return null; }
  const a = Buffer.from(sig, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return value;
}

const sessionCookieHeader = (sessionId, maxAgeS) => cookieHeader(COOKIE_NAME, "sid", sessionId, maxAgeS);
const sessionIdFromRequest = (req) => valueFromCookie(req, COOKIE_NAME, "sid");

/* The pin cookie's value carries no information of its own - "ok" is not a
   secret, the signature is what proves this browser passed POST
   /api/admin/pin. */
const pinCookieHeader = (maxAgeS) => cookieHeader(PIN_COOKIE_NAME, "apin", "ok", maxAgeS);
const pinCookieValid = (req) => valueFromCookie(req, PIN_COOKIE_NAME, "apin") === "ok";

/* ─────────────────────────────────────────────────────────────────────────
   Resolving a caller from their session cookie - who they are, what they can
   see - cached per session so a hit costs nothing on every gated page load
   and every API request. A miss happens at most once per CACHE_TTL_MS per
   session, which is also the outside bound on how long a revoke takes to
   apply - one cache window, not a separate invalidation mechanism.
   ───────────────────────────────────────────────────────────────────────── */

const CACHE_TTL_MS = 60_000;
const cache = new Map(); // sessionId -> { at, result }

const RESOLVE_SQL = `
declare @sid uniqueidentifier = @p1;
declare @now datetime2(3) = sysutcdatetime();

update dbo.user_session set last_seen_at = @now where session_id = @sid;

select u.user_id, u.upn, u.is_admin, u.disabled_at, u.must_change_password,
       (select string_agg(r.region, ',') from dbo.user_region_access r where r.user_id = u.user_id) as regions
from dbo.user_session s
join dbo.app_user u on u.user_id = s.user_id
where s.session_id = @sid;`;

export async function grantsFor(req) {
  const sessionId = sessionIdFromRequest(req);
  if (!sessionId) return null;

  const cached = cache.get(sessionId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.result;

  const { rows } = await query(RESOLVE_SQL, [sessionId]);
  const row = rows[0];
  if (!row) return null; // cookie verifies but the session row is gone - logged out, or reset elsewhere

  const result = {
    upn: row.upn,
    userId: row.user_id,
    isAdmin: !!row.is_admin,
    disabled: !!row.disabled_at,
    mustChangePassword: !!row.must_change_password,
    regions: new Set(String(row.regions || "").split(",").filter(Boolean)),
    sessionId,
  };
  cache.set(sessionId, { at: Date.now(), result });
  return result;
}

/* A 6-digit PIN is 1e6 combinations - trivially scriptable with no throttle.
   Per-IP, in-memory, reset on success: enough to turn "write a loop" into
   "wait five minutes," without a database table for something this cheap. */
const pinAttempts = new Map(); // ip -> { count, lockedUntil }
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS = 5 * 60_000;

/* Same shape, for /api/login - there was never a lockout here, which stayed
   low-risk while every password was at least 10 characters. Removing that
   minimum (anyone can now pick a short password) makes unlimited-attempt
   brute force a real exposure, not just a theoretical one. Keyed by IP, not
   by email, so this cannot be used to lock a real account out by hammering
   their address from elsewhere. */
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_LOCKOUT_MS = 5 * 60_000;

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

/* ─────────────────────────────────────────────────────────────────────────
   Routes. Same contract as appraisals.mjs: handle() returns true only when
   it owns the request.
   ───────────────────────────────────────────────────────────────────────── */

/* Each admin sub-resource gets its own anchored pattern rather than one
   combined regex with optional groups - a combined pattern let a malformed
   path like /api/admin/requests/<uuid>/regions satisfy the same capture
   groups as /api/admin/users/<uuid>/regions and reach the wrong handler. */
const ROUTE = /^\/api\/(me|login|logout|change-password|bootstrap-admin|access-requests|admin\/[a-z][a-z-]*(?:\/[0-9a-fA-F-]{36}(?:\/[a-z-]+)?)?)\/?$/;
const UUID = "[0-9a-fA-F-]{36}";
const R_USER_REGIONS = new RegExp(`^/api/admin/users/(${UUID})/regions$`);
const R_USER_ADMIN   = new RegExp(`^/api/admin/users/(${UUID})/admin$`);
const R_USER_RESET   = new RegExp(`^/api/admin/users/(${UUID})/reset-password$`);
const R_REQUEST      = new RegExp(`^/api/admin/requests/(${UUID})$`);
const R_SESSION      = new RegExp(`^/api/admin/sessions/(${UUID})$`);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function auditAccess(session, actor, subject, action, region, detail) {
  await query(
    `insert into dbo.access_audit (session_id, actor_upn, subject_upn, action, region, detail) values (@p1,@p2,@p3,@p4,@p5,@p6)`,
    [session || null, actor, subject, action, region || null, detail || null]);
}

export async function handle(req, res) {
  const path = (req.url || "").split("?")[0];
  const m = ROUTE.exec(path);
  if (!m) return false;

  try {
    /* POST /api/login { email, password } - the only route that runs before
       the signed-in check, for the obvious reason. Deliberately looks up the
       row and calls verifyPassword() even when no row matches (against a
       fixed dummy hash) so a wrong email and a wrong password take about the
       same time - a real-not-real email cannot be timed out of this. */
    if (req.method === "POST" && path === "/api/login") {
      const ip = clientIp(req);
      const now = Date.now();
      const attempt = loginAttempts.get(ip);
      if (attempt && attempt.lockedUntil > now) {
        send(res, 429, { error: "Too many attempts. Try again in a few minutes." });
        return true;
      }
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      const { rows } = await query(`select user_id, upn, password_hash, disabled_at from dbo.app_user where upn=@p1`, [email]);
      const row = rows[0];
      const ok = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
      if (!ok || !row) {
        const count = (attempt ? attempt.count : 0) + 1;
        loginAttempts.set(ip, { count, lockedUntil: count >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_LOCKOUT_MS : 0 });
        send(res, 401, { error: "Incorrect email or password." }); return true;
      }
      loginAttempts.delete(ip);
      if (row.disabled_at) { send(res, 403, { error: "This account is disabled." }); return true; }

      const sessionId = randomUUID();
      await query(`insert into dbo.user_session (session_id, user_id, upn) values (@p1,@p2,@p3)`, [sessionId, row.user_id, row.upn]);
      await auditAccess(sessionId, row.upn, row.upn, "login", null, null);
      res.setHeader("Set-Cookie", sessionCookieHeader(sessionId, COOKIE_MAX_AGE_S));
      send(res, 200, { ok: true });
      return true;
    }

    if (req.method === "POST" && path === "/api/logout") {
      const sessionId = sessionIdFromRequest(req);
      if (sessionId) {
        cache.delete(sessionId);
        /* By the time anyone signs out, dbo.access_audit already has at
           least one row referencing this session_id (the login itself was
           audited against it) - fk_access_audit_session has no ON DELETE
           action, so this delete has always thrown a foreign key violation
           and been caught below as a 500 "The access store is unavailable",
           meaning /api/logout has never actually deleted a session or
           cleared the cookie: signing out looked like it worked (the page
           still navigated to /login) but the old session, and its cookie
           if a copy of it survived, both kept working. Catching this
           specific failure and still clearing the cookie fixes the signed-
           out browser immediately; the row itself is cleaned up once the
           FK is migrated to ON DELETE SET NULL (see schema-access.sqlserver.sql). */
        try {
          const { rows } = await query(`select upn from dbo.user_session where session_id=@p1`, [sessionId]);
          await query(`delete from dbo.user_session where session_id=@p1`, [sessionId]);
          if (rows[0]) await auditAccess(null, rows[0].upn, rows[0].upn, "logout", null, null);
        } catch (err) {
          console.error("[access] logout could not remove the session row:", err.message);
        }
      }
      res.setHeader("Set-Cookie", sessionCookieHeader("", 0));
      send(res, 200, { ok: true });
      return true;
    }

    /* POST /api/bootstrap-admin { email, password } - sets the very first
       password. Only ever succeeds once: schema-access.sqlserver.sql creates
       the named admin's row with password_hash null, and this route refuses
       to run against a row that already has one - see its own header comment
       for the full sequence. Safe to leave deployed permanently. */
    if (req.method === "POST" && path === "/api/bootstrap-admin") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (!password) { send(res, 400, { error: "A password is required." }); return true; }
      const { rows } = await query(`select user_id, is_admin, password_hash from dbo.app_user where upn=@p1`, [email]);
      const row = rows[0];
      if (!row || !row.is_admin || row.password_hash) { send(res, 403, { error: "Bootstrap is not available." }); return true; }
      await query(`update dbo.app_user set password_hash=@p1, must_change_password=0, updated_by=@p2, updated_at=sysutcdatetime() where user_id=@p3`,
        [hashPassword(password), email, row.user_id]);
      await auditAccess(null, email, email, "bootstrap", null, "Admin password set.");
      send(res, 200, { ok: true });
      return true;
    }

    /* POST /api/admin/pin { pin } - independent of sign-in state on purpose
       (the client shows this before it has even checked /api/me), but grants
       nothing by itself: every /api/admin/* route below still requires
       isAdmin AND this cookie, so passing the PIN alone reaches nothing. */
    if (req.method === "POST" && path === "/api/admin/pin") {
      const ip = clientIp(req);
      const now = Date.now();
      const attempt = pinAttempts.get(ip);
      if (attempt && attempt.lockedUntil > now) {
        send(res, 429, { error: "Too many attempts. Try again in a few minutes." });
        return true;
      }
      const body = await readBody(req);
      const pin = String(body.pin || "");
      if (pin === ADMIN_PIN) {
        pinAttempts.delete(ip);
        res.setHeader("Set-Cookie", pinCookieHeader(PIN_COOKIE_MAX_AGE_S));
        send(res, 200, { ok: true });
      } else {
        const count = (attempt ? attempt.count : 0) + 1;
        pinAttempts.set(ip, { count, lockedUntil: count >= PIN_MAX_ATTEMPTS ? now + PIN_LOCKOUT_MS : 0 });
        send(res, 401, { error: "Incorrect PIN." });
      }
      return true;
    }

    const caller = await grantsFor(req);
    if (!caller) { send(res, 401, { error: "Not signed in." }); return true; }

    /* GET /api/me - anyone signed in. What the request page, the landing
       page's region picker and the admin-link visibility all read. */
    if (req.method === "GET" && path === "/api/me") {
      const { rows } = await query(
        `select status, region, requested_at from dbo.access_request where user_id=@p1 and status=N'pending' order by requested_at desc`,
        [caller.userId]);
      send(res, 200, {
        upn: caller.upn, isAdmin: caller.isAdmin, disabled: caller.disabled,
        mustChangePassword: caller.mustChangePassword,
        regions: [...caller.regions], pendingRequests: rows,
      });
      return true;
    }

    /* POST /api/change-password { currentPassword, newPassword } - anyone
       signed in, over their own account only. */
    if (req.method === "POST" && path === "/api/change-password") {
      const body = await readBody(req);
      const current = String(body.currentPassword || "");
      const next = String(body.newPassword || "");
      if (!next) { send(res, 400, { error: "A new password is required." }); return true; }
      const { rows } = await query(`select password_hash from dbo.app_user where user_id=@p1`, [caller.userId]);
      if (!verifyPassword(current, rows[0] && rows[0].password_hash)) {
        send(res, 401, { error: "Current password is incorrect." }); return true;
      }
      await query(`update dbo.app_user set password_hash=@p1, must_change_password=0, updated_by=@p2, updated_at=sysutcdatetime() where user_id=@p3`,
        [hashPassword(next), caller.upn, caller.userId]);
      cache.delete(caller.sessionId);
      await auditAccess(caller.sessionId, caller.upn, caller.upn, "change_password", null, null);
      send(res, 200, { ok: true });
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

    /* Everything past this point is admin-only, and - separately - requires
       the PIN cookie from POST /api/admin/pin above. Two independent checks:
       isAdmin says who this person is; the PIN says this browser passed the
       shared gate. Reported as two different reasons so the page can tell
       "you are not an admin" from "enter the PIN" rather than showing one
       generic 403 for both. */
    if (!caller.isAdmin) { send(res, 403, { error: "Admins only." }); return true; }
    if (!pinCookieValid(req)) { send(res, 403, { error: "PIN required.", pinRequired: true }); return true; }

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

    /* POST /api/admin/users { email, displayName?, regions?: ["AU","US"] }
       Creates the account with a random temporary password, returned once in
       the response - there is no email sending here, so relay it to the
       person out of band. must_change_password is set so the app can prompt
       them to pick their own on first sign-in. */
    if (req.method === "POST" && path === "/api/admin/users") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      if (!EMAIL_RE.test(email)) { send(res, 400, { error: "A valid email is required." }); return true; }
      const displayName = body.displayName ? String(body.displayName).slice(0, 200) : null;
      const wantedRegions = Array.isArray(body.regions)
        ? [...new Set(body.regions.map((r) => String(r).toUpperCase()).filter((r) => REGIONS.has(r)))]
        : [];
      const tempPassword = randomTempPassword();
      const hash = hashPassword(tempPassword);

      const out = await tx(async (c) => {
        const existing = await c.query(`select user_id from dbo.app_user where upn=@p1`, [email]);
        if (existing.rows.length) return { conflict: true };
        const ins = await c.query(
          `insert into dbo.app_user (upn, display_name, password_hash, must_change_password, created_by, updated_by)
           output inserted.user_id
           values (@p1,@p2,@p3,1,@p4,@p4)`,
          [email, displayName, hash, caller.upn]);
        const userId = ins.rows[0].user_id;
        for (const region of wantedRegions) {
          await c.query(`insert into dbo.user_region_access (user_id, region, granted_by) values (@p1,@p2,@p3)`,
            [userId, region, caller.upn]);
        }
        return { userId };
      });
      if (out.conflict) { send(res, 409, { error: "That email already has an account." }); return true; }

      await auditAccess(caller.sessionId, caller.upn, email, "created_user", null,
        wantedRegions.length ? "Regions: " + wantedRegions.join(",") : null);
      send(res, 201, { userId: out.userId, email, tempPassword });
      return true;
    }

    /* POST /api/admin/users/:id/reset-password { password?: string } - either
       issues a new random temporary password (shown once, same as account
       creation, must_change_password stays on) or, when the admin supplies
       one in the body, sets that exact password directly and leaves
       must_change_password alone - the admin already knows what they typed,
       there is nothing to relay and nothing to force changing again. Either
       way the person is signed out everywhere by dropping their sessions, so
       a compromised or forgotten password cannot be used again once reset.

       The audit insert runs BEFORE the session delete on purpose: if the
       admin is resetting their own account, the delete removes their own
       current session (the one auditAccess's session_id argument points at),
       and dbo.access_audit's session_id column has a foreign key onto
       dbo.user_session - inserting after the delete violates it, which
       previously surfaced as a 500 "The access store is unavailable" and
       left the password silently changed with no tempPassword ever
       delivered. Auditing first means the referenced session still exists
       at insert time regardless of whose session gets dropped next. */
    const resetMatch = req.method === "POST" && R_USER_RESET.exec(path);
    if (resetMatch) {
      const subId = resetMatch[1];
      const { rows: subRows } = await query(`select upn from dbo.app_user where user_id=@p1`, [subId]);
      if (!subRows.length) { send(res, 404, { error: "No such user." }); return true; }
      const subjectUpn = subRows[0].upn;
      const body = await readBody(req);
      const chosen = String(body.password || "");
      const tempPassword = chosen || randomTempPassword();

      await query(`update dbo.app_user set password_hash=@p1, must_change_password=@p2, updated_by=@p3, updated_at=sysutcdatetime() where user_id=@p4`,
        [hashPassword(tempPassword), chosen ? 0 : 1, caller.upn, subId]);
      await auditAccess(caller.sessionId, caller.upn, subjectUpn, "reset_password", null, chosen ? "Admin set a specific password." : null);
      const { rows: killed } = await query(`select session_id from dbo.user_session where user_id=@p1`, [subId]);
      killed.forEach((r) => cache.delete(r.session_id));
      await query(`delete from dbo.user_session where user_id=@p1`, [subId]);
      send(res, 200, { tempPassword });
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
