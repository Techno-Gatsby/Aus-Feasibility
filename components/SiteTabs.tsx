'use client';
import { useEffect, useState, type ReactNode } from 'react';

/** Shared furniture for the site intelligence panel.
 *
 *  This file exists to enforce one rule the panel kept getting wrong: a fact
 *  has FOUR states, not two, and they must never collapse into each other on
 *  screen.
 *
 *    ok           — the source answered and this is the figure.
 *    empty        — the source answered and had nothing to report. "None
 *                   mapped." It is NOT a clearance and is never drawn as 0.
 *    unavailable  — the source was asked and did not answer. The reason is
 *                   named. Nothing at all can be concluded from it.
 *    na           — never asked, because nothing is published for this place.
 *
 *  Each carries a glyph and words as well as a colour, so the distinction
 *  survives a greyscale print and a colour-blind reader. A figure that is
 *  unavailable is shown as absent, never as zero — an absent row is honest,
 *  a zero asserts a position.
 */

/* ------------------------------------------------------------- fetching */

export type Async<T> = { data: T | null; busy: boolean; err: string | null };

/** One fetch, three honest outcomes. `null` url means "nothing to ask yet",
 *  which is distinct from "asked and waiting". */
export function useJson<T>(url: string | null): Async<T> {
  const [s, setS] = useState<Async<T>>({ data: null, busy: false, err: null });

  useEffect(() => {
    if (!url) { setS({ data: null, busy: false, err: null }); return; }
    let dead = false;
    setS({ data: null, busy: true, err: null });

    fetch(url)
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (j == null) throw new Error(`HTTP ${r.status} — the response was not JSON`);
        // Some routes answer a non-2xx with a structured, meaningful body
        // (`applicable:false` = "this register does not cover this state").
        // That is an answer, not a failure, and must not be shown as one.
        if (!r.ok && !(j as any)?.applicable) {
          throw new Error((j as any)?.error ?? `HTTP ${r.status}`);
        }
        return j as T;
      })
      .then((d) => { if (!dead) setS({ data: d, busy: false, err: null }); })
      .catch((e) => { if (!dead) setS({ data: null, busy: false, err: String(e?.message ?? e) }); });

    return () => { dead = true; };
  }, [url]);

  return s;
}

/* ----------------------------------------------------------------- tabs */

export type TabDef = {
  id: string;
  label: string;
  /** A glanceable summary — "MU1", "2 flags", "not returned". Words, not a
   *  colour: `tone` only ever reinforces what the badge already says. */
  badge?: string | null;
  tone?: 'ok' | 'bad' | null;
};

export function SiteTabStrip({ tabs, active, onSelect }: {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="stabs" role="tablist" aria-label="Site intelligence sections">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          className={`stab${t.id === active ? ' on' : ''}`}
          aria-selected={t.id === active}
          onClick={() => onSelect(t.id)}
        >
          <span className="stab-l">{t.label}</span>
          {t.badge ? (
            <em className={`stab-b${t.tone ? ` ${t.tone}` : ''}`}>{t.badge}</em>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- facts */

export type FactState = 'ok' | 'empty' | 'unavailable' | 'na';

const MARK: Record<FactState, string> = {
  ok: '', empty: '○', unavailable: '⚠', na: '–',
};

/** A key/value row. `state` decides the glyph, the words and the colour
 *  together, so no caller can accidentally paint an unanswered query green. */
export function Fact({ k, v, state = 'ok', tone, glyph, sub }: {
  k: ReactNode;
  /** Omit for the non-ok states and a truthful default is supplied. */
  v?: ReactNode;
  state?: FactState;
  tone?: 'ok' | 'bad';
  /** Extra glyph for an `ok` value, so colour is never the only channel. */
  glyph?: string;
  sub?: ReactNode;
}) {
  const text: ReactNode =
    v != null ? v
      : state === 'unavailable' ? 'not returned'
      : state === 'empty' ? 'none mapped'
      : state === 'na' ? 'not published here'
      : '—';

  const cls =
    state === 'unavailable' ? 'bad'
      : state === 'empty' ? 'fact-empty'
      : state === 'na' ? 'fact-na'
      : tone ?? undefined;

  const mark = state === 'ok' ? (glyph ?? '') : MARK[state];

  return (
    <div className="row">
      <span>{k}</span>
      <b className={cls}>
        {mark ? <i className="fact-mark" aria-hidden="true">{mark}</i> : null}
        {text}
        {sub ? <em className="fact-sub">{sub}</em> : null}
      </b>
    </div>
  );
}

/** The failure banner. Says the query failed and names why — the one thing
 *  that separates it from an empty result. */
export function Failed({ what, why, children }: {
  what: string; why: string; children?: ReactNode;
}) {
  return (
    <p className="alert state-failed">
      <b>⚠ {what} did not answer.</b> {why}
      {' '}<b>Nothing can be read from this.</b> A failed query is not an empty
      result and is certainly not a clearance — re-run before relying on this
      section. {children}
    </p>
  );
}

/** The empty banner. Deliberately a different shape, colour and glyph from
 *  `Failed`: the source DID answer, and had nothing. */
export function Empty({ what, children }: { what: string; children?: ReactNode }) {
  return (
    <p className="note state-empty">
      <b>○ {what} answered, and has nothing mapped here.</b> {children}
    </p>
  );
}

export function Waiting({ what }: { what: string }) {
  return <p className="muted state-wait">Asking {what}…</p>;
}

/* ------------------------------------------------------- long lists */

/** Collapse a long list behind its own count. The count is always visible —
 *  it is the answer; the rows are the supporting detail. */
export function ShowAll<T>({ items, initial = 3, noun, render }: {
  items: T[];
  initial?: number;
  noun: string;
  render: (item: T, i: number) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, initial);
  return (
    <>
      {shown.map(render)}
      {items.length > initial && (
        <button type="button" className="show-all" aria-expanded={open}
                onClick={() => setOpen((o) => !o)}>
          {open ? `Show fewer` : `Show all ${items.length} ${noun}`}
        </button>
      )}
    </>
  );
}

/** Supporting prose that is true but rarely the thing being looked for.
 *  Folded away by default so the answer sits at the top of the tab. */
export function Detail({ label, children, open: initial = false }: {
  label: string; children: ReactNode; open?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="detail">
      <button type="button" className="detail-t" aria-expanded={open}
              onClick={() => setOpen((o) => !o)}>
        <i aria-hidden="true">{open ? '▾' : '▸'}</i>{label}
      </button>
      {open && <div className="detail-b">{children}</div>}
    </div>
  );
}
