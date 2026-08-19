'use client';
import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import SitePanel from '@/components/SitePanel';

const SiteMap = dynamic(() => import('@/components/SiteMap'), {
  ssr: false,
  loading: () => <div className="map-canvas skeleton" />,
});

export default function Page() {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [shapes, setShapes] = useState<any>(null);

  // The map and the panel read the SAME analysis, so a hazard listed in the
  // panel is always the polygon drawn on the map. Fetching twice would let
  // them disagree, which is worse than either being wrong alone.
  useEffect(() => {
    if (!point) return;
    let dead = false;
    fetch(`/api/site?lat=${point.lat}&lng=${point.lng}`)
      .then((r) => r.json())
      .then((j) => { if (!dead) setShapes(j.shapes ?? null); })
      .catch(() => { if (!dead) setShapes(null); });
    return () => { dead = true; };
  }, [point]);

  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Land Feasibility</h1>
          <span className="sub">Australia — NSW site intelligence</span>
        </div>
      </header>
      <div className="work">
        <SiteMap onPick={setPoint} shapes={shapes} center={point} />
        <SitePanel point={point} />
      </div>
    </main>
  );
}
