'use client';

/* ── project + parcels ──────────────────────────────────────────────────────
 *
 * A project is an ordered list of parcels. Each parcel carries its OWN copy of
 * the model inputs, plus the name and location shown in the header. This is the
 * `APP.parcels` / `APP.active` pair from the single-file build, with the same
 * behaviours: add, duplicate, rename, remove, switch, save to a .json file,
 * open one back, and reset the active parcel to the model defaults.
 *
 * The store lives outside React so that anything can read it — the consolidated
 * statements in particular need EVERY parcel, not just the one on screen. Read
 * it with `useProject()` for the live list, or `useParcelAnalyses()` for the
 * list already run through the engine.
 *
 * Inputs are the engine's own DEF shape: a flat map of finite numbers. That is
 * the whole contract, and it is what a loaded file is checked against.
 *
 * This module is client-only: it holds live state and uses useSyncExternalStore,
 * which the server build of React does not export. Server code that needs the
 * numbers should POST inputs to /api/model, the same as the page does.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
// @ts-ignore — the engine is untyped by design; see lib/engine/model.js
import { DEF, DEF_KEYS, AUSTRALIA_MODEL_VERSION } from '@/lib/engine/model.js';

const DEFAULTS = DEF as Record<string, number>;
const KEYS = DEF_KEYS as string[];
const KEYSET = new Set(KEYS);

export type Inputs = Record<string, number>;

export type Parcel = {
  id: string;
  name: string;
  loc: string;
  inputs: Inputs;
};

/** Small, cheap summary of a parcel's last model run. Kept for the tab strip;
 *  the full analysis is far too big to hold for every parcel. */
export type ParcelStat = {
  equityIrr: number | null;
  margin: number | null;
  npv: number | null;
  revenue: number | null;
};

export type ProjectState = {
  parcels: Parcel[];
  active: number;
  /** id -> last known headline numbers. Never persisted. */
  stats: Record<string, ParcelStat>;
};

export const FILE_APP_TAG = 'aus-land-feasibility';
export const FILE_VERSION = 1;
const STORAGE_KEY = 'ausfeas.project.v1';

/* ── helpers ─────────────────────────────────────────────────────────────── */

