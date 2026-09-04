/* Tiny HTTP helpers shared by appraisals.mjs and access.mjs - identical in
   both before this file existed, so factored out rather than kept in sync by
   hand. Nothing here is framework-specific; both callers stay written against
   Node's raw req/res. */

export const MAX_BODY = 8 * 1024 * 1024;

export const send = (res, status, body) => {
  const text = body === undefined ? "" : JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(text);
};

export function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let seen = 0;
    req.on("data", (c) => {
      seen += c.length;
      if (seen > MAX_BODY) { req.destroy(); reject(Object.assign(new Error("Request body is too large."), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch { reject(Object.assign(new Error("Body was not valid JSON."), { status: 400 })); }
    });
    req.on("error", reject);
  });
}
