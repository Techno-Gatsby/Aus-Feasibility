const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");

const port = process.env.PORT || process.env.WEBSITES_PORT || 8080;
const root = __dirname;

/* The appraisal store and the access-control layer. api/ is ESM and this file
   is CommonJS, so both are pulled in with a dynamic import once at startup
   rather than required.

   If either import fails - api/ not deployed, or a dependency not installed -
   its routes stay off and answer 404, and (for access.mjs) the page gate
   below fails closed rather than silently opening every page - see
   accessEnforced() and gateStaticFile(). */
let appraisals = null;
const apiReady = import("./api/appraisals.mjs")
  .then((m) => { appraisals = m.handle; console.log("Appraisal store routes enabled"); })
  .catch((err) => { console.error("Appraisal store disabled:", err.message); });

let access = null;
let grantsFor = null;
const accessReady = import("./api/access.mjs")
  .then((m) => { access = m.handle; grantsFor = m.grantsFor; console.log("Access control routes enabled"); })
  .catch((err) => { console.error("Access control disabled:", err.message); });

/* ─────────────────────────────────────────────────────────────────────────
   Whether the gate actually turns anyone away.

   Off by default, so deploying this file changes nothing on its own - the
   plan's own sequencing (api/README.md) runs the port and the schema first,
   watches /api/me work, seeds an admin, and only then flips this. Two ways to
   flip it, checked in order:

     1. ACCESS_ENFORCE=1 as an app setting - the normal path, but app settings
        need the portal.
     2. wwwroot/access.config.json, { "enforce": true } - a plain file next to
        this one, so a single Kudu PUT can turn enforcement on or back off
        without portal access, which matters if the gate ever needs to be
        killed in a hurry and nobody with portal access is on hand. Re-read at
        most once every five seconds rather than on every request.
   ───────────────────────────────────────────────────────────────────────── */
const CONFIG_PATH = path.join(root, "access.config.json");
let configCache = { at: 0, enforce: null };

function accessEnforced() {
  if (process.env.ACCESS_ENFORCE === "1") return true;
  if (process.env.ACCESS_ENFORCE === "0") return false;
  const now = Date.now();
  if (now - configCache.at > 5000) {
    configCache = { at: now, enforce: false };
    try {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      configCache.enforce = raw.enforce === true;
    } catch (e) {
      /* no file, or unreadable - enforcement stays off, which is the same
         "behaves as before" default as never having deployed this at all */
    }
  }
  return configCache.enforce;
}

/* Which static file needs which region. Keyed on the resolved file name, not
   the request path, so /us, /usa and /us.html - anything resolveRequestPath
   maps to the same file - are covered by one entry. */
const GATED_REGION = { "us.html": "US", "australia.html": "AU" };

function sendRedirect(res, location) {
  res.writeHead(302, { Location: location, "Cache-Control": "no-store" });
  res.end();
}

function sendSmallHtml(res, status, html) {
  res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" });
  res.end(html);
}

/* Serves no-access.html itself with the given status, or a minimal inline
   fallback if that file is somehow missing - a gate that cannot explain
   itself should still gate. */
function sendNoAccess(res, status) {
  const p = path.join(root, "no-access.html");
  if (fs.existsSync(p)) {
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" });
    fs.createReadStream(p).pipe(res);
  } else {
    sendSmallHtml(res, status, "<!doctype html><title>No access</title><p>You do not have access to this yet.</p>");
  }
}

/* Returns true if this response has been fully handled (redirected, denied,
   or the request could not be evaluated) - the caller should stop. Returns
   false to mean "proceed with the normal static file response", which is
   both the not-gated case and the has-access case. */
