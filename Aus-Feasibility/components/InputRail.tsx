'use client';
import { useEffect, useMemo, useState } from 'react';

export type Field = {
  key: string; label: string; unit: string; default: any; type: 'n' | 'p' | 'c';
};
export type Group = { group: string; fields: Field[] };

/** 491 fields across 17 groups. Showing them all at once is unusable, so
 *  groups collapse and only the first opens by default. Computed fields
 *  ('c') are read-only — writing to them would be silently discarded by the
 *  engine, which is worse than not offering the box. */
export default function InputRail({
  groups, values, onChange, dirtyKeys,
}: {
  groups: Group[];
  values: Record<string, any>;
  onChange: (k: string, v: any) => void;
  dirtyKeys: Set<string>;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [filter, setFilter] = useState('');

  useEffect(() => {
    if (groups.length && !Object.keys(open).length)
      setOpen({ [groups[0].group]: true });
  }, [groups, open]);

  const q = filter.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return groups;
    return groups
      .map((g) => ({
        ...g,
        fields: g.fields.filter(
          (f) => f.label.toLowerCase().includes(q) || f.key.toLowerCase().includes(q),
        ),
      }))
      .filter((g) => g.fields.length);
  }, [groups, q]);

  return (
    <aside className="rail">
      <div className="rail-head">
        <input
          className="rail-search" value={filter} placeholder="Filter inputs…"
          onChange={(e) => setFilter(e.target.value)} aria-label="Filter inputs"
        />
        <div className="rail-meta">
          {shown.reduce((n, g) => n + g.fields.length, 0)} fields
          {dirtyKeys.size > 0 && <> · <b>{dirtyKeys.size} changed</b></>}
        </div>
      </div>

      {shown.map((g) => {
        const isOpen = q ? true : !!open[g.group];
        return (
          <section key={g.group} className="grp">
            <button className="grp-h" onClick={() => setOpen((o) => ({ ...o, [g.group]: !o[g.group] }))}
                    aria-expanded={isOpen}>
              <span className={`caret${isOpen ? ' open' : ''}`} aria-hidden>▸</span>
              {g.group}
              <em>{g.fields.length}</em>
            </button>
            {isOpen && (
              <div className="grp-b">
                {g.fields.map((f) => (
                  <Row key={f.key} f={f} value={values[f.key]} dirty={dirtyKeys.has(f.key)}
                       onChange={(v) => onChange(f.key, v)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </aside>
  );
}

function Row({ f, value, onChange, dirty }: {
  f: Field; value: any; dirty: boolean; onChange: (v: any) => void;
}) {
  const computed = f.type === 'c';
  const isFlag = f.unit === 'flag';

  if (isFlag) {
    return (
      <label className={`fld flag${dirty ? ' dirty' : ''}`}>
        <span title={f.key}>{f.label}</span>
        <input type="checkbox" checked={Number(value) >= 0.5} disabled={computed}
               onChange={(e) => onChange(e.target.checked ? 1 : 0)} />
      </label>
    );
  }
  return (
    <label className={`fld${dirty ? ' dirty' : ''}`}>
      <span title={f.key}>{f.label}</span>
      <span className="in">
        <input
          type="number" inputMode="decimal"
          value={value ?? ''} readOnly={computed} tabIndex={computed ? -1 : 0}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {f.unit && <i>{f.unit}</i>}
      </span>
    </label>
  );
}
