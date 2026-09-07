/* HTTP routes for saved appraisals.

   Deliberately framework-agnostic: this repo does not hold the server.js that
   runs in wwwroot, so handle() is written against Node's raw req/res and
   returns true only when it has taken ownership of the request. It drops into a
   plain http server or an Express app unchanged - see README.md for the wiring.

   Ported from PostgreSQL ($1..$n, RETURNING, jsonb) to Azure SQL Database
   (@p1..@pn, OUTPUT inserted.*, nvarchar(max)). One thing is not mechanical:
   `pg` auto-serialises a plain JS object passed as a parameter into jsonb;
   `mssql` does not, so every envelope is JSON.stringify'd explicitly before
   binding, wrapped in asText() so it binds as NVarChar(MAX) rather than being
   silently truncated at the driver's default string-parameter length. */
import { query, tx, asText } from "./db.mjs";
import { send, readBody } from "./http.mjs";
import { grantsFor } from "./access.mjs";

const ROUTE = /^\/api\/appraisals(?:\/([0-9a-fA-F-]{36}))?(?:\/versions(?:\/(\d+))?)?$/;

const REGIONS = new Set(["US", "AU"]);

/* Shape check only. The envelope is not interpreted here - the client re-applies
   cleanStoredInputs and enforceAccountingPolicy to everything it loads, whatever
   the source, so this guards storage rather than the model. */
function checkEnvelope(body) {
  const env = body && body.envelope;
  if (!env || typeof env !== "object" || Array.isArray(env)) throw Object.assign(new Error("envelope must be an object."), { status: 400 });
  if (!Array.isArray(env.parcels) || env.parcels.length === 0) throw Object.assign(new Error("envelope.parcels must be a non-empty array."), { status: 400 });
  const first = env.parcels[0] || {};
  const name = String(body.name || first.name || "").trim();
  if (!name) throw Object.assign(new Error("A name is required."), { status: 400 });

  /* Both models write v:7 over different DEF keys, so the version cannot tell
     them apart and the region has to be explicit. The page sends it twice - as
     a field and inside the envelope - and a disagreement means the caller has
     assembled the request wrongly, which is worth refusing rather than
     guessing at. */
  const region = String(body.region || env.region || "").toUpperCase();
  if (!REGIONS.has(region)) throw Object.assign(new Error("region must be one of " + [...REGIONS].join(", ") + "."), { status: 400 });
  if (env.region && String(env.region).toUpperCase() !== region)
    throw Object.assign(new Error("region does not match the envelope's own region."), { status: 400 });

  return {
    env,
    name: name.slice(0, 200),
    location: body.location ? String(body.location).slice(0, 200) : null,
    region,
    v: Number(env.v) || 0
  };
}

const LIST_COLS = "id, name, location, region, version, envelope_v, created_by, created_at, updated_by, updated_at";
const OUTPUT_COLS = LIST_COLS.split(", ").map((c) => "inserted." + c).join(", ");

/* Every route below adds one more check beyond "is anyone signed in": is this
   *particular caller* entitled to this region. Two routes had no region
   predicate at all before this - GET/DELETE by id and the versions routes -
   so a region filter on the list alone would have left them reachable across
   regions with nothing but a guessed or copied id.

   `caller.regions` holds at most {"US","AU"}, so the access boundary is always
   one of exactly three shapes: nothing matches (caller has neither), an exact
   region equality (caller has one), or no filter needed at all (caller has
   both) - there is never a need for a real IN-list or its parameter
   awkwardness in T-SQL. */
function regionFilter(caller, column) {
  const held = [...caller.regions];
  if (held.length === 0) return { clause: " and 1 = 0", params: [] };
  if (held.length >= REGIONS.size) return { clause: "", params: [] };
  return { clause: ` and ${column} = @p`, params: [held[0]], placeholder: "@p" };
}

/* appraisal_audit is the one place a save AND a delete both land - a delete
   never touches appraisal_version, so without this table it would be
   invisible to the admin session view (api/access.mjs, dbo.session_activity).
   Written inside the same transaction as the change it describes. */
async function auditAppraisal(c, sessionId, actorUpn, action, row) {
  await c.query(
    `insert into dbo.appraisal_audit (session_id, actor_upn, action, appraisal_id, name, region, version)
     values (@p1,@p2,@p3,@p4,@p5,@p6,@p7)`,
    [sessionId || null, actorUpn, action, row.id, row.name, row.region, row.version || null]);
}