let idSeq = 0;
function newId(): string {
  idSeq += 1;
  // Random, because two browser tabs must not mint the same id into one file.
  return `p${Date.now().toString(36)}${idSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function num(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** Take only keys the engine knows, coerce to finite numbers, fill the rest
 *  from DEF. A partial object can never yield a half-populated model. */
export function normaliseInputs(raw: unknown): Inputs {
  const out: Inputs = { ...DEFAULTS };
  if (raw && typeof raw === 'object') {
    for (const k of KEYS) {
      if (Object.prototype.hasOwnProperty.call(raw, k)) {
        out[k] = num((raw as any)[k], DEFAULTS[k]);
      }
    }
  }
  return out;
}

/** The header strips the Business Plan suffix the source workbook carried. */
function cleanLoc(v: unknown): string {
  return String(v ?? '').replace(/\s*-\s*Business Plan\s+\d{2}\/\d{2}\/\d{4}\s*$/i, '').trim();
}

export function newParcel(name?: string, loc?: string, inputs?: unknown, id?: string): Parcel {
  return {
    id: id ?? newId(),
    name: String(name ?? '').trim() || 'New parcel',
    loc: cleanLoc(loc),
    inputs: normaliseInputs(inputs),
  };
}

/** Stable signature of a parcel's inputs — used to cache model runs. */
export function inputSignature(inputs: Inputs): string {
  let s = '';
  for (const k of KEYS) s += `${inputs[k] ?? '~'}`;
  return s;
}

function initialState(): ProjectState {
  // Fixed id on the seed parcel: the server and the client must render the
  // same thing before storage is read, or hydration complains.
  return { parcels: [newParcel('Parcel 1', '', undefined, 'p-seed')], active: 0, stats: {} };
}

/* ── store ───────────────────────────────────────────────────────────────── */

let state: ProjectState = initialState();
const serverState: ProjectState = state;
const listeners = new Set<() => void>();
let hydrated = false;

function emit() {
  for (const fn of listeners) fn();
}

function set(next: Partial<ProjectState>) {
  state = { ...state, ...next };
  emit();
  schedulePersist();
}

let persistTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePersist() {
  if (typeof window === 'undefined') return;
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      // stats are derived — persisting them would let a stale number outlive
      // the inputs that produced it.
      const { parcels, active } = state;
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: FILE_VERSION, parcels, active }));
    } catch {
      /* private mode / quota — the file save is the real save */
    }
  }, 300);
}

/** Read localStorage once, after mount. Anything unreadable is ignored: a
 *  corrupt autosave must not block the app from starting. */
function hydrateFromStorage() {
  if (hydrated || typeof window === 'undefined') return;
  hydrated = true;
  let text: string | null = null;
  try { text = window.localStorage.getItem(STORAGE_KEY); } catch { return; }
  if (!text) return;
  const parsed = parseProjectFile(text);
  if (!parsed.ok) return;
  state = { parcels: parsed.parcels, active: parsed.active, stats: {} };
  emit();
}

function clampActive(parcels: Parcel[], i: number) {
  return Math.max(0, Math.min(i, parcels.length - 1));
}

function indexOfId(id: string) {
  return state.parcels.findIndex((p) => p.id === id);
}

function replaceParcel(id: string, patch: (p: Parcel) => Parcel) {
  const i = indexOfId(id);
  if (i < 0) return;
  const parcels = state.parcels.slice();
  parcels[i] = patch(parcels[i]);
  set({ parcels });
}

export const projectStore = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => { listeners.delete(fn); };
  },
  getSnapshot(): ProjectState { return state; },
  getServerSnapshot(): ProjectState { return serverState; },
  hydrate: hydrateFromStorage,

  parcels(): Parcel[] { return state.parcels; },
  activeIndex(): number { return state.active; },
  activeParcel(): Parcel { return state.parcels[clampActive(state.parcels, state.active)]; },

  select(i: number) {
    const next = clampActive(state.parcels, i);
    if (next !== state.active) set({ active: next });
  },
  selectId(id: string) {
    const i = indexOfId(id);
    if (i >= 0) projectStore.select(i);
  },

  add(name?: string): Parcel {
    const p = newParcel(name ?? `Parcel ${state.parcels.length + 1}`, '');
    const parcels = [...state.parcels, p];
    set({ parcels, active: parcels.length - 1 });
    return p;
  },

  /** A duplicate is a NEW project that happens to start from the same numbers,
   *  so it gets its own id and a "(copy)" name — never a second view of one
   *  parcel, which would double-count it in the consolidated statements. */
  duplicate(id?: string): Parcel | null {
    const src = id ? state.parcels[indexOfId(id)] : projectStore.activeParcel();
    if (!src) return null;
    const p = newParcel(`${src.name} (copy)`, src.loc, { ...src.inputs });
    const parcels = [...state.parcels, p];
    set({ parcels, active: parcels.length - 1 });
    return p;
  },

  /** Refuses to remove the last parcel — a project with no parcels has no
   *  inputs to show. The confirmation prompt belongs to the UI. */
  remove(id: string): boolean {
    if (state.parcels.length < 2) return false;
    const i = indexOfId(id);
    if (i < 0) return false;
    const parcels = state.parcels.filter((p) => p.id !== id);
    const stats = { ...state.stats };
    delete stats[id];
    set({ parcels, active: clampActive(parcels, state.active > i ? state.active - 1 : state.active), stats });
    return true;
  },

  rename(id: string, name: string) {
    replaceParcel(id, (p) => ({ ...p, name: String(name) }));
  },
  setLoc(id: string, loc: string) {
    replaceParcel(id, (p) => ({ ...p, loc: String(loc) }));
  },

  setInputs(id: string, next: Inputs | ((old: Inputs) => Inputs)) {
    const i = indexOfId(id);
    if (i < 0) return;
    const old = state.parcels[i].inputs;
    const raw = typeof next === 'function' ? (next as (o: Inputs) => Inputs)(old) : next;
    if (raw === old) return;
    const parcels = state.parcels.slice();
    parcels[i] = { ...parcels[i], inputs: { ...raw } as Inputs };
    set({ parcels });
  },
  setField(id: string, key: string, value: any) {
    projectStore.setInputs(id, (old) => ({ ...old, [key]: value }));
  },

  /** Back to the model defaults, active parcel only — name and location keep. */
  reset(id?: string) {
    const target = id ?? projectStore.activeParcel()?.id;
    if (!target) return;
    replaceParcel(target, (p) => ({ ...p, inputs: { ...DEFAULTS } }));
  },

  /** Headline numbers from a finished model run, for the tab strip. */
  setStat(id: string, analysis: any) {
    if (indexOfId(id) < 0) return;
    const stat: ParcelStat = analysis
      ? {
          equityIrr: Number.isFinite(analysis.eirr) ? analysis.eirr : null,
          margin: Number.isFinite(analysis.margin) ? analysis.margin : null,
          npv: Number.isFinite(analysis.npv) ? analysis.npv : null,
          revenue: Number.isFinite(analysis.revenue) ? analysis.revenue : null,
        }
      : { equityIrr: null, margin: null, npv: null, revenue: null };
    state = { ...state, stats: { ...state.stats, [id]: stat } };
    emit(); // derived — no persist
  },

  /** Replace the whole project, e.g. after a file has been opened. */
  load(parcels: Parcel[], active = 0) {
    if (!parcels.length) return;
    set({ parcels, active: clampActive(parcels, active), stats: {} });
  },

  toFile(): ProjectFile {
    return {
      app: FILE_APP_TAG,
      v: FILE_VERSION,
      modelVersion: String(AUSTRALIA_MODEL_VERSION ?? ''),
      savedAt: new Date().toISOString(),
      active: state.active,
      parcels: state.parcels.map((p) => ({ id: p.id, name: p.name, loc: p.loc, inputs: p.inputs })),
    };
  },
};

export type ProjectFile = {
  app: string;
  v: number;
  modelVersion: string;
  savedAt: string;
  active: number;
  parcels: { id: string; name: string; loc: string; inputs: Inputs }[];
};

/* ── file validation ─────────────────────────────────────────────────────────
 *
 * A file arriving from a picker is a stranger. It is checked all the way down
 * before a single number reaches the model, and a rejection says exactly what
 * was wrong — a file that half-loads is worse than one that does not load,
 * because the resulting statements look real.
 */

export type ParseResult =
  | { ok: true; parcels: Parcel[]; active: number; warnings: string[] }
  | { ok: false; error: string };

/** How many recognised fields an object needs before we will call it an
 *  appraisal. Well under the real count (hundreds), far above coincidence. */
const MIN_RECOGNISED = 8;

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'missing';
  if (Array.isArray(v)) return 'an array';
  return `a ${typeof v}`;
}

function countRecognised(o: Record<string, unknown>): number {
  let n = 0;
  for (const k of Object.keys(o)) if (KEYSET.has(k)) n += 1;
  return n;
}

function checkInputs(raw: unknown, where: string): { ok: true; inputs: Inputs; warnings: string[] } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: `${where} has no "inputs" object — its inputs are ${typeName(raw)}.` };
  }
  const o = raw as Record<string, unknown>;
  const keys = Object.keys(o);
  if (!keys.length) return { ok: false, error: `${where} has an empty "inputs" object, so there is nothing to model.` };

  const recognised = countRecognised(o);
  if (recognised < MIN_RECOGNISED) {
    return {
      ok: false,
      error:
        `${where} does not look like an appraisal: only ${recognised} of its ${keys.length} field(s) ` +
        `are fields this model has (at least ${MIN_RECOGNISED} expected, e.g. ${KEYS.slice(0, 4).join(', ')}).`,
    };
  }

  // Every model input is a number. A string or null here means the file was
  // written by something else, and silently coercing it would invent a figure.
  const bad: string[] = [];
  for (const k of keys) {
    if (!KEYSET.has(k)) continue;
    const v = o[k];
    if (v === null || v === '' || typeof v === 'object' || !Number.isFinite(Number(v))) {
      bad.push(`${k} (${JSON.stringify(v)})`);
    }
  }
  if (bad.length) {
    const shown = bad.slice(0, 5).join(', ');
    return {
      ok: false,
      error: `${where} has ${bad.length} field(s) that are not numbers: ${shown}${bad.length > 5 ? ', …' : ''}.`,
    };
  }

  const unknown = keys.filter((k) => !KEYSET.has(k));
  const warnings = unknown.length
    ? [`${where}: ${unknown.length} field(s) this model does not use were ignored (${unknown.slice(0, 3).join(', ')}${unknown.length > 3 ? ', …' : ''}).`]
    : [];
  return { ok: true, inputs: normaliseInputs(o), warnings };
}

export function parseProjectFile(text: string): ParseResult {
  let j: unknown;
  try {
    j = JSON.parse(text);
  } catch (e: any) {
    return { ok: false, error: `That file is not valid JSON — ${String(e?.message ?? e)}.` };
  }

  if (!j || typeof j !== 'object' || Array.isArray(j)) {
    return { ok: false, error: `A saved appraisal is a JSON object; this file's top level is ${typeName(j)}.` };
  }

  const top = j as Record<string, any>;
  const warnings: string[] = [];
  let rawParcels: any[];

  if (Array.isArray(top.parcels)) {
    if (!top.parcels.length) return { ok: false, error: 'That file has an empty "parcels" array, so there is nothing to open.' };
    rawParcels = top.parcels;
  } else if (top.inputs && typeof top.inputs === 'object') {
    // The single-parcel shape the older builds wrote.
    rawParcels = [{ name: top.name, loc: top.loc, inputs: top.inputs }];
  } else if (countRecognised(top) >= MIN_RECOGNISED) {
    // A bare inputs object. Unambiguous, but say so rather than pretend it
    // was a project file.
    rawParcels = [{ name: 'Imported parcel', loc: '', inputs: top }];
    warnings.push('The file held a bare set of inputs rather than a project, so it was opened as a single parcel.');
  } else {
    const keys = Object.keys(top).slice(0, 6).join(', ') || 'none';
    return {
      ok: false,
      error: `That file has neither a "parcels" array nor an "inputs" object, so there is nothing to open. Top-level keys found: ${keys}.`,
    };
  }

  const parcels: Parcel[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawParcels.length; i++) {
    const p = rawParcels[i];
    const label = `Parcel ${i + 1}`;
    if (!p || typeof p !== 'object' || Array.isArray(p)) {
      return { ok: false, error: `${label} is ${typeName(p)}, not an object.` };
    }
    const name = typeof p.name === 'string' && p.name.trim() ? p.name.trim() : '';
    const where = name ? `${label} ("${name}")` : label;
    if (p.name != null && typeof p.name !== 'string') warnings.push(`${label}: the name was ${typeName(p.name)}, not text, so a default was used.`);
    if (p.loc != null && typeof p.loc !== 'string') warnings.push(`${where}: the location was ${typeName(p.loc)}, not text, so it was dropped.`);

    const res = checkInputs(p.inputs, where);
    if (!res.ok) return { ok: false, error: res.error };
    warnings.push(...res.warnings);

    let id = typeof p.id === 'string' && p.id ? p.id : newId();
    if (seen.has(id)) { warnings.push(`${where}: duplicate parcel id "${id}" was replaced.`); id = newId(); }
    seen.add(id);

    parcels.push({
      id,
      name: name || `Parcel ${i + 1}`,
      loc: typeof p.loc === 'string' ? cleanLoc(p.loc) : '',
      inputs: res.inputs,
    });
  }

  const active = Number.isFinite(Number(top.active)) ? clampActive(parcels, Math.round(Number(top.active))) : 0;
  return { ok: true, parcels, active, warnings };
}

