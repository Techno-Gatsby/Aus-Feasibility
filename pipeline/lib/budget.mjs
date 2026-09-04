/* Spend control for the realestate.com.au scrape.

   Two jobs: refuse a run that would breach a cap, and keep an append-only record
   of every run that did happen. The ledger is JSON Lines so a crashed run can
   never corrupt earlier entries - the worst case is one unreadable last line.

   The caps are deliberately low. Cost per LGA varies enormously (Woollahra is
   about ten suburbs, Brisbane City about 190), so a single careless request can
   cost more than a month of ordinary use. Nothing spends without passing
   preflight() first. */
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { env } from "./env.mjs";

const PIPELINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const REA_ROOT = join(PIPELINE, "..", "assistant-runtime", "rea");
const LEDGER = join(REA_ROOT, "usage.jsonl");

export function loadConfig() {
  const cfg = JSON.parse(readFileSync(join(PIPELINE, "rea.config.json"), "utf8"));
  const numeric = {
    monthlyItemBudget: "REA_MONTHLY_ITEM_BUDGET",
    maxItemsPerRun: "REA_MAX_ITEMS_PER_RUN",
    maxSuburbsPerRun: "REA_MAX_SUBURBS_PER_RUN",
    cacheTtlDays: "REA_CACHE_TTL_DAYS",
  };
  for (const [key, varName] of Object.entries(numeric)) {
    const v = env(varName);
    if (v != null && v !== "" && Number.isFinite(+v)) cfg[key] = +v;
  }
  return cfg;
}

export const monthKey = (d = new Date()) =>
  `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

export function readLedger() {
  if (!existsSync(LEDGER)) return [];
  return readFileSync(LEDGER, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => { try { return JSON.parse(line); } catch { return null; } })
    .filter(Boolean);
}

export function appendRun(entry) {
  mkdirSync(REA_ROOT, { recursive: true });
  appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", "utf8");
}

/* Only items actually charged count against the budget. A run refused at
   preflight is recorded with itemsCharged 0 so the ledger shows the near-miss. */
export function monthUsage(month = monthKey()) {
  let items = 0, runs = 0;
  for (const r of readLedger()) {
    if (!String(r.at || "").startsWith(month)) continue;
    if (r.outcome === "refused") continue;
    items += Number(r.itemsCharged || 0);
    runs += 1;
  }
  return { month, items, runs };
}

export function budgetState(cfg = loadConfig()) {
  const used = monthUsage();
  return {
    month: used.month,
    monthlyItemBudget: cfg.monthlyItemBudget,
    itemsUsed: used.items,
    itemsRemaining: Math.max(0, cfg.monthlyItemBudget - used.items),
    runsThisMonth: used.runs,
    exhausted: used.items >= cfg.monthlyItemBudget,
  };
}

/* Called before any network request. Returns { ok, reason, estimate, budget }.
   ok:false is a normal outcome, not an error - the caller serves cache instead. */
export function preflight({ lga, suburbs }, cfg = loadConfig()) {
  const budget = budgetState(cfg);
  const n = Array.isArray(suburbs) ? suburbs.length : Number(suburbs || 0);
  const projectedItems = Math.min(n * cfg.assumedItemsPerSuburb, cfg.maxItemsPerRun);
  const estimate = { lga, suburbs: n, assumedItemsPerSuburb: cfg.assumedItemsPerSuburb, projectedItems };

  const refuse = (reason) => ({ ok: false, reason, estimate, budget });

  if (!n) return refuse(`No suburbs resolved for ${lga}. Build pipeline/out/lga-suburbs.json first.`);
  if (n > cfg.maxSuburbsPerRun)
    return refuse(`${lga} has ${n} suburbs, over the ${cfg.maxSuburbsPerRun}-suburb cap. ` +
                  `Raise maxSuburbsPerRun in pipeline/rea.config.json if this is intended.`);
  if (budget.exhausted)
    return refuse(`Monthly budget spent: ${budget.itemsUsed}/${budget.monthlyItemBudget} items in ${budget.month}.`);
  if (projectedItems > budget.itemsRemaining)
    return refuse(`Projected ${projectedItems} items exceeds the ${budget.itemsRemaining} left ` +
                  `of this month's ${budget.monthlyItemBudget}.`);

  return { ok: true, reason: null, estimate, budget };
}

export function formatPreflight(p) {
  const e = p.estimate, b = p.budget;
  return [
    `  LGA              ${e.lga}`,
    `  Suburbs          ${e.suburbs}`,
    `  Projected items  ${e.projectedItems} (at ~${e.assumedItemsPerSuburb}/suburb)`,
    `  Budget           ${b.itemsUsed}/${b.monthlyItemBudget} used this month, ${b.itemsRemaining} left`,
    p.ok ? "  Verdict          OK to run" : `  Verdict          REFUSED - ${p.reason}`,
  ].join("\n");
}
