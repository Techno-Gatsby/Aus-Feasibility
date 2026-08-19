'use client';

/* The frame of the single-file build.
 *
 *   header  — navy ribbon: title block, Project / Location, export buttons
 *   .parcels — the white parcel band
 *   .shell  — grid: input rail | drag handle | canvas
 *   .canvas — primary tabs, then the model-error slot, then the active pane
 *
 * The rail is part of the frame, not part of a pane, so it stays put while
 * the canvas changes underneath the tabs — exactly as the original does. */

import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { NAV, SubTabs, Tabs, PANE_HEAD, type GroupId, type PaneId } from '@/components/Nav';

const RAIL_MIN = 260;
const RAIL_MAX = 560;
const RAIL_DEF = 334;

/** Drive a ported pane's own tab strip from the shell's sub-tabs.
 *
 *  Statements and Statements2 each own their internal tab state and this
 *  file may not edit them, so the shell selects through their own controls:
 *  the very button a person would press. The strip itself is hidden in CSS,
 *  so what the user sees is one navigation, not two. The effect runs after
 *  every render and is a no-op once the wanted tab is already pressed. */
export function Route({ to, two, children }: {
  to: string;
  /** Sensitivity: One driver / Two drivers is a checkbox, not a tab. */
  two?: boolean;
  children: ReactNode;
}) {
  const host = useRef<HTMLDivElement | null>(null);
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const strip = el.querySelector('.stmts > .stmt-tabs');
    if (strip) {
      const want = Array.from(strip.querySelectorAll('button'))
        .find((b) => norm(b.textContent ?? '') === norm(to));
      if (want && want.getAttribute('aria-pressed') !== 'true') { want.click(); return; }
    }
    if (two !== undefined) {
      const box = el.querySelector<HTMLInputElement>('.sens-ctl label.chk input[type=checkbox]');
      if (box && box.checked !== two) box.click();
    }
  });

  return <div className="route" ref={host}>{children}</div>;
}

export default function Shell({
  group, pane, onGroup, onPane,
  fields, actions, parcels, kpis, rail, error, foot, children,
}: {
  group: GroupId;
  pane: PaneId;
  onGroup: (g: GroupId) => void;
  onPane: (p: PaneId) => void;
  /** Project / Location fields — ProjectBar. */
  fields?: ReactNode;
  /** Export buttons, right of the ribbon spacer. */
  actions?: ReactNode;
  /** The parcel band — ParcelTabs. */
  parcels?: ReactNode;
  /** Headline figures, or the engine's refusal to run. */
  kpis?: ReactNode;
  rail: ReactNode;
  error?: string | null;
  foot?: string;
  children: ReactNode;
}) {
  const shell = useRef<HTMLDivElement | null>(null);
  const g = NAV.find((x) => x.id === group) ?? NAV[0];
  const head = PANE_HEAD[pane];

  /* ---- the drag handle between the two scroll regions ---- */
  const setWidth = useCallback((px: number) => {
    const el = shell.current;
    if (!el) return;
    const w = Math.min(RAIL_MAX, Math.max(RAIL_MIN, Math.round(px)));
    el.style.setProperty('--input-rail-width', `${w}px`);
    const handle = el.querySelector('.rail-resizer');
    handle?.setAttribute('aria-valuenow', String(w));
  }, []);

  const drag = useRef(false);
  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    drag.current = true;
    document.body.classList.add('rail-resizing');
    e.currentTarget.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drag.current || !shell.current) return;
    setWidth(e.clientX - shell.current.getBoundingClientRect().left - 12);
  };
  const stop = () => { drag.current = false; document.body.classList.remove('rail-resizing'); };
  useEffect(() => () => document.body.classList.remove('rail-resizing'), []);

  return (
    <div className="app">
      <header className="au-header">
        <div className="hrow">
          <div className="brand">
            <h1>Land Feasibility</h1>
            <span className="sub">Land, lots and apartment development</span>
          </div>
          <span className="header-separator" aria-hidden="true" />
          {fields}
          <span className="spacer" />
          <span className="hacts">{actions}</span>
        </div>
        {parcels}
        {kpis}
      </header>

      <div className="shell work feas" ref={shell}>
        {rail}

        <div
          className="rail-resizer" role="separator" aria-orientation="vertical"
          aria-label="Resize input panel" tabIndex={0}
          aria-valuemin={RAIL_MIN} aria-valuemax={RAIL_MAX} aria-valuenow={RAIL_DEF}
          title="Drag to resize the input panel; double-click to reset"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={stop} onPointerCancel={stop}
          onDoubleClick={() => setWidth(RAIL_DEF)}
          onKeyDown={(e) => {
            const cur = Number(
              getComputedStyle(shell.current!).getPropertyValue('--input-rail-width').replace('px', ''),
            ) || RAIL_DEF;
            if (e.key === 'ArrowLeft') { e.preventDefault(); setWidth(cur - 16); }
            if (e.key === 'ArrowRight') { e.preventDefault(); setWidth(cur + 16); }
            if (e.key === 'Home') { e.preventDefault(); setWidth(RAIL_DEF); }
          }}
        />

        <main className="canvas">
          <Tabs at={group} onPick={onGroup} />

          {/* The engine's own words, above the pane, exactly where the
              single-file build put #model_error. Never summarised, never
              replaced by a zero. */}
          {error && <div className="goal miss" role="alert">Input check: {error}</div>}

          <div className="panes" id="panes">
            <section className={`pane on${pane === 'map' ? ' map' : ''}`} id={`p_${pane}`}>
              {head?.h && <h2 className="ph">{head.h}</h2>}
              {head?.d && <p className="pd">{head.d}</p>}
              <SubTabs group={g} sel={pane} onPick={onPane} />
              {children}
            </section>
          </div>

          {foot && <div className="foot">{foot}</div>}
        </main>
      </div>
    </div>
  );
}
