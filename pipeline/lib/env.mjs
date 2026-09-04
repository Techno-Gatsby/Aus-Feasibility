/* Reads pipeline/.env without adding a dependency - the rest of this pipeline is
   dependency-free and one small parser is cheaper than pulling in dotenv.

   A real environment variable always wins, so the same code works on a developer
   machine and on the Azure deployment without a .env file existing at all.

   The token must never reach the browser. Australia_Land_Feasibility_.html ships
   to clients and already carries hardcoded Google and MapTiler keys; nothing here
   is ever injected into it. */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
let fileVars = null;

function loadFile() {
  if (fileVars) return fileVars;
  fileVars = {};
  const path = join(DIR, ".env");
  if (!existsSync(path)) return fileVars;
  for (const raw of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    /* Strip one layer of matching quotes; anything else is taken literally. */
    if (val.length > 1 && ((val[0] === '"' && val.endsWith('"')) || (val[0] === "'" && val.endsWith("'")))) {
      val = val.slice(1, -1);
    }
    fileVars[key] = val;
  }
  return fileVars;
}

export function env(name, fallback = undefined) {
  if (process.env[name] != null && process.env[name] !== "") return process.env[name];
  const v = loadFile()[name];
  return v != null && v !== "" ? v : fallback;
}

/* Fails loudly and tells you exactly what to do, rather than surfacing later as a
   confusing 401 from Apify. */
export function requireEnv(name) {
  const v = env(name);
  if (!v) {
    throw new Error(
      `${name} is not set.\n` +
      `  Create pipeline/.env with:  ${name}=your-token-here\n` +
      `  (copy pipeline/.env.example), or set it as an environment variable.\n` +
      `  .env is gitignored - never commit the token, and never put it in the HTML.`
    );
  }
  return v;
}

/* For logs and status endpoints: proves a token is loaded without printing it. */
export const redact = (s) => (!s ? "(unset)" : s.length <= 8 ? "***" : s.slice(0, 4) + "..." + s.slice(-2));
