/**
 * Local Claude bridge for the Australia land feasibility application.
 *
 *   cd assistant && node server.mjs
 *
 * Serves a small HTTP API on localhost that the chat panel inside the feasibility
 * HTML calls. Every response is CORS-open because the page is opened from disk and
 * therefore has a null origin.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { query } from "@anthropic-ai/claude-agent-sdk";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const RUNTIME = path.join(ROOT, "assistant-runtime");
const UPLOADS = path.join(RUNTIME, "uploads");
const CONTEXT = path.join(RUNTIME, "context");
const OUTPUT = path.join(RUNTIME, "output");
const STATE_FILE = path.join(CONTEXT, "state.json");
const PROPOSAL_FILE = path.join(CONTEXT, "proposal.json");

const PORT = Number(process.env.ASSISTANT_PORT || 8787);
const MODEL = process.env.ASSISTANT_MODEL || "claude-opus-5";
// low | medium | high | xhigh | max. Unset inherits the session default (high).
// Lower trades some care for speed; deck layout QA is the first thing to suffer.
const EFFORT = process.env.ASSISTANT_EFFORT || "";

for (const dir of [RUNTIME, UPLOADS, CONTEXT, OUTPUT]) fs.mkdirSync(dir, { recursive: true });

/** The feasibility app itself — largest .html at the project root. */
function findAppHtml() {
  const candidates = fs
    .readdirSync(ROOT)
    .filter((f) => f.toLowerCase().endsWith(".html"))
    .map((f) => ({ f, size: fs.statSync(path.join(ROOT, f)).size }))
    .sort((a, b) => b.size - a.size);
  return candidates.length ? path.join(ROOT, candidates[0].f) : null;
}
const APP_HTML = findAppHtml();

/* ── session continuity ─────────────────────────────────────────────── */
/** conversation key from the browser -> Claude Code session id */
const sessions = new Map();

/* ── system prompt ──────────────────────────────────────────────────── */

function systemAppend() {
  return `
You are the assistant embedded in the Sobha Australia land feasibility application.
You are answering inside a chat panel in that app, so keep replies tight and concrete.
Prefer plain prose. Use short markdown only where it genuinely helps.

## Who you are talking to

A property development professional using a land feasibility model. They care about
land economics, yield, cost, programme, funding and returns. They are not a
programmer and are not interested in how the app is built.

**Never put code in your answer.** No function names, variable names, field keys,
file paths, line numbers, snippets or syntax. Do not mention the HTML file, the state
snapshot, or any file at all. If you looked something up to be accurate, just give
the answer.

Explain in the language of the deal:

  Bad   "grossRevenue comes from sum("recog"), filled by R.recog[u.delivery] += u.salePrice"
  Good  "Gross realisation is every unit's sale price added up in the month it settles,
         not the month it is contracted. On this project that is A$843.5m across 151
         apartments."

Answer the question, give the number, and say what drives it. Lead with the figure
when there is one. Keep it short: a few sentences, or a table when you are comparing
things or breaking a total down. Offer the next useful step only when it is obvious.

Do not narrate what you are about to do, and do not describe where you are reading
from. If a figure is genuinely not available, say "I do not have the current figures
for that" and ask them to reopen the panel - never explain it in terms of snapshots,
files or payloads.

You may use markdown tables, lists, bold and headings. They render properly.

## Live project state

Read this file before answering anything numerical:
  ${STATE_FILE}

It is rewritten immediately before every turn, and it is small. It holds:
  headline   the key figures already formatted, in plain language. Most questions are
             answerable from this alone, so look here first
  fields     every input the app is showing, grouped by section, as
             [key, label, unit, current value]
  inputs     the raw input values
  outputs    the full appraisal result
  siteIntel  the map: address, suburb, LGA, zoning, FSR, height limits, site area,
             measured distances to stations, schools and shopping, ABS population
             and income

## When you need the mechanism

The model source is at ${APP_HTML}. Read it only when the user asks how something
works and the snapshot does not already tell you, and keep the search narrow. It is
a large file, so a targeted search beats reading it. Use what you find to explain the
logic in business terms; never show or name any of the code you read.

## Changing model inputs

You cannot touch the page. To change any input, write a proposal to:

  ${PROPOSAL_FILE}

  {
    "changes": [
      { "key": "pr", "label": "Land price excluding GST", "unit": "A$/sqm",
        "from": 11563.3, "to": 12000, "why": "one short sentence" }
    ],
    "note": "what this does to the headline numbers, one or two sentences"
  }

Rules:
  - "key" must be a real input key from the fields list. Never invent one.
  - "from" must be the current value.
  - "label" and "unit" are what the user sees, so use the field's proper label.
  - Never edit the model file to change an input. The proposal is the only route.
  - The user sees a diff card and clicks Apply or Discard. Tell them what you have
    proposed and what it does to the numbers, in plain language, then stop. Do not
    claim the change has been made, and do not mention the file you wrote.
  - If they are only asking what a change would do, answer in text. Do not write a
    proposal unless a change is actually wanted.

## Generating decks

Two skills are installed and are dispatched by the panel buttons:
  /lead-one-pager           E1, a 3-slide lead summary
  /d1-active-to-potential   D1, a 2-slide Active-to-Potential recommendation

Both follow .claude/skills/_shared/data-priority.md: the attached file wins, then
the application and its map, then web research, then leave it blank. Never invent
a number to fill a gap.

Write finished decks into:
  ${OUTPUT}

Print the absolute path of anything you generate as the last line of your reply so
the panel can offer it for download.

## Attachments

Files the user attaches are saved under:
  ${UPLOADS}

Read PDFs and images with the Read tool. Read PPTX, DOCX and XLSX with:
  node .claude/skills/_shared/read-pptx.mjs <path>
`.trim();
}

