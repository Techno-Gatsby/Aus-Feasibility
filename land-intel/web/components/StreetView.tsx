'use client';

import { useEffect, useState } from 'react';

interface SV {
  status: 'ok' | 'no-key' | 'none-nearby' | 'error';
  message?: string;
  embedUrl?: string;
  heading?: number;
  imageryDate?: string | null;
  distanceM?: number;
  radius?: number;
  panoLat?: number;
  panoLon?: number;
}

export default function StreetView({
  lat, lon,
}: { lat: number | null; lon: number | null }) {
  const [sv, setSv] = useState<SV | null>(null);
  const [radius, setRadius] = useState(400);

  useEffect(() => {
    if (lat == null || lon == null) { setSv(null); return; }
    let live = true;
    setSv(null);
    (async () => {
      try {
        const r = await fetch(`/api/streetview?lat=${lat}&lon=${lon}&radius=${radius}`);
        const d = await r.json();
        if (live) setSv(d);
      } catch (e) {
        if (live) {
          setSv({ status: 'error', message: e instanceof Error ? e.message : String(e) });
        }
      }
    })();
    return () => { live = false; };
  }, [lat, lon, radius]);

  if (lat == null || lon == null) {
    return (
      <div className="svmsg">
        <p>Search a tract, or click any parcel on the map, then reopen this tab.</p>
      </div>
    );
  }
  if (!sv) return <div className="svmsg">Looking for nearby imagery…</div>;

  if (sv.status === 'ok' && sv.embedUrl) {
    return (
      <div className="svwrap">
        <iframe
          className="svframe"
          src={sv.embedUrl}
          loading="lazy"
          referrerPolicy="no-referrer-when-downgrade"
          allowFullScreen
          title="Street View"
        />
        <div className="svbar">
          Nearest imagery {sv.distanceM} m from the tract
          {sv.imageryDate ? ` · captured ${sv.imageryDate}` : ''} · camera
          facing {sv.heading}°
          <span className="svnote">
            The camera looks toward the tract, but the nearest road may not
            front it — check the distance before treating this as the frontage.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="svmsg">
      <p>{sv.message}</p>
      {sv.status === 'none-nearby' && (
        <div className="svradius">
          <button onClick={() => setRadius(1000)} disabled={radius >= 1000}>
            Search 1 km
          </button>
          <button onClick={() => setRadius(3000)} disabled={radius >= 3000}>
            Search 3 km
          </button>
          <a target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${lat},${lon}`}>
            Open in Google Maps ↗
          </a>
        </div>
      )}
    </div>
  );
}
