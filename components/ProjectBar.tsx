'use client';

/* Project header: the name and location of the active parcel, and the three
 * file actions from the single-file build — SAVE, OPEN, RESET.
 *
 * SAVE writes the whole project (every parcel) to a .json; OPEN reads one back
 * through a file picker; RESET returns the ACTIVE parcel to the model defaults
 * and asks first, because there is no undo behind it. */

import { useRef, useState } from 'react';
import { openProjectFile, saveProjectToFile, useProject } from '@/lib/project';

const CSS = `
.pbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:var(--paper);
  border-bottom:1px solid var(--line);padding:8px 16px}
.pbar-f{display:flex;align-items:center;gap:7px;min-width:0}
.pbar-f>span{font:600 11px var(--sans);letter-spacing:.06em;text-transform:uppercase;
  color:var(--mute);white-space:nowrap}
.pbar-f input{border:1px solid var(--line);border-radius:var(--r-sm);background:var(--paper);
  color:var(--ink);font:400 13px var(--sans);padding:6px 9px;min-height:32px;min-width:0}
.pbar-f.name input{width:min(340px,42vw);font-weight:600}
.pbar-f.loc input{width:min(240px,30vw)}
.pbar-f input:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(55,138,221,.18)}
.pbar-io{margin-left:auto;display:flex;gap:6px}
.pbar-io button{border:1px solid var(--line);background:var(--paper);color:var(--ink);
  border-radius:var(--r-sm);padding:6px 12px;min-height:32px;font:600 12px var(--sans);cursor:pointer}
.pbar-io button:hover{background:var(--bg);border-color:var(--line-2)}
.pbar-io button.warn:hover{background:var(--bad-bg);border-color:rgba(153,27,27,.3);color:var(--bad)}
.pbar-msg{width:100%;display:flex;align-items:flex-start;gap:8px;padding:8px 10px;
  border-radius:var(--r-sm);font:400 12.5px/1.45 var(--sans)}
.pbar-msg.bad{background:var(--bad-bg);color:var(--bad);border:1px solid rgba(153,27,27,.22)}
.pbar-msg.ok{background:var(--ok-bg);color:var(--ok);border:1px solid rgba(22,101,52,.18)}
.pbar-msg ul{margin:4px 0 0;padding-left:16px}
.pbar-msg button{margin-left:auto;border:0;background:transparent;color:inherit;cursor:pointer;
  font:600 14px var(--sans);line-height:1;padding:0 2px}
`;

type Msg = { kind: 'ok' | 'bad'; text: string; detail?: string[] } | null;

export default function ProjectBar() {
  const { active, activeId, rename, setLoc, reset } = useProject();
  const fileIn = useRef<HTMLInputElement | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ''; // so the same file can be picked twice running
    if (!f) return;
    const res = await openProjectFile(f);
    if (res.ok) {
      setMsg({
        kind: 'ok',
        text: `Opened ${f.name} — ${res.count} parcel${res.count === 1 ? '' : 's'}.`,
        detail: res.warnings.length ? res.warnings : undefined,
      });
    } else {
      setMsg({ kind: 'bad', text: `That file was not loaded. ${res.error}` });
    }
  }

  return (
    <div className="pbar">
      <style>{CSS}</style>

      <label className="pbar-f name">
        <span>Project</span>
        <input
          value={active?.name ?? ''}
          placeholder="Parcel name"
          onChange={(e) => rename(activeId, e.target.value)}
          aria-label="Project name"
        />
      </label>

      <label className="pbar-f loc">
        <span>Location</span>
        <input
          value={active?.loc ?? ''}
          placeholder="Location"
          onChange={(e) => setLoc(activeId, e.target.value)}
          aria-label="Project location"
        />
      </label>

      <div className="pbar-io">
        <button
          type="button"
          onClick={() => {
            const name = saveProjectToFile();
            setMsg({ kind: 'ok', text: `Saved ${name}.` });
          }}
        >
          Save
        </button>
        <button type="button" onClick={() => fileIn.current?.click()}>Open</button>
        <button
          type="button"
          className="warn"
          onClick={() => {
            if (!window.confirm('Reset this parcel to the default appraisal? Its inputs cannot be recovered.')) return;
            reset(activeId);
            setMsg({ kind: 'ok', text: `${active?.name ?? 'Parcel'} was reset to the model defaults.` });
          }}
        >
          Reset
        </button>
        <input ref={fileIn} type="file" accept=".json,application/json" hidden onChange={onFile} />
      </div>

      {msg && (
        <div className={`pbar-msg ${msg.kind}`} role={msg.kind === 'bad' ? 'alert' : 'status'}>
          <div>
            {msg.text}
            {msg.detail && (
              <ul>{msg.detail.map((d, i) => <li key={i}>{d}</li>)}</ul>
            )}
          </div>
          <button type="button" onClick={() => setMsg(null)} aria-label="Dismiss">×</button>
        </div>
      )}
    </div>
  );
}