/* ── helpers ────────────────────────────────────────────────────────── */

/* ── market intel feed support ───────────────────────────────────────────
   Only these hosts may be fetched through /feed. Google News carries the
   per-city queries; the rest are trade press that publish their own feeds. */
const FEED_HOSTS = [
  "news.google.com",
  "afr.com", "theurbandeveloper.com", "sourceable.net", "architectureanddesign.com.au",
  "realestate.com.au", "domain.com.au", "propertyupdate.com.au", "brokernews.com.au",
  "bisnow.com", "therealdeal.com", "commercialobserver.com", "globest.com",
  "dallasnews.com", "bizjournals.com", "housingwire.com", "builderonline.com",
  "constructiondive.com", "multihousingnews.com", "rebusinessonline.com",
];
const FEED_TTL = 5 * 60 * 1000;   /* five minutes: fresh enough, and kind to the source */
const feedCache = new Map();

/* A small, deliberate parser. RSS and Atom differ in element names but agree on
   what an item is, so read both shapes into one. No XML library: the shapes we
   accept are narrow and a dependency here would have to be maintained. */
function parseFeed(xml) {
  const text = String(xml || "");
  const strip = (s) =>
    String(s == null ? "" : s)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
      .replace(/<[^>]*>/g, " ")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/&(amp|lt|gt|quot|apos|nbsp|#39);/gi, (m0, n) =>
        ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" }[String(n).toLowerCase()] || " "))
      .replace(/\s+/g, " ")
      .trim();
  const tag = (block, name) => {
    const m = block.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)</" + name + ">", "i"));
    return m ? strip(m[1]) : "";
  };
  const attr = (block, re) => { const m = block.match(re); return m ? m[1] : ""; };

  const blocks = [
    ...text.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...text.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const out = [];
  for (const b of blocks) {
    const title = tag(b, "title");
    if (!title) continue;
    /* RSS puts the URL in <link>, Atom in link/@href */
    const link = tag(b, "link") || attr(b, /<link[^>]*href="([^"]+)"/i);
    const dateRaw = tag(b, "pubDate") || tag(b, "published") || tag(b, "updated") || tag(b, "dc:date");
    const t = Date.parse(dateRaw);
    /* an image if the feed offers one, so a card is not a wall of text */
    const image =
      attr(b, /<media:content[^>]*url="([^"]+)"/i) ||
      attr(b, /<media:thumbnail[^>]*url="([^"]+)"/i) ||
      attr(b, /<enclosure[^>]*type="image[^"]*"[^>]*url="([^"]+)"/i) ||
      attr(b, /<enclosure[^>]*url="([^"]+)"[^>]*type="image/i) ||
      attr(b, /<img[^>]+src=["']([^"']+)["']/i);
    const summary = tag(b, "description") || tag(b, "summary") || tag(b, "content");
    out.push({
      title,
      link,
      date: Number.isFinite(t) ? new Date(t).toISOString() : null,
      source: tag(b, "source") || (() => { try { return new URL(link).hostname.replace(/^www\./, "") } catch { return "" } })(),
      summary: summary.slice(0, 320),
      image: image || null,
    });
  }
  out.sort((a, b) => (Date.parse(b.date || 0) || 0) - (Date.parse(a.date || 0) || 0));
  return out.slice(0, 60);
}

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
}

