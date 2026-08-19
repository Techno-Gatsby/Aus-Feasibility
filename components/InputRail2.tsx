'use client';

/** The input rail shell from the single-file build, wrapped around the
 *  existing components/InputRail.tsx rather than replacing it.
 *
 *  InputRail owns the fields, the filter and each section's open state, and
 *  it does that well — rewriting it to add a chrome bar would have meant
 *  re-testing 491 fields to gain two buttons. So this is a wrapper: it adds
 *  what the HTML rail had and the React one does not —
 *
 *    · Collapse all / Expand all      (#btnCollapseInputs in the HTML)
 *    · collapse the whole rail panel  (#btnRailToggle, remembered across
 *      sessions in localStorage, exactly as the original did)
 *    · Save / Open / Reset            (the .io row)
 *    · the blue-is-input, grey-is-calculated legend
 *
 *  Collapse-all drives the child's own section buttons through the DOM
 *  (`.grp-h[aria-expanded]`), so the child stays the single source of truth
 *  for what is open; nothing here shadows its state and the two can never
 *  disagree. A MutationObserver watches those same attributes, so opening a
 *  section by hand flips this button back to "Collapse all" on its own.
 *
 *  SWAP IN: in app/page.tsx replace
 *      <InputRail groups={groups} values={values} onChange={setField} dirtyKeys={dirty} />
 *  with
 *      <InputRail2 groups={groups} values={values} onChange={setField}
 *                  dirtyKeys={dirty} defaults={baseline} onReplaceValues={setValues} />
 *  and change the import to `import InputRail2 from '@/components/InputRail2';`.
 *  `defaults` enables Reset and `onReplaceValues` enables Open; leave either
 *  out and that button simply is not offered.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import InputRail, { type Group } from '@/components/InputRail';
import { toast } from '@/components/Toast';

const RAIL_KEY = 'ausfeas.input-rail-collapsed';

export default function InputRail2({
  groups, values, onChange, dirtyKeys, defaults, onReplaceValues, title = 'Inputs',
}: {
  groups: Group[];
  values: Record<string, any>;
  onChange: (k: string, v: any) => void;
  dirtyKeys: Set<string>;
  /** Baseline model defaults — enables Reset. */
  defaults?: Record<string, any>;
  /** Bulk setter — enables Open (loading a saved appraisal). */
  onReplaceValues?: (values: Record<string, any>) => void;
  title?: string;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const file = useRef<HTMLInputElement | null>(null);
  const [allCollapsed, setAllCollapsed] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);

  const sections = useCallback(
    () => Array.from(host.current?.querySelectorAll<HTMLButtonElement>('.grp > .grp-h') ?? []),
    [],
  );

  /* label follows the sections, however they were opened ------------------ */
  const refresh = useCallback(() => {
    const s = sections();
    setAllCollapsed(s.length > 0 && s.every((b) => b.getAttribute('aria-expanded') === 'false'));
  }, [sections]);

  useEffect(() => {
    if (!host.current) return;
    refresh();
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; refresh(); });
    });
    observer.observe(host.current, {
      subtree: true, childList: true, attributes: true, attributeFilter: ['aria-expanded'],
    });
    return () => observer.disconnect();
  }, [refresh, groups]);

  const toggleAll = () => {
    const target = !allCollapsed;                      // true = collapse them
    const s = sections();
    if (!s.length) return;
    s.forEach((b) => {
      const open = b.getAttribute('aria-expanded') !== 'false';
      if (open === target) b.click();
    });
    // A live filter forces every matching section open, so the clicks above
    // are undone on the next render. Say so instead of looking broken.
    requestAnimationFrame(() => {
      const after = sections();
      const collapsed = after.length > 0 && after.every((b) => b.getAttribute('aria-expanded') === 'false');
      setAllCollapsed(collapsed);
      if (target && !collapsed) toast('Clear the filter first — matching sections stay open');
    });
  };

  /* whole-panel collapse, remembered between sessions --------------------- */
  useEffect(() => {
    let saved = false;
    try { saved = localStorage.getItem(RAIL_KEY) === '1'; } catch { /* private mode */ }
    setRailCollapsed(saved);
  }, []);

  useEffect(() => {
    document.body.classList.toggle('rail-collapsed', railCollapsed);
    try { localStorage.setItem(RAIL_KEY, railCollapsed ? '1' : '0'); } catch { /* private mode */ }
    // the map and any chart size themselves off the viewport; nudge them
    const kick = () => window.dispatchEvent(new Event('resize'));
    const a = requestAnimationFrame(kick);
    const b = setTimeout(kick, 220);
    return () => { cancelAnimationFrame(a); clearTimeout(b); };
  }, [railCollapsed]);

  useEffect(() => () => { document.body.classList.remove('rail-collapsed'); }, []);

  /* save / open / reset --------------------------------------------------- */
  const save = () => {
    const payload = JSON.stringify(
      { v: 1, savedAt: new Date().toISOString(), inputs: values }, null, 2,
    );
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `feasibility-inputs-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    toast.success(`Saved ${Object.keys(values).length} inputs`);
  };

  const open = (f: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const incoming = parsed?.inputs && typeof parsed.inputs === 'object' ? parsed.inputs : parsed;
        if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming))
          throw new Error('no inputs object in that file');
        // only keys the model knows about: a stray key would sit in state
        // for ever, invisible, and be posted to the engine on every run
        const known = new Set(Object.keys(defaults ?? values));
        const next: Record<string, any> = { ...values };
        let used = 0, skipped = 0;
        for (const [k, v] of Object.entries(incoming)) {
          if (!known.has(k)) { skipped++; continue; }
          next[k] = v; used++;
        }
        if (!used) throw new Error('none of those keys are model inputs');
        onReplaceValues?.(next);
        toast.success(`Loaded ${used} inputs${skipped ? ` · ${skipped} unknown key${skipped > 1 ? 's' : ''} ignored` : ''}`);
      } catch (e: any) {
        toast.error(`That file could not be read as a saved appraisal: ${e?.message ?? e}`);
      }
    };
    reader.onerror = () => toast.error('That file could not be read');
    reader.readAsText(f);
  };

  const reset = () => {
    if (!defaults) return;
    if (!confirm('Reset every input back to the model defaults?')) return;
    onReplaceValues?.({ ...defaults });
    toast('Inputs reset to model defaults');
  };

  const changed = dirtyKeys.size;

  return (
    <div className={`rail2${railCollapsed ? ' collapsed' : ''}`} ref={host}>
      <style dangerouslySetInnerHTML={{ __html: CSS }} />

      <div className="rail2-head">
        <span className="rail2-title">{title}</span>
        {changed > 0 && <span className="rail2-count">{changed} changed</span>}
        <span className="rail2-spacer" />
        <button
          type="button" className="rail2-btn" onClick={toggleAll} aria-pressed={allCollapsed}
          title={allCollapsed ? 'Expand all input sections' : 'Collapse all input sections'}
        >
          {allCollapsed ? 'Expand all' : 'Collapse all'}
        </button>
        <button
          type="button" className="rail2-toggle" onClick={() => setRailCollapsed((c) => !c)}
          aria-expanded={!railCollapsed}
          aria-label={railCollapsed ? 'Expand input panel' : 'Collapse input panel'}
          title={railCollapsed ? 'Expand input panel' : 'Collapse input panel'}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true" width="16" height="16">
            <path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="rail2-io">
        <button type="button" onClick={save}>Save</button>
        <button type="button" onClick={() => file.current?.click()} disabled={!onReplaceValues}
                title={onReplaceValues ? 'Load a saved appraisal' : 'Loading is not wired up on this page'}>
          Open
        </button>
        <button type="button" onClick={reset} disabled={!defaults || !onReplaceValues}
                title={defaults ? 'Back to model defaults' : 'Defaults are not available on this page'}>
          Reset
        </button>
        <input
          ref={file} type="file" accept="application/json,.json" hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) open(f);
            e.target.value = '';                     // same file twice must re-fire
          }}
        />
      </div>

      <div className="rail2-body">
        <InputRail groups={groups} values={values} onChange={onChange} dirtyKeys={dirtyKeys} />
      </div>

      <p className="rail2-legend">
        Editable figures are inputs; greyed figures are calculated by the model and
        cannot be typed over. A changed input is marked in blue until it is reset.
      </p>
    </div>
  );
}

/* Scoped to this wrapper, because app/globals.css belongs to another part of
   the build and the rail must not depend on an edit landing there. The one
   rule that reaches outside is the grid width — the column is defined on
   .work.feas, so collapsing the panel has to be expressed there. */
const CSS = `
.rail2{display:flex;flex-direction:column;min-height:0;background:var(--paper);
  border-right:1px solid var(--line)}
.rail2-head{display:flex;align-items:center;gap:8px;padding:9px 10px 9px 12px;
  border-bottom:1px solid var(--line);background:var(--paper)}
.rail2-title{font:600 13px var(--sans);letter-spacing:-.01em}
.rail2-count{font-size:11px;color:var(--accent-strong);font-weight:600}
.rail2-spacer{flex:1}
.rail2-btn{min-height:26px;padding:4px 9px;border:1px solid #bfd0e4;border-radius:5px;
  background:#f5f9fe;color:#17549b;font:700 9.4px var(--sans);letter-spacing:.045em;
  text-transform:uppercase;cursor:pointer;white-space:nowrap}
.rail2-btn:hover{background:#eaf3fe;border-color:#6f99cc;color:#0d4a91}
.rail2-toggle{display:grid;place-items:center;width:28px;min-height:28px;padding:0;
  border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--mute)}
.rail2-toggle:hover{background:var(--bg);color:var(--ink)}
.rail2-io{display:flex;gap:6px;padding:8px 12px;border-bottom:1px solid var(--line)}
.rail2-io button{flex:1;min-height:30px;padding:5px 8px;font-size:12px}
.rail2-body{flex:1;min-height:0;display:flex}
.rail2-body .rail{flex:1;border-right:0}
.rail2-legend{margin:0;padding:9px 12px;border-top:1px solid var(--line);
  color:var(--mute);font-size:11px;line-height:1.45;background:var(--paper)}

/* collapsed: keep only the chevron gutter, as the single-file build did */
.rail2.collapsed .rail2-title,
.rail2.collapsed .rail2-count,
.rail2.collapsed .rail2-btn,
.rail2.collapsed .rail2-io,
.rail2.collapsed .rail2-body,
.rail2.collapsed .rail2-legend{display:none}
.rail2.collapsed .rail2-head{padding:9px 6px;justify-content:center}
.rail2.collapsed .rail2-toggle svg{transform:rotate(180deg)}
@media(min-width:901px){
  body.rail-collapsed .work.feas{grid-template-columns:44px minmax(0,1fr)}
}
`;