/* ── save / open ─────────────────────────────────────────────────────────── */

export function projectFileName(name: string): string {
  const slug = String(name || 'appraisal').replace(/[^\w\d]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60);
  return `${slug || 'appraisal'}.json`;
}

/** Writes the whole project — every parcel — to a .json the user keeps. */
export function saveProjectToFile(): string {
  const file = projectStore.toFile();
  const name = projectFileName(projectStore.activeParcel()?.name ?? 'appraisal');
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return name;
}

export async function openProjectFile(file: File): Promise<{ ok: true; count: number; warnings: string[] } | { ok: false; error: string }> {
  let text: string;
  try {
    text = await file.text();
  } catch (e: any) {
    return { ok: false, error: `That file could not be read — ${String(e?.message ?? e)}.` };
  }
  if (!text.trim()) return { ok: false, error: `"${file.name}" is empty.` };
  const parsed = parseProjectFile(text);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  projectStore.load(parsed.parcels, parsed.active);
  return { ok: true, count: parsed.parcels.length, warnings: parsed.warnings };
}

/* ── React bindings ──────────────────────────────────────────────────────── */

function useProjectState(): ProjectState {
  const snap = useSyncExternalStore(projectStore.subscribe, projectStore.getSnapshot, projectStore.getServerSnapshot);
  useEffect(() => { projectStore.hydrate(); }, []);
  return snap;
}