function json(res, code, body) {
  cors(res);
  const text = JSON.stringify(body);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(text);
}

function readBody(req, limitBytes = 128 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on("data", (c) => {
      total += c.length;
      if (total > limitBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch (e) {
        reject(new Error("Body is not valid JSON: " + e.message));
      }
    });
    req.on("error", reject);
  });
}

const safeName = (name) =>
  String(name || "file")
    .replace(/[^A-Za-z0-9 ._()-]+/g, "_")
    .slice(0, 120) || "file";

/** Deliverables only — build scripts and scratch files stay out of the chat. */
const DELIVERABLE = /\.(pptx|pdf|docx|xlsx|csv)$/i;

function listOutputs() {
  try {
    return fs
      .readdirSync(OUTPUT)
      .filter((f) => DELIVERABLE.test(f) && fs.statSync(path.join(OUTPUT, f)).isFile())
      .sort();
  } catch {
    return [];
  }
}

/* ── streaming a turn ───────────────────────────────────────────────── */

/** Human-readable one-liner for a tool call, shown as the activity line. */
function describeTool(name, input) {
  const i = input || {};
  const base = (p) => (p ? String(p).split(/[\\/]/).pop() : "");
  switch (name) {
    case "Read": return "Reading " + base(i.file_path);
    case "Write": return "Writing " + base(i.file_path);
    case "Edit": return "Editing " + base(i.file_path);
    case "Grep": return "Searching for " + (i.pattern || "");
    case "Glob": return "Looking for " + (i.pattern || "");
    case "Bash": return i.description || "Running a command";
    case "WebSearch": return "Searching the web for " + (i.query || "");
    case "WebFetch": return "Fetching " + (i.url || "");
    case "Skill": return "Running the " + (i.skill || i.command || "") + " skill";
    default: return name;
  }
}

/* One turn at a time. The state snapshot and the proposal file are single, shared
   paths, so two turns running together would read and delete each other's files. */
let turnLock = Promise.resolve();
function acquireTurn() {
  let release;
  const held = new Promise((r) => { release = r; });
  const waitFor = turnLock;
  turnLock = turnLock.then(() => held);
  return waitFor.then(() => release);
}

async function runTurn(res, { prompt, context, conversationKey, reset }) {
  cors(res);
  res.writeHead(200, {
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
  });

  const send = (obj) => {
    if (!res.writableEnded) res.write(JSON.stringify(obj) + "\n");
  };

  const waiting = turnLockBusy();
  if (waiting) send({ type: "activity", text: "Waiting for the current run to finish" });
  const release = await acquireTurn();
  try {
    await turnBody(send, { prompt, context, conversationKey, reset });
  } finally {
    release();
    res.end();
  }
}

let activeTurns = 0;
function turnLockBusy() { return activeTurns > 0; }

async function turnBody(send, { prompt, context, conversationKey, reset }) {
  activeTurns++;
  try {
    await turnBodyInner(send, { prompt, context, conversationKey, reset });
  } finally {
    activeTurns--;
  }
}

