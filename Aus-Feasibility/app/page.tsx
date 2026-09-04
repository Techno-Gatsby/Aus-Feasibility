'use client';
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import SitePanel from '@/components/SitePanel';
import AreaPanel from '@/components/AreaPanel';
import SiteIntel from '@/components/SiteIntel';
import { type Group } from '@/components/InputRail';
import Kpis from '@/components/Kpis';
import Statements from '@/components/Statements';
import Statements2 from '@/components/Statements2';
import Verdict from '@/components/Verdict';
import ProjectBar from '@/components/ProjectBar';
import ParcelTabs from '@/components/ParcelTabs';
import InputRail2 from '@/components/InputRail2';
import Shell, { Route } from '@/components/Shell';
import { NAV, type GroupId, type PaneId } from '@/components/Nav';
import { Toaster, toast } from '@/components/Toast';
import { useProject, noteActiveAnalysis } from '@/lib/project';

const SiteMap = dynamic(() => import('@/components/SiteMap'), {
  ssr: false, loading: () => <div className="map-canvas skeleton" />,
});

/* Which internal tab of a ported pane each shell pane corresponds to. The
 * shell selects it through that component's own control; see Route. */
const S1: Partial<Record<PaneId, string>> = {
  pl: 'Profit and loss', cf: 'Cashflow', bs: 'Balance sheet',
  su: 'Sources and uses', debt: 'Debt and cover',
  sens: 'Sensitivity', two: 'Sensitivity', scn: 'Scenarios', opt: 'Optimiser',
};
const S2: Partial<Record<PaneId, string>> = {
  monthly: 'Monthly engine', offer: 'Land value',
  cpl: 'Consolidated P&L', ccf: 'Consolidated cashflow',
  cbs: 'Consolidated balance sheet', port: 'Project comparison',
};

