/* On-disk cache for scraped realestate.com.au listings, keyed by LGA.

   The LGA is the unit of everything. One fetch covers every SA2 inside it, every
   later search of it, and every user - an SA2 never triggers a fetch of its own.
   That single decision is what keeps credit spend bounded.

   Snapshots are immutable: a refresh writes a NEW <YYYY-MM>.json and existing
   files are never overwritten or deleted. History accumulates, so re-deriving or
   re-parsing always reads disk and never the site.

   Nothing in this module makes a network request. If a code path needs data and
   the cache is cold, that is the caller's decision to escalate - reading must
   never silently spend money.

   Lives under assistant-runtime/, which is already gitignored: scraped
   third-party content should not be committed. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { REA_ROOT, loadConfig, monthKey } from "./budget.mjs";

export function splitLga(key) {
  const i = String(key).indexOf("|");
  if (i < 1) throw new Error(`LGA key must look like "NSW|Woollahra", got: ${key}`);
  return { state: key.slice(0, i).trim().toUpperCase(), name: key.slice(i + 1).trim() };
}

export const lgaSlug = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

export function lgaDir(key) {
  const { state, name } = splitLga(key);
  return join(REA_ROOT, state, lgaSlug(name));
}

const manifestPath = (key) => join(lgaDir(key), "manifest.json");

export function readManifest(key) {
  const p = manifestPath(key);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

/* Every snapshot on disk, oldest first. */
export function listSnapshots(key) {
  const dir = lgaDir(key);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .sort()
    .map((f) => ({ month: f.slice(0, 7), file: join(dir, f), bytes: statSync(join(dir, f)).size }));
}

const daysSince = (iso) => (!iso ? null : Math.floor((Date.now() - Date.parse(iso)) / 86400000));

/* Pure disk read - safe to call on every page load. */
export function cacheStatus(key, cfg = loadConfig()) {
  const snaps = listSnapshots(key);
  const man = readManifest(key);
  if (!snaps.length) {
    return { lga: key, cached: false, snapshots: 0, itemCount: 0, fetchedAt: null,
             ageDays: null, stale: false, ttlDays: cfg.cacheTtlDays };
  }
  const age = daysSince(man?.fetchedAt);
  return {
    lga: key,
    cached: true,
    snapshots: snaps.length,
    months: snaps.map((s) => s.month),
    itemCount: man?.itemCount ?? null,
    fetchedAt: man?.fetchedAt ?? null,
    ageDays: age,
    /* Stale is a label, never a trigger. Past the TTL the cache keeps serving and
       the card shows its age; only an explicit request refetches. */
    stale: age != null && age > cfg.cacheTtlDays,
    ttlDays: cfg.cacheTtlDays,
    suburbsReturned: man?.suburbsReturned ?? null,
    withheldPriceRate: man?.withheldPriceRate ?? null,
    truncated: man?.truncated ?? false,
  };
}

/* Merges every snapshot, newest winning per listing id, so a refresh corrects
   earlier records without discarding sales that have since dropped off the site. */
export function readCache(key) {
  const snaps = listSnapshots(key);
  if (!snaps.length) return { items: [], status: cacheStatus(key) };
  const byId = new Map();
  for (const s of snaps) {
    let parsed;
    try { parsed = JSON.parse(readFileSync(s.file, "utf8")); }
    catch { console.warn(`  unreadable snapshot, skipping: ${s.file}`); continue; }
    for (const it of parsed.items || []) {
      const id = it.listingId || it.id || `${it.address}|${it.soldDate}`;
      byId.set(id, { ...it, _snapshot: s.month });
    }
  }
  return { items: [...byId.values()], status: cacheStatus(key) };
}

export function writeSnapshot(key, items, meta = {}) {
  const dir = lgaDir(key);
  mkdirSync(dir, { recursive: true });
  const month = meta.month || monthKey();
  const file = join(dir, `${month}.json`);

  /* Immutable: never clobber an existing month. A second fetch in the same month
     is a correction, so it lands beside the first with a suffix and both survive. */
  let target = file, n = 1;
  while (existsSync(target)) target = join(dir, `${month}.${n++}.json`);

  writeFileSync(target, JSON.stringify({ lga: key, month, fetchedAt: new Date().toISOString(),
                                         ...meta, items }, null, 0));
  const manifest = {
    lga: key,
    fetchedAt: new Date().toISOString(),
    itemCount: (readCache(key).items || []).length,
    lastSnapshot: target.split(/[\/]/).pop(),
    ...meta,
  };
  writeFileSync(manifestPath(key), JSON.stringify(manifest, null, 2));
  return { file: target, manifest };
}

/* Which cached LGAs are past their TTL - for a deliberate batch refresh rather
   than an automatic one. */
export function staleLgas(cfg = loadConfig()) {
  if (!existsSync(REA_ROOT)) return [];
  const out = [];
  for (const state of readdirSync(REA_ROOT)) {
    const sp = join(REA_ROOT, state);
    if (!statSync(sp).isDirectory()) continue;
    for (const slug of readdirSync(sp)) {
      const man = (() => { try { return JSON.parse(readFileSync(join(sp, slug, "manifest.json"), "utf8")); } catch { return null; } })();
      if (!man?.lga) continue;
      const st = cacheStatus(man.lga, cfg);
      if (st.stale) out.push(st);
    }
  }
  return out.sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0));
}
