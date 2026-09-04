/* Azure SQL Database access for saved appraisals and access control.

   Ported from the PostgreSQL version (`pg`, $1..$n placeholders) to `mssql` /
   tedious against sqldb-mdo-landfeasibility-uat. Two things changed on
   purpose, not just mechanically:

   1. No schema-on-boot. The Postgres version applied schema.sql lazily on
      first query, because the app's own login there could hold DDL rights
      safely. `api/grant.sqlserver.sql` takes the opposite, deliberate stance
      for this database - "an application login that can CREATE TABLE can also
      DROP one" - so this file never runs DDL. schema.sqlserver.sql and
      schema-access.sqlserver.sql are applied once, by hand, by whoever has
      the SQL admin or Entra admin role. init() here only opens the pool.

   2. Authentication is managed identity by default (matching
      api/grant.sqlserver.sql option A), so no password lives in an app
      setting at all. SQL_AUTH=sql switches to a contained SQL login for local
      work or if managed identity is not available yet - see
      api/grant.sqlserver.sql option B. */
import sql from "mssql";

const usesManagedIdentity = (process.env.SQL_AUTH || "msi") !== "sql";

const pool = new sql.ConnectionPool({
  server:   process.env.SQL_SERVER,
  database: process.env.SQL_DATABASE || "sqldb-mdo-landfeasibility-uat",
  port:     Number(process.env.SQL_PORT || 1433),
  options: {
    encrypt: true,
    /* Azure SQL always terminates TLS with a CA-trusted certificate, so this
       stays false - the corporate-proxy TLS interception noted elsewhere in
       this repo affects outbound tooling on a developer machine, not the
       platform's own connection to its own database. */
    trustServerCertificate: false,
  },
  pool: {
    max: Number(process.env.SQL_POOL_MAX || 5),
    idleTimeoutMillis: 30_000,
  },
  connectionTimeout: 10_000,
  requestTimeout: 15_000,
  ...(usesManagedIdentity
    ? { authentication: { type: "azure-active-directory-msi-app-service", options: { clientId: process.env.SQL_MSI_CLIENT_ID } } }
    : { user: process.env.SQL_USER, password: process.env.SQL_PASSWORD }),
});

/* Mirrors the pg version: an idle connection dropped by the platform surfaces
   as an 'error' event on the pool rather than on any one request, and without
   this listener that is an unhandled error and takes the whole process down. */
pool.on("error", (err) => console.error("[db] pool error:", err.message));

let ready = null;
/* Connects the pool once per process, and awaited by every query so the first
   request after a cold start cannot race it. Not schema application - see the
   file header. */
export function init() {
  if (!ready) {
    ready = pool.connect()
      .then(() => console.log("[db] connected"))
      .catch((err) => { ready = null; throw err; });
  }
  return ready;
}

/* Wraps a value so it binds with an explicit SQL type instead of mssql's
   type-by-JS-value guess, for the two cases that guess gets wrong:
   a GUID string compared against a `uniqueidentifier` column, which works by
   implicit conversion but not reliably across collations, and a long string
   (the ~15-100 kB envelope, mainly), which a bare NVarChar binds at a default
   length far short of what it needs and silently truncates rather than
   erroring. Everything else - short strings, numbers, booleans, null - is
   left to mssql's own inference, which matches the schema's own column types
   for those. */
export const asUuid = (v) => ({ __type: sql.UniqueIdentifier, value: v });
export const asText = (v) => ({ __type: sql.NVarChar(sql.MAX), value: v });

function bindParams(request, params = []) {
  params.forEach((v, i) => {
    const name = `p${i + 1}`;
    if (v && typeof v === "object" && "__type" in v) {
      request.input(name, v.__type, v.value === undefined ? null : v.value);
    } else if (typeof v === "string" && v.length > 4000) {
      request.input(name, sql.NVarChar(sql.MAX), v);
    } else {
      request.input(name, v === undefined ? null : v);
    }
  });
}

/* Same shape as the pg version's result - { rows, rowCount } - so call sites
   in appraisals.mjs needed only their SQL text changed ($n -> @pn, RETURNING
   -> OUTPUT, now() -> sysutcdatetime()), not their result handling. An
   `OUTPUT inserted.*` clause on an INSERT or UPDATE populates `recordset`
   exactly like a SELECT would, which is what makes that mechanical swap work. */
export async function query(text, params) {
  await init();
  const request = pool.request();
  bindParams(request, params);
  const result = await request.query(text);
  return { rows: result.recordset || [], rowCount: result.rowsAffected.reduce((a, b) => a + b, 0) };
}

export async function tx(fn) {
  await init();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    const client = {
      query: async (text, params) => {
        const request = new sql.Request(transaction);
        bindParams(request, params);
        const result = await request.query(text);
        return { rows: result.recordset || [], rowCount: result.rowsAffected.reduce((a, b) => a + b, 0) };
      },
    };
    const out = await fn(client);
    await transaction.commit();
    return out;
  } catch (err) {
    await transaction.rollback().catch(() => {});
    throw err;
  }
}

export const close = () => pool.close();
