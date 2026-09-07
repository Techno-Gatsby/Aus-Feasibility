/* Ports api/seed-us.sql (PostgreSQL) to T-SQL for Azure SQL Database.
   Same mechanical rewrite as port-seed-to-sqlserver.mjs (see that file for the
   AU seed): dollar quoting -> N'' with doubled quotes, ::jsonb dropped,
   timestamptz -> dateadd, ON CONFLICT DO NOTHING -> an IF NOT EXISTS guard so
   a second run is still a no-op. */
import { readFileSync, writeFileSync } from "node:fs";

const ROOT = "c:/Users/jay.kadam/OneDrive - Sobha LLC/Desktop/Australia code/";
const src = readFileSync(ROOT + "api/seed-us.sql", "utf8");

const lits = [];
let body = src.replace(/\$j\$([\s\S]*?)\$j\$/g, (_, v) => `\u0000LIT${lits.push(v) - 1}\u0000`);

body = body
  .replace(/^begin;$/m, "begin transaction;")
  .replace(/^commit;$/m, "commit transaction;")
  .replace(/insert into appraisal_version \(/g, "insert into dbo.appraisal_version (")
  .replace(/insert into appraisal \(/g, "insert into dbo.appraisal (")
  .replace(/\u0000LIT(\d+)\u0000::jsonb/g, "\u0000JSON$1\u0000")
  .replace(/timestamptz '([\d-]+) ([\d:]+)\+00' \+ interval '(\d+) seconds?'/g,
           (_, d, t, s) => `dateadd(second, ${s}, cast('${d}T${t}' as datetime2(3)))`)
  .replace(/timestamptz '([\d-]+) ([\d:]+)\+00'/g,
           (_, d, t) => `dateadd(second, 0, cast('${d}T${t}' as datetime2(3)))`);

body = body.replace(
  /insert into dbo\.appraisal \(([\s\S]*?)\)\s*\nvalues \('([0-9a-f-]{36})',([\s\S]*?)\)\non conflict \(id\) do nothing;/g,
  (_, cols, id, rest) =>
    `if not exists (select 1 from dbo.appraisal where id = '${id}')\n` +
    `insert into dbo.appraisal (${cols})\nvalues ('${id}',${rest});`);

body = body.replace(
  /insert into dbo\.appraisal_version \(([\s\S]*?)\)\s*\nvalues \('([0-9a-f-]{36})', (\d+),([\s\S]*?)\)\non conflict \(appraisal_id, version\) do nothing;/g,
  (_, cols, id, ver, rest) =>
    `if not exists (select 1 from dbo.appraisal_version where appraisal_id = '${id}' and version = ${ver})\n` +
    `insert into dbo.appraisal_version (${cols})\nvalues ('${id}', ${ver},${rest});`);

const q = (s) => "N'" + s.replace(/'/g, "''") + "'";
body = body
  .replace(/\u0000JSON(\d+)\u0000/g, (_, i) => `cast(${q(lits[Number(i)])} as nvarchar(max))`)
  .replace(/\u0000LIT(\d+)\u0000/g, (_, i) => q(lits[Number(i)]));

const header = `/* US appraisals for Azure SQL Database - ported from seed-us.sql.
   Run once, after schema.sqlserver.sql, and only by hand: the schema applies
   itself on boot, but a seed that re-ran on every restart would fight whatever
   people had since edited.

   Still safe to run twice - the ids are derived from the project names, and
   each insert is guarded by an IF NOT EXISTS rather than an ON CONFLICT clause.

   GENERATED from seed-us.sql. Regenerate rather than hand-edit.
*/

`;

const out = header + body.replace(/^\/\*[\s\S]*?\*\/\n\n/, "").replace(/\/\* What should come back:[\s\S]*$/, "").trimEnd() + "\n";
writeFileSync(ROOT + "api/seed-us.sqlserver.sql", out);

const n = (re) => (out.match(re) || []).length;
const checks = [
  ["1 appraisal guard",   n(/if not exists \(select 1 from dbo\.appraisal where id/g) === 1],
  ["1 version guard",     n(/if not exists \(select 1 from dbo\.appraisal_version where/g) === 1],
  ["2 inserts",           n(/insert into dbo\.appraisal/g) === 2],
  ["no dollar quoting left", !/\$j\$/.test(out)],
  ["no ::jsonb left",     !/::jsonb/.test(out)],
  ["no on conflict left", !/on conflict/.test(out)],
  ["no timestamptz left", !/timestamptz/.test(out)],
  ["transaction wrapped", /begin transaction;/.test(out) && /commit transaction;/.test(out)],
  ["no placeholder left", !/\u0000/.test(out)],
  ["quotes balanced per line", out.split("\n").every((l) => (l.match(/'/g) || []).length % 2 === 0)],
];
let fail = 0;
for (const [label, okay] of checks) { if (!okay) fail++; console.log((okay ? "  ok   " : "  FAIL ") + label); }
console.log(`  ${(out.length / 1024).toFixed(0)} kB written`);
process.exit(fail ? 1 : 0);