async function turnBodyInner(send, { prompt, context, conversationKey, reset }) {
  // Refresh the state snapshot the agent reads.
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(context ?? {}, null, 2), "utf8");
  } catch (e) {
    send({ type: "error", message: "Could not write the state snapshot: " + e.message });
  }
  try { fs.rmSync(PROPOSAL_FILE, { force: true }); } catch {}

  const before = new Set(listOutputs());
  const key = conversationKey || "default";
  if (reset) sessions.delete(key);
  const resume = sessions.get(key);

  const options = {
    cwd: ROOT,
    model: MODEL,
    settingSources: ["user", "project"],
    skills: "all",
    systemPrompt: { type: "preset", preset: "claude_code", append: systemAppend() },
    allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep", "WebSearch", "WebFetch", "Skill", "TodoWrite"],
    permissionMode: "bypassPermissions",
    allowDangerouslySkipPermissions: true,
    includePartialMessages: true,
    maxTurns: 80,
  };
  if (resume) options.resume = resume;
  if (EFFORT) options.effort = EFFORT;

  let text = "";
  try {
    for await (const m of query({ prompt, options })) {
      if (m.session_id) sessions.set(key, m.session_id);

      if (m.type === "system" && m.subtype === "init") {
        send({ type: "init", skills: m.skills || [], model: m.model, sessionId: m.session_id });
        continue;
      }

      // Token-level deltas.
      if (m.type === "stream_event") {
        const ev = m.event;
        if (ev?.type === "content_block_delta" && ev.delta?.type === "text_delta" && ev.delta.text) {
          text += ev.delta.text;
          send({ type: "delta", text: ev.delta.text });
        }
        continue;
      }

      if (m.type === "assistant" && m.message?.content) {
        for (const block of m.message.content) {
          if (block.type === "tool_use") {
            send({ type: "activity", text: describeTool(block.name, block.input) });
          }
        }
        continue;
      }

      if (m.type === "result") {
        // Fall back to the final result text if no deltas arrived.
        if (!text && typeof m.result === "string") send({ type: "delta", text: m.result });
        if (m.subtype && m.subtype !== "success") {
          send({ type: "error", message: "Run ended as " + m.subtype + ". " + (m.result || "") });
        }
        continue;
      }
    }
  } catch (e) {
    send({ type: "error", message: String(e?.message || e) });
  }

  // Any proposal the agent left behind.
  try {
    if (fs.existsSync(PROPOSAL_FILE)) {
      const raw = fs.readFileSync(PROPOSAL_FILE, "utf8");
      fs.rmSync(PROPOSAL_FILE, { force: true });
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.changes) && parsed.changes.length) {
        send({ type: "proposal", proposal: parsed });
      }
    }
  } catch (e) {
    send({ type: "error", message: "Proposal file was not valid JSON: " + e.message });
  }

  const fresh = listOutputs().filter((f) => !before.has(f));
  if (fresh.length) send({ type: "files", files: fresh });

  send({ type: "done", sessionId: sessions.get(key) || null });
}

