'use client';

/* The parcel strip: one tab per parcel in the project, plus Add and Duplicate.
 *
 * A tab carries the parcel's name and its last known equity IRR, so the value
 * of the thing you are switching away from stays visible. Removing a parcel
 * asks first and is only offered while more than one exists — a modelled
 * parcel lost to a stray click cannot be recovered.
 *
 * Double-click a tab to rename it in place; the header field renames the
 * active one too. */

import { useEffect, useRef, useState } from 'react';
import { useProject } from '@/lib/project';

const CSS = `
.ptabs{display:flex;align-items:stretch;gap:6px;overflow-x:auto;background:var(--bg);
  border-bottom:1px solid var(--line);padding:8px 16px}
.ptab{position:relative;display:flex;flex-direction:column;justify-content:center;gap:2px;
  border:1px solid var(--line);background:var(--paper);border-radius:var(--r-sm);
  padding:7px 26px 7px 12px;min-height:44px;min-width:132px;max-width:230px;text-align:left;
  cursor:pointer;flex:none;color:var(--ink-2)}
.ptab:hover{border-color:var(--line-2)}
.ptab[aria-current=true]{border-color:var(--accent);box-shadow:0 0 0 2px rgba(55,138,221,.16);
  color:var(--ink)}
.ptab .nm{font:600 12.5px var(--sans);letter-spacing:-.008em;white-space:nowrap;overflow:hidden;
  text-overflow:ellipsis}
.ptab .kv{font:400 11px var(--sans);color:var(--mute);font-variant-numeric:tabular-nums}
.ptab .x{position:absolute;top:4px;right:4px;width:18px;height:18px;border:0;border-radius:5px;
  background:transparent;color:var(--faint);font:600 13px/1 var(--sans);cursor:pointer;
  display:grid;place-items:center}
.ptab .x:hover{background:var(--bad-bg);color:var(--bad)}
.ptab .rn{border:1px solid var(--accent);border-radius:6px;font:600 12.5px var(--sans);
  padding:3px 5px;width:100%;min-width:0;color:var(--ink);background:var(--paper)}
.ptab .rn:focus{outline:none;box-shadow:0 0 0 3px rgba(55,138,221,.18)}
.ptabs .act{border:1px dashed var(--line-2);background:transparent;border-radius:var(--r-sm);
  padding:7px 12px;min-height:44px;font:600 12px var(--sans);color:var(--mute);cursor:pointer;flex:none}
.ptabs .act:hover{background:var(--paper);color:var(--ink);border-color:var(--accent);border-style:solid}
`;

/* The engine returns rates as fractions; the tab shows whole percent, the same
   as the single-file build's P(v,0). */
function pct(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? '—' : `${(v * 100).toFixed(0)}%`;
}

export default function ParcelTabs() {
  const { parcels, activeIndex, stats, select, add, duplicate, remove, rename } = useProject();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const editRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (editing) editRef.current?.select(); }, [editing]);

  function commit() {
    if (editing) rename(editing, draft.trim() || 'New parcel');
    setEditing(null);
  }

  return (
    <div className="ptabs" role="tablist" aria-label="Parcels in this project">
      <style>{CSS}</style>

      {parcels.map((p, i) => {
        const s = stats[p.id];
        return (
          <div
            key={p.id}
            role="tab"
            tabIndex={0}
            aria-current={i === activeIndex}
            aria-selected={i === activeIndex}
            className="ptab"
            onClick={() => { if (editing !== p.id) select(i); }}
            onDoubleClick={() => { setEditing(p.id); setDraft(p.name); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(i); }
              if (e.key === 'F2') { e.preventDefault(); setEditing(p.id); setDraft(p.name); }
            }}
            title={p.loc ? `${p.name} — ${p.loc}` : p.name}
          >
            {editing === p.id ? (
              <input
                ref={editRef}
                className="rn"
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') commit();
                  if (e.key === 'Escape') setEditing(null);
                }}
                onClick={(e) => e.stopPropagation()}
                aria-label="Parcel name"
              />
            ) : (
              <>
                <span className="nm">{p.name}</span>
                <span className="kv">{s ? `Equity IRR ${pct(s.equityIrr)}` : p.loc || '—'}</span>
              </>
            )}

            {parcels.length > 1 && editing !== p.id && (
              <button
                type="button"
                className="x"
                title={`Remove ${p.name}`}
                aria-label={`Remove ${p.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!window.confirm(`Remove ${p.name}? Its inputs cannot be recovered unless the project was saved.`)) return;
                  remove(p.id);
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}

      <button type="button" className="act" onClick={() => add()}>+ Add parcel</button>
      <button type="button" className="act" onClick={() => duplicate()} title="Copy the active parcel into a new one">
        ⧉ Duplicate
      </button>
    </div>
  );
}