export type UseProject = {
  parcels: Parcel[];
  activeIndex: number;
  active: Parcel;
  activeId: string;
  stats: Record<string, ParcelStat>;
  /** the active parcel's inputs — a drop-in for the page's `values` */
  values: Inputs;
  setValues: (next: Inputs | ((old: Inputs) => Inputs)) => void;
  setField: (key: string, value: any) => void;
  select: (i: number) => void;
  selectId: (id: string) => void;
  add: (name?: string) => void;
  duplicate: (id?: string) => void;
  remove: (id: string) => boolean;
  rename: (id: string, name: string) => void;
  setLoc: (id: string, loc: string) => void;
  reset: (id?: string) => void;
  setAnalysis: (id: string, analysis: any) => void;
  defaults: Inputs;
};

/** One hook for the whole project. The active parcel's inputs come back as
 *  `values` with a setState-shaped setter, so a page holding `useState` for
 *  inputs can swap to this without changing how it writes them. */
export function useProject(): UseProject {
  const s = useProjectState();
  const active = s.parcels[Math.max(0, Math.min(s.active, s.parcels.length - 1))];
  const activeId = active?.id ?? '';

  const setValues = useCallback(
    (next: Inputs | ((old: Inputs) => Inputs)) => projectStore.setInputs(projectStore.activeParcel().id, next),
    [],
  );
  const setField = useCallback((key: string, value: any) => projectStore.setField(projectStore.activeParcel().id, key, value), []);

  return {
    parcels: s.parcels,
    activeIndex: s.active,
    active,
    activeId,
    stats: s.stats,
    values: active?.inputs ?? ({ ...DEFAULTS } as Inputs),
    setValues,
    setField,
    select: projectStore.select,
    selectId: projectStore.selectId,
    add: projectStore.add,
    duplicate: projectStore.duplicate,
    remove: projectStore.remove,
    rename: projectStore.rename,
    setLoc: projectStore.setLoc,
    reset: projectStore.reset,
    setAnalysis: projectStore.setStat,
    defaults: DEFAULTS as Inputs,
  };
}

