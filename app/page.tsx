'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import dynamic from 'next/dynamic';
import SitePanel from '@/components/SitePanel';
import InputRail, { type Group } from '@/components/InputRail';
import Kpis from '@/components/Kpis';
import Statements from '@/components/Statements';

const SiteMap = dynamic(() => import('@/components/SiteMap'), {
  ssr: false, loading: () => <div className="map-canvas skeleton" />,
});

type Tab = 'site' | 'feasibility';

export default function Page() {
  const [tab, setTab] = useState<Tab>('site');
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [shapes, setShapes] = useState<any>(null);

  const [groups, setGroups] = useState<Group[]>([]);
  const [values, setValues] = useState<Record<string, any>>({});
  const [baseline, setBaseline] = useState<Record<string, any>>({});
  const [summary, setSummary] = useState<any>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [modelErr, setModelErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // schema drives the UI: the engine owns the field list, the UI does not
  // duplicate it. Add a field to the model and it appears here on its own.
  useEffect(() => {
    fetch('/api/model')
      .then((r) => r.json())
      .then((j) => { setGroups(j.groups ?? []); setValues(j.defaults ?? {}); setBaseline(j.defaults ?? {}); })
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
        if (j.ok) { setSummary(j.summary); setAnalysis(j.analysis); setModelErr(null); }
        else { setSummary(null); setAnalysis(null); setModelErr(j.error ?? 'Model failed'); }
      } catch (e: any) {
        if (mine === seq.current) setModelErr(String(e?.message ?? e));
      } finally { if (mine === seq.current) setBusy(false); }
    }, 350);
  }, []);

  useEffect(() => { if (Object.keys(values).length) recompute(values); }, [values, recompute]);

  const setField = useCallback((k: string, v: any) => {
    setValues((old) => ({ ...old, [k]: v }));
  }, []);

  const dirty = new Set(
    Object.keys(values).filter((k) => baseline[k] !== values[k]),
  );

  // pull the measured lot area straight into the model
  const applyArea = useCallback(async () => {
    if (!point) return;
    const j = await (await fetch(`/api/site?lat=${point.lat}&lng=${point.lng}`)).json();
    const m2 = j?.parcel?.areaM2;
    if (!m2) return;
    setValues((v) => ({ ...v, acresGross: Math.round(m2), _acresNet: Math.round(m2) }));
    setTab('feasibility');
  }, [point]);

  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Land Feasibility</h1>
          <span className="sub">Australia — NSW</span>
        </div>
        <nav className="tabs">
          <button onClick={() => setTab('site')} aria-pressed={tab === 'site'}>Site</button>
          <button onClick={() => setTab('feasibility')} aria-pressed={tab === 'feasibility'}>Feasibility</button>
        </nav>
        {point && tab === 'site' && (
          <button className="primary" onClick={applyArea}>Use this lot →</button>
        )}
      </header>

      {tab === 'feasibility' && <Kpis summary={summary} error={modelErr} busy={busy} />}

      <div className={`work${tab === 'feasibility' ? ' feas' : ''}`}>
        {tab === 'site' ? (
          <>
            <SiteMap onPick={setPoint} shapes={shapes} center={point} />
            <SitePanel point={point} />
          </>
        ) : (
          <>
            <InputRail groups={groups} values={values} onChange={setField} dirtyKeys={dirty} />
            <section className="results">
              {modelErr
                ? <p className="note">Fix the input on the left and the statements return.</p>
                : <Statements analysis={analysis} />}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
