'use client';
import { useEffect, useState } from 'react';

type Site = any;

export default function SitePanel({ point }: { point: { lat: number; lng: number } | null }) {
  const [data, setData] = useState<Site | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sv, setSv] = useState<any>(null);

  useEffect(() => {
    if (!point) return;
    let cancelled = false;
    setBusy(true); setErr(null); setData(null); setSv(null);
    fetch(`/api/site?lat=${point.lat}&lng=${point.lng}`)
      .then((r) => r.json())
      .then((j) => { if (!cancelled) setData(j); })
      .catch((e) => { if (!cancelled) setErr(String(e?.message ?? e)); })
      .finally(() => { if (!cancelled) setBusy(false); });
    fetch(`/api/streetview?lat=${point.lat}&lng=${point.lng}`)
      .then((r) => r.json()).then((j) => { if (!cancelled) setSv(j); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [point]);

  if (!point) return <aside className="panel"><p className="muted">Search for a site, or click the map.</p></aside>;
  if (busy) return <aside className="panel"><p className="muted">Reading NSW planning and hazard…</p></aside>;
  if (err) return <aside className="panel"><p className="bad">Lookup failed: {err}</p></aside>;
  if (!data) return null;

  if (!data.supported)
    return <aside className="panel"><p className="bad">{data.message}</p></aside>;

  const h = data.hazard ?? {};
  const flag = (on: boolean) => (on ? 'bad' : 'ok');

  return (
    <aside className="panel">
      <h2>Site</h2>

      {data.parcel ? (
        <>
          <Row k="Lot / plan" v={data.parcel.lotId ?? '—'} />
          <Row k="Surveyed area"
               v={data.parcel.areaHa ? `${data.parcel.areaHa.toFixed(3)} ha` : 'not stated'} />
          <p className="note">
            <b>Ownership is not public in NSW.</b> {data.parcel.ownership}. Order it on{' '}
            <b>{data.parcel.lotId ?? 'this lot'}</b> when you are ready to approach the owner.
          </p>
        </>
      ) : <p className="muted">No cadastral lot here — road or water reserve, or outside NSW.</p>}

      <h3>Planning</h3>
      <Row k="Zone" v={data.zoning ?? 'none mapped'} />
      {data.zoningEpi && <p className="note">{data.zoningEpi}</p>}

      <h3>Hazard</h3>
      <Row k="Flood planning" v={h.flood ? 'YES' : 'no'} cls={flag(h.flood)} />
      <Row k="Bush fire prone"
           v={h.bushfire ? `YES${h.bushfireCategory != null ? ` — category ${h.bushfireCategory}` : ''}`
                         : h.bushfireNearby ? 'not here, but nearby' : 'no'}
           cls={flag(h.bushfire)} />
      <Row k="Landslide risk" v={h.landslide ? 'YES' : 'no'} cls={flag(h.landslide)} />
      <Row k="Biodiversity values" v={h.biodiversity ? 'YES' : 'no'} cls={flag(h.biodiversity)} />

      {h.bushfire && (
        <p className="alert"><b>Bush fire prone.</b> Triggers Planning for Bushfire
          Protection — asset protection zones and construction standards, and often a
          real reduction in developable area.</p>
      )}
      {h.biodiversity && (
        <p className="alert"><b>On the Biodiversity Values Map.</b> The Offset Scheme
          applies; credits are routinely the largest unbudgeted line on a greenfield deal.</p>
      )}

      {sv?.available && (
        <>
          <h3>Street View</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={sv.image} alt="Street View facing the site" className="sv" />
          <p className="note">Camera {sv.distance} m away, turned to {sv.heading}° to face
            the site. {sv.note}</p>
        </>
      )}

      {data.errors && Object.keys(data.errors).length > 0 && (
        <p className="note">Some layers did not answer: {Object.keys(data.errors).join(', ')}.
          A nil result is not a clearance.</p>
      )}
    </aside>
  );
}

function Row({ k, v, cls }: { k: string; v: string; cls?: string }) {
  return <div className="row"><span>{k}</span><b className={cls}>{v}</b></div>;
}