/* ── routes ─────────────────────────────────────────────────────────── */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost:" + PORT);
  const route = url.pathname;

  if (req.method === "OPTIONS") {
    cors(res);
    res.writeHead(204);
    res.end();
    return;
  }

  try {
    if (route === "/health") {
      return json(res, 200, {
        ok: true,
        model: MODEL,
        root: ROOT,
        appHtml: APP_HTML,
        outputs: listOutputs(),
      });
    }

    /* ── market intel: RSS and Atom, fetched here rather than in the page ──
       News feeds do not send CORS headers, so a browser cannot read one directly.
       The bridge fetches it, parses it to JSON and answers with the CORS headers
       the page needs. Hosts are allowlisted so this cannot be used as an open
       proxy by anything else that finds the port. */
    if (route === "/feed" && req.method === "GET") {
      const target = String(url.searchParams.get("url") || "");
      let host = "";
      try { host = new URL(target).hostname.toLowerCase(); }
      catch { return json(res, 400, { error: "A valid feed url is required" }); }
      if (!FEED_HOSTS.some((h) => host === h || host.endsWith("." + h)))
        return json(res, 403, { error: "Feed host is not on the allowlist: " + host });

      const hit = feedCache.get(target);
      if (hit && Date.now() - hit.at < FEED_TTL)
        return json(res, 200, { items: hit.items, cached: true, host });

      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 15000);
        const r = await fetch(target, {
          signal: ctl.signal,
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; SobhaMarketIntel/1.0)",
            Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
          },
        });
        clearTimeout(timer);
        if (!r.ok) return json(res, 502, { error: "Feed returned HTTP " + r.status, host });
        const items = parseFeed(await r.text());
        feedCache.set(target, { at: Date.now(), items });
        return json(res, 200, { items, cached: false, host });
      } catch (e) {
        return json(res, 502, { error: String((e && e.message) || e), host });
      }
    }

    if (route === "/app" && req.method === "GET") {
      if (!APP_HTML) return json(res, 404, { error: "No HTML file found at the project root" });
      cors(res);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      fs.createReadStream(APP_HTML).pipe(res);
      return;
    }

    if (route === "/upload" && req.method === "POST") {
      const body = await readBody(req);
      const name = safeName(body.name);
      const target = path.join(UPLOADS, Date.now() + "-" + name);
      fs.writeFileSync(target, Buffer.from(String(body.dataBase64 || ""), "base64"));
      return json(res, 200, { path: target, name });
    }

    if (route === "/chat" && req.method === "POST") {
      const body = await readBody(req);
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      let prompt = String(body.message || "").trim();
      if (attachments.length) {
        prompt +=
          "\n\nAttached files:\n" + attachments.map((p) => "  " + p).join("\n");
      }
      if (!prompt) return json(res, 400, { error: "Nothing to send" });
      return runTurn(res, {
        prompt,
        context: body.context,
        conversationKey: body.conversationKey,
        reset: !!body.reset,
      });
    }

    if (route === "/skill" && req.method === "POST") {
      const body = await readBody(req);
      const skill = String(body.skill || "");
      if (!["lead-one-pager", "d1-active-to-potential"].includes(skill)) {
        return json(res, 400, { error: "Unknown skill: " + skill });
      }
      const attachments = Array.isArray(body.attachments) ? body.attachments : [];
      const extra = String(body.message || "").trim();

      let prompt = "/" + skill + "\n\n";
      prompt += attachments.length
        ? "Attached source documents:\n" + attachments.map((p) => "  " + p).join("\n") + "\n\n"
        : "No document was attached. Build the deck from the live application state in " +
          STATE_FILE +
          ", which holds the feasibility model and the Site Intelligence map for the active parcel.\n\n";
      if (extra) prompt += "Extra instructions from the user:\n" + extra + "\n\n";
      prompt +=
        "Follow .claude/skills/_shared/data-priority.md exactly, including its web " +
        "research budget. Work briskly: list the gaps first, send whatever searches " +
        "you need as one parallel batch, take one round of results, and never search " +
        "to re-confirm something the attachment or the model already told you. Leave " +
        "an unresolved field blank and list it on the verification checklist rather " +
        "than searching again or inventing a value.\n\n" +
        "Write the generator script to assistant/scripts/ and run it from assistant/, " +
        "so the pptxgenjs import resolves first time. Write the deck into " +
        OUTPUT +
        " and print its absolute path as the last line.";

      return runTurn(res, {
        prompt,
        context: body.context,
        conversationKey: body.conversationKey,
        reset: true,
      });
    }

    if (route === "/download" && req.method === "GET") {
      const name = path.basename(url.searchParams.get("f") || "");
      const file = path.join(OUTPUT, name);
      if (!name || !fs.existsSync(file)) return json(res, 404, { error: "Not found" });
      cors(res);
      res.writeHead(200, {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": 'attachment; filename="' + name + '"',
        "Content-Length": fs.statSync(file).size,
      });
      fs.createReadStream(file).pipe(res);
      return;
    }

    if (route === "/reveal" && req.method === "POST") {
      const body = await readBody(req);
      const name = path.basename(String(body.file || ""));
      const file = name ? path.join(OUTPUT, name) : OUTPUT;
      const args = fs.existsSync(file) && name ? ["/select,", file] : [OUTPUT];
      spawn("explorer.exe", args, { detached: true, stdio: "ignore" }).unref();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: "No route for " + route });
  } catch (e) {
    return json(res, 500, { error: String(e?.message || e) });
  }
});

server.on("error", (e) => {
  if (e && e.code === "EADDRINUSE") {
    console.error("Port " + PORT + " is already in use.");
    console.error("");
    console.error("The bridge is probably already running in another window - check for one");
    console.error("before starting a second. If you want a different port instead, run:");
    console.error("");
    console.error("  set ASSISTANT_PORT=8788 && node server.mjs");
    console.error("");
    console.error("and change BRIDGE at the top of the assistant-chat-runtime block in the");
    console.error("HTML to match.");
    process.exit(1);
  }
  console.error("The bridge could not start: " + (e && e.message ? e.message : e));
  process.exit(1);
});

server.listen(PORT, "127.0.0.1", () => {
  console.log("Feasibility assistant bridge");
  console.log("  listening   http://localhost:" + PORT);
  console.log("  project     " + ROOT);
  console.log("  app         " + (APP_HTML || "not found"));
  console.log("  model       " + MODEL + (EFFORT ? "  (effort " + EFFORT + ")" : ""));
  console.log("  output      " + OUTPUT);
  console.log("");
  console.log("Open the feasibility HTML from disk, or http://localhost:" + PORT + "/app");
});
