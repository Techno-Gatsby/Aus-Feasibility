'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import SitePanel from '@/components/SitePanel';

const SiteMap = dynamic(() => import('@/components/SiteMap'), {
  ssr: false,
  loading: () => <div className="map-canvas skeleton" />,
});

export default function Page() {
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  return (
    <main className="shell">
      <header className="top">
        <div>
          <h1>Land Feasibility</h1>
          <span className="sub">Australia — site intelligence</span>
        </div>
      </header>
      <div className="work">
        <SiteMap onPick={setPoint} />
        <SitePanel point={point} />
      </div>
    </main>
  );
}
