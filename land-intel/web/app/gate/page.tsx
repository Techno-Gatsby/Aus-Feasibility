'use client';

import { useState } from 'react';

export default function Gate() {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const res = await fetch('/api/gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? 'Failed');
      window.location.href = '/';
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <main className="gate">
      <form onSubmit={submit}>
        <h1>Land Intel</h1>
        <p className="sub">Melissa &amp; Prosper · Collin County, TX</p>
        <label>
          Access PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        {err && <p className="gerr">{err}</p>}
        <button type="submit" disabled={busy || !pin}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <p className="fine">
          Internal Sobha tool. Site screening data only — not a substitute for
          title, survey or geotechnical work.
        </p>
      </form>
    </main>
  );
}