export default function Page() {
  const [group, setGroup] = useState<GroupId>('verdict');
  const [sel, setSel] = useState<Record<GroupId, PaneId>>(
    () => NAV.reduce((m, g) => { m[g.id] = g.panes[0][0]; return m; }, {} as Record<GroupId, PaneId>),
  );
  const pane = sel[group];
  const pickPane = useCallback((p: PaneId) => setSel((s) => ({ ...s, [group]: p })), [group]);

  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [shapes, setShapes] = useState<any>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const { values, setValues, setField, parcels, active } = useProject();
  const [baseline, setBaseline] = useState<Record<string, any>>({});
  const [summary, setSummary] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [resolved, setResolved] = useState<any>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // schema drives the UI: the engine owns the field list, the UI does not
  // duplicate it. Add a field to the model and it appears here on its own.
  // It must NOT re-seed `values` — the project store already seeded the
  // parcels, and re-applying defaults on mount would wipe a restored session
  // or a file the user has only just opened.
  useEffect(() => {
    fetch('/api/model')
      .then((r) => r.json())
      .then((j) => { setGroups(j.groups ?? []); setBaseline(j.defaults ?? {}); })
      .catch((e) => setModelErr(`Could not load the model schema: ${e?.message ?? e}`));
  }, []);

  // map + panel share one analysis so they can never disagree
  useEffect(() => {
    if (!point) return;
    let dead = false;
    fetch(`/api/site?lat=${point.lat}&lng=${point.lng}`)
      .then((r) => r.json()).then((j) => { if (!dead) setShapes(j.shapes ?? null); })
      .catch(() => { if (!dead) setShapes(null); });
    return () => { dead = true; };
  }, [point]);

  // debounced recompute — the engine is fast but 491 fields means a keystroke
  // per character, and firing every one would queue dozens of runs
  const timer = useRef<any>(null);
  const seq = useRef(0);
  const recompute = useCallback((v: Record<string, any>) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const mine = ++seq.current;
      setBusy(true);
      try {
        const r = await fetch('/api/model', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inputs: v }),
        });
        const j = await r.json();
        if (mine !== seq.current) return;          // a newer run has landed
        if (j.ok) { setSummary(j.summary); setAnalysis(j.analysis); setResolved(j.fyOfMonth ?? null); setModelErr(null); noteActiveAnalysis(j.analysis); }
        else { setSummary(null); setAnalysis(null); setModelErr(j.error ?? 'Model failed'); }
      } catch (e: any) {
        if (mine === seq.current) setModelErr(String(e?.message ?? e));
      } finally { if (mine === seq.current) setBusy(false); }
    }, 350);
  }, []);

  useEffect(() => { if (Object.keys(values).length) recompute(values); }, [values, recompute]);

  const dirty = new Set(
    Object.keys(values).filter((k) => baseline[k] !== values[k]),
  );

  // pull the measured lot area straight into the model
  const applyArea = useCallback(async () => {
    if (!point) return;
    const j = await (await fetch(`/api/site?lat=${point.lat}&lng=${point.lng}`)).json();
    const m2 = j?.parcel?.areaM2;
    if (!m2) { toast.error('That lot has no measured area to apply.'); return; }
    setValues((v) => ({ ...v, acresGross: Math.round(m2), _acresNet: Math.round(m2) }));
    setGroup('verdict');
  }, [point, setValues]);

  /* ---- export buttons, in their legacy place at the right of the ribbon ---- */
  const grab = useCallback(async (path: string, ext: string) => {
    try {
      const r = await fetch(path, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: values, project: active?.name ?? 'Feasibility' }),
      });
      if (!r.ok) {
        let msg = String(r.status);
        try { msg = (await r.json()).error ?? msg; } catch { /* not JSON */ }
        toast.error(`Export failed: ${msg}`);
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(active?.name ?? 'feasibility').replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().slice(0, 10)}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(`Export failed: ${e?.message ?? e}`);
    }
  }, [values, active?.name]);

  /* ---- the other parcels, for the consolidation only ---- */
  const others = useMemo(
    () => (group === 'port'
      ? parcels.filter((p) => p.id !== active?.id).map((p) => ({ name: p.name, inputs: p.inputs }))
      : []),
    [group, parcels, active?.id],
  );

  const foot = `${active?.name || 'Untitled parcel'} · ${active?.loc || 'location not set'} · prepared ${
    new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  } · all amounts A$ · unlevered figures pre-tax, equity figures after tax and debt service · not a valuation or investment advice`;

  /* ---- the active pane. Statements and Statements2 keep stable keys so an
         instance survives a move between top-level tabs and only its internal
         selection changes. ---- */
  let body: React.ReactNode;
  if (pane === 'map') {
    body = (
      <>
        <div className="map-act">
          <button type="button" className="primary" onClick={applyArea} disabled={!point}>
            Use this lot →
          </button>
          <span className="note" style={{ margin: 0 }}>
            {point
              ? 'Writes the measured area into the appraisal and opens the Summary.'
              : 'Pick a lot on the map first.'}
          </span>
        </div>
        <div className="map-pane">
          <SiteMap onPick={setPoint} shapes={shapes} center={point} />
          <div className="panel-stack">
            <SitePanel point={point} />
            <SiteIntel point={point} />
            <AreaPanel point={point} />
          </div>
        </div>
      </>
    );
  } else if (modelErr) {
    body = (
      <p className="note">
        The model has not run, so this view has nothing to show. Nothing here has been
        filled with a zero — the figures are absent, not nil. Fix the input named above
        and the statements return.
      </p>
    );
  } else if (pane === 'verdict') {
    body = <Verdict analysis={analysis} inputs={values} fyOfMonth={resolved} error={modelErr} busy={busy} />;
  } else if (S2[pane]) {
    body = (
      <Route key="s2" to={S2[pane]!}>
        <Statements2
          analysis={analysis} fyOfMonth={resolved} inputs={values}
          parcels={others} parcelName={active?.name || 'Current scheme'}
        />
      </Route>
    );
  } else {
    body = (
      <Route key="s1" to={S1[pane]!} two={pane === 'two' ? true : pane === 'sens' ? false : undefined}>
        <Statements analysis={analysis} fyOfMonth={resolved} inputs={values} />
      </Route>
    );
  }

  return (
    <>
      <Shell
        group={group} pane={pane} onGroup={setGroup} onPane={pickPane}
        fields={<ProjectBar />}
        actions={
          <>
            <button type="button" className="hbtn" onClick={() => grab('/api/xlsx', 'xlsx')} disabled={!summary}>
              Download Excel (.xlsx)
            </button>
            <button type="button" className="hbtn solid" onClick={() => grab('/api/pdf', 'pdf')} disabled={!summary}>
              Download PDF
            </button>
          </>
        }
        parcels={<ParcelTabs />}
        kpis={<Kpis summary={summary} error={modelErr} busy={busy} inputs={values} />}
        rail={
          <InputRail2
            groups={groups} values={values} onChange={setField} dirtyKeys={dirty}
            defaults={baseline} onReplaceValues={setValues}
          />
        }
        error={modelErr}
        foot={foot}
      >
        {body}
      </Shell>
      <Toaster />
    </>
  );
}