async function gateStaticFile(req, res, fileName) {
  if (!accessEnforced()) return false;

  const region = GATED_REGION[fileName];
  const isAdminPage = fileName === "admin.html";
  if (!region && !isAdminPage) return false;

  await accessReady;
  if (!grantsFor) {
    /* Enforcement is on but the access module never loaded - fail CLOSED.
       An open gate that only looks closed is worse than an outage, and an
       outage here is recoverable in one Kudu PUT via access.config.json. */
    sendSmallHtml(res, 503, "<!doctype html><title>Unavailable</title><p>Access control is enabled but unavailable. Try again shortly.</p>");
    return true;
  }

  let caller;
  try {
    caller = await grantsFor(req);
  } catch (err) {
    console.error("[gate] grantsFor failed:", err.message);
    sendSmallHtml(res, 503, "<!doctype html><title>Unavailable</title><p>Access control is enabled but unavailable. Try again shortly.</p>");
    return true;
  }

  if (!caller) {
    sendRedirect(res, "/login?redirect=" + encodeURIComponent(req.url || "/"));
    return true;
  }

  /* A temporary password (new account, or an admin's reset) must be changed
     before anything else, not just on whichever path Landing.html happens to
     be on - otherwise a bookmarked /australia would let it be skipped. */
  if (caller.mustChangePassword) {
    sendRedirect(res, "/change-password?redirect=" + encodeURIComponent(req.url || "/"));
    return true;
  }

  if (isAdminPage) {
    if (caller.isAdmin) return false;
    sendSmallHtml(res, 403, "<!doctype html><title>Admins only</title><p>This page is for admins only.</p>");
    return true;
  }

  if (caller.disabled || !caller.regions.has(region)) {
    sendNoAccess(res, 403);
    return true;
  }

  return false;
}

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
};

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  const aliases = {
    "/": "/sobha-login-region.html",
    "/landing": "/index.html",
    "/landing/": "/index.html",
    "/landing.html": "/index.html",
    "/sobha-login-region": "/sobha-login-region.html",
    "/sobha-login-region/": "/sobha-login-region.html",
    "/sobha-login-region.html": "/sobha-login-region.html",
    "/login": "/sobha-login-region.html",
    "/login/": "/sobha-login-region.html",
    "/login.html": "/sobha-login-region.html",
    "/change-password": "/change-password.html",
    "/change-password/": "/change-password.html",
    "/us": "/us.html",
    "/us/": "/us.html",
    "/us.html": "/us.html",
    "/usa": "/us.html",
    "/usa/": "/us.html",
    "/usa.html": "/us.html",
    "/australia": "/australia.html",
    "/australia/": "/australia.html",
    "/au": "/australia.html",
    "/au/": "/australia.html",
    "/au.html": "/australia.html",
    "/admin": "/admin.html",
    "/admin/": "/admin.html",
    "/no-access": "/no-access.html",
    "/no-access/": "/no-access.html",
  };
  const requestedPath = aliases[pathname.toLowerCase()] || pathname;
  const filePath = path.normalize(path.join(root, requestedPath));

  if (!filePath.startsWith(root)) {
    return path.join(root, "index.html");
  }

  return fs.existsSync(filePath) && fs.statSync(filePath).isFile()
    ? filePath
    : path.join(root, "index.html");
}

http
  .createServer(async (req, res) => {
    /* Before the method guard below, which allows only GET and HEAD - the
       store and the access routes are both written to with POST and PUT (and
       DELETE, for the store). appraisals.mjs is tried first only because it
       existed first; the two route sets are disjoint (/api/appraisals* vs
       /api/me, /api/access-requests, /api/admin/*), so the order does not
       matter to either. */
    if ((req.url || "").startsWith("/api/")) {
      await Promise.all([apiReady, accessReady]);
      if (appraisals && (await appraisals(req, res))) return;
      if (access && (await access(req, res))) return;
      res.writeHead(404, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify({ error: "Not enabled here." }));
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" });
      res.end();
      return;
    }

    const filePath = resolveRequestPath(req.url);
    const fileName = path.basename(filePath).toLowerCase();

    if (await gateStaticFile(req, res, fileName)) return;

    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";
    /* A gated file must never be cached and handed to whoever asks next - by
       a shared cache, or by the browser's back button after signing out. Every
       other asset keeps the long-lived immutable cache it had before. */
    const gated = GATED_REGION[fileName] || fileName === "admin.html" || fileName === "no-access.html";

    const headers = {
      "Content-Type": contentType,
      "Cache-Control": gated
        ? "private, no-store"
        : extension === ".html"
        ? "no-cache"
        : "public, max-age=31536000, immutable",
    };
    if (gated) headers.Vary = "Cookie";
    res.writeHead(200, headers);

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  })
  .listen(port, () => {
    console.log(`Land Feasibility app listening on ${port}`);
  });