/** Just the list, for anything that only reads it. */
export function useParcels(): Parcel[] {
  return useProjectState().parcels;
}

/* ── every parcel, modelled ──────────────────────────────────────────────────
 *
 * The consolidated statements need an analysis per parcel, not one analysis.
 * This runs each parcel through the same POST /api/model the page uses — one
 * engine, one answer — and caches by input signature so switching tabs or
 * typing in one parcel does not re-run the others.
 */

export type ParcelRun = {
  parcel: Parcel;
  analysis: any | null;
  fyOfMonth: number[] | null;
  error: string | null;
};

const runCache = new Map<string, { analysis: any; fyOfMonth: number[] | null }>();
const errCache = new Map<string, string>();

async function runParcel(p: Parcel): Promise<ParcelRun> {
  const sig = inputSignature(p.inputs);
  const hit = runCache.get(sig);
  if (hit) return { parcel: p, analysis: hit.analysis, fyOfMonth: hit.fyOfMonth, error: null };
  const cachedErr = errCache.get(sig);
  if (cachedErr) return { parcel: p, analysis: null, fyOfMonth: null, error: cachedErr };

  try {
    const r = await fetch('/api/model', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputs: p.inputs }),
    });
    const j = await r.json();
    if (j?.ok) {
      const entry = { analysis: j.analysis, fyOfMonth: j.fyOfMonth ?? null };
      if (runCache.size > 40) runCache.clear();
      runCache.set(sig, entry);
      return { parcel: p, analysis: entry.analysis, fyOfMonth: entry.fyOfMonth, error: null };
    }
    const msg = String(j?.error ?? `Model failed (HTTP ${r.status})`);
    if (errCache.size > 40) errCache.clear();
    errCache.set(sig, msg);
    return { parcel: p, analysis: null, fyOfMonth: null, error: msg };
  } catch (e: any) {
    return { parcel: p, analysis: null, fyOfMonth: null, error: String(e?.message ?? e) };
  }
}

/** Every parcel run through the engine. `enabled` lets a consolidated view
 *  hold off until it is actually on screen. */
export function useParcelAnalyses(enabled = true): { runs: ParcelRun[]; busy: boolean; refresh: () => void } {
  const parcels = useParcels();
  const [runs, setRuns] = useState<ParcelRun[]>([]);
  const [busy, setBusy] = useState(false);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  const key = parcels.map((p) => `${p.id}:${inputSignature(p.inputs)}`).join('');

  useEffect(() => {
    if (!enabled) return;
    const mine = ++seq.current;
    let dead = false;
    setBusy(true);
    Promise.all(parcels.map(runParcel))
      .then((out) => { if (!dead && mine === seq.current) setRuns(out); })
      .finally(() => { if (!dead && mine === seq.current) setBusy(false); });
    return () => { dead = true; };
    // `key` is the real dependency: identity changes on every keystroke, the
    // signature only when a number actually moved.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce]);

  const refresh = useCallback(() => { runCache.clear(); errCache.clear(); setNonce((n) => n + 1); }, []);
  return { runs, busy, refresh };
}