export async function handle(req, res) {
  const path = (req.url || "").split("?")[0];
  const m = ROUTE.exec(path);
  if (!m) return false;

  const id = m[1];
  const versionNo = m[2];

  const caller = await grantsFor(req);
  if (!caller) { send(res, 401, { error: "Not signed in." }); return true; }
  if (caller.disabled) { send(res, 403, { error: "This account is disabled." }); return true; }
  const who = caller.upn;

  try {
    /* GET /api/appraisals - the list behind the picker. Envelopes are excluded:
       the list is opened far more often than any one appraisal is loaded, and
       each envelope runs to ~100 kB. */
    if (req.method === "GET" && !id) {
      const q = new URL(req.url, "http://placeholder").searchParams;
      const wanted = q.get("region");
      if (wanted && !REGIONS.has(wanted.toUpperCase())) { send(res, 400, { error: "Unknown region." }); return true; }
      if (wanted && !caller.regions.has(wanted.toUpperCase())) {
        send(res, 403, { error: `You do not have access to the ${wanted.toUpperCase()} model.` }); return true;
      }

      /* expand=1 includes every envelope, for a page that opens its whole set
         of projects at startup rather than one at a time. Twelve Australian
         projects come to about 85 kB, so one round trip beats twelve; without
         it the envelopes stay out, because the plain list is opened far more
         often than any appraisal is loaded. Region is required with expand, so
         a caller cannot pull both models' envelopes in a single request by
         omitting it. */
      const expand = q.get("expand") === "1";
      if (expand && !wanted) { send(res, 400, { error: "expand requires a region." }); return true; }

      /* No region parameter no longer means "both" - it means every region
         *this caller* holds, which is what makes the list safe to call
         without first asking permission for a region. */
      const effective = wanted ? [wanted.toUpperCase()] : [...caller.regions];
      if (!effective.length) { send(res, 200, { appraisals: [] }); return true; }

      const params = [];
      const placeholders = effective.map((r) => { params.push(r); return `@p${params.length}`; }).join(",");
      const top = expand ? 200 : 500;
      const order = expand ? "created_at asc" : "updated_at desc";
      const { rows } = await query(
        `select top ${top} ${LIST_COLS}${expand ? ", envelope" : ""} from dbo.appraisal
         where deleted_at is null and region in (${placeholders})
         order by ${order}`,
        params);
      /* mssql hands nvarchar(max) back as a raw string - unlike pg's jsonb,
         which the Postgres version relied on to auto-parse this same column.
         Without this, every row's envelope.parcels access on the client
         silently sees undefined and the store looks empty no matter how much
         is in it. */
      if (expand) rows.forEach((r) => { r.envelope = JSON.parse(r.envelope); });
      send(res, 200, { appraisals: rows });
      return true;
    }

    if (req.method === "GET" && id && versionNo) {
      const rf = regionFilter(caller, "a.region");
      const { rows } = await query(
        `select v.version, v.name, v.envelope, v.saved_by, v.saved_at, v.note
         from dbo.appraisal_version v join dbo.appraisal a on a.id = v.appraisal_id
         where v.appraisal_id=@p1 and v.version=@p2${rf.clause.replace("@p", "@p3")}`,
        [id, Number(versionNo), ...rf.params]);
      if (rows.length) { rows[0].envelope = JSON.parse(rows[0].envelope); send(res, 200, rows[0]); }
      else send(res, 404, { error: "No such version." });
      return true;
    }

    if (req.method === "GET" && id && /\/versions$/.test(path)) {
      const rf = regionFilter(caller, "a.region");
      const { rows } = await query(
        `select v.version, v.name, v.saved_by, v.saved_at, v.note
         from dbo.appraisal_version v join dbo.appraisal a on a.id = v.appraisal_id
         where v.appraisal_id=@p1${rf.clause.replace("@p", "@p2")}
         order by v.version desc`,
        [id, ...rf.params]);
      send(res, 200, { versions: rows });
      return true;
    }

    if (req.method === "GET" && id) {
      const rf = regionFilter(caller, "region");
      const { rows } = await query(
        `select ${LIST_COLS}, envelope from dbo.appraisal where id=@p1 and deleted_at is null${rf.clause.replace("@p", "@p2")}`,
        [id, ...rf.params]);
      if (rows.length) { rows[0].envelope = JSON.parse(rows[0].envelope); send(res, 200, rows[0]); }
      else send(res, 404, { error: "No such appraisal." });
      return true;
    }

    if (req.method === "POST" && !id) {
      const body = await readBody(req);
      const p = checkEnvelope(body);
      if (!caller.regions.has(p.region)) {
        send(res, 403, { error: `You do not have access to the ${p.region} model.` }); return true;
      }
      const row = await tx(async (c) => {
        const ins = await c.query(
          `insert into dbo.appraisal (name, location, region, envelope, envelope_v, created_by, updated_by)
           output ${OUTPUT_COLS}
           values (@p1,@p2,@p3,@p4,@p5,@p6,@p6)`,
          [p.name, p.location, p.region, asText(JSON.stringify(p.env)), p.v, who]);
        const created = ins.rows[0];
        await c.query(
          `insert into dbo.appraisal_version (appraisal_id, version, name, envelope, envelope_v, saved_by)
           values (@p1,1,@p2,@p3,@p4,@p5)`,
          [created.id, p.name, asText(JSON.stringify(p.env)), p.v, who]);
        await auditAppraisal(c, caller.sessionId, who, "created", { ...created, version: 1 });
        return created;
      });
      send(res, 201, row);
      return true;
    }

    /* PUT carries the version the client loaded. A mismatch means someone else
       saved in the meantime, so the write is refused and the current row goes
       back for the client to report against. */
    if (req.method === "PUT" && id) {
      const body = await readBody(req);
      const p = checkEnvelope(body);
      if (!caller.regions.has(p.region)) {
        send(res, 403, { error: `You do not have access to the ${p.region} model.` }); return true;
      }
      const expected = Number(body.expected_version);
      if (!Number.isInteger(expected)) { send(res, 400, { error: "expected_version is required." }); return true; }

      const out = await tx(async (c) => {
        /* An appraisal never changes region: the row's envelope would then be
           unreadable by the model that owns it. Matching on region as well as
           version means a cross-model write cannot land even if a caller sends
           the right id and version. */
        const upd = await c.query(
          `update dbo.appraisal set name=@p1, location=@p2, envelope=@p3, envelope_v=@p4,
                                    version=version+1, updated_by=@p5, updated_at=sysutcdatetime()
           output ${OUTPUT_COLS}
           where id=@p6 and deleted_at is null and version=@p7 and region=@p8`,
          [p.name, p.location, asText(JSON.stringify(p.env)), p.v, who, id, expected, p.region]);
        if (!upd.rows.length) return null;
        const updated = upd.rows[0];
        await c.query(
          `insert into dbo.appraisal_version (appraisal_id, version, name, envelope, envelope_v, saved_by, note)
           values (@p1,@p2,@p3,@p4,@p5,@p6,@p7)`,
          [id, updated.version, p.name, asText(JSON.stringify(p.env)), p.v, who, body.note ? String(body.note).slice(0, 500) : null]);
        await auditAppraisal(c, caller.sessionId, who, "updated", updated);
        return updated;
      });

      if (out) { send(res, 200, out); return true; }

      const cur = await query(`select ${LIST_COLS}, deleted_at from dbo.appraisal where id=@p1`, [id]);
      /* A row whose true region the caller does not hold answers exactly like
         a missing row - the same principle the GET/DELETE routes apply, so
         this diagnostic branch cannot be used to learn which region a
         forbidden id belongs to. */
      if (!cur.rows.length || cur.rows[0].deleted_at || !caller.regions.has(cur.rows[0].region))
        send(res, 404, { error: "No such appraisal." });
      /* Three different reasons the update matched nothing, and reporting the
         wrong one sends the user looking for a colleague who never touched it. */
      else if (cur.rows[0].region !== p.region)
        send(res, 409, { error: `That appraisal belongs to the ${cur.rows[0].region} model and cannot be saved from this one.` });
      else send(res, 409, { error: `Saved by ${cur.rows[0].updated_by} while you were editing.`, current: cur.rows[0] });
      return true;
    }

    /* Soft delete - history is the point of the versions table, so nothing here
       destroys anything. A delete never touched appraisal_version, so
       auditAppraisal below is the only record it leaves. */
    if (req.method === "DELETE" && id) {
      const rf = regionFilter(caller, "region");
      const out = await tx(async (c) => {
        const upd = await c.query(
          `update dbo.appraisal set deleted_at=sysutcdatetime(), updated_by=@p2
           output ${OUTPUT_COLS}
           where id=@p1 and deleted_at is null${rf.clause.replace("@p", "@p3")}`,
          [id, who, ...rf.params]);
        if (!upd.rows.length) return null;
        const deleted = upd.rows[0];
        await auditAppraisal(c, caller.sessionId, who, "deleted", deleted);
        return deleted;
      });
      if (out) send(res, 204, undefined); else send(res, 404, { error: "No such appraisal." });
      return true;
    }

    send(res, 405, { error: "Method not allowed." });
    return true;
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error("[appraisals]", req.method, path, err);
    send(res, status, { error: status === 500 ? "The appraisal store is unavailable." : err.message });
    return true;
  }
}

export default handle;
