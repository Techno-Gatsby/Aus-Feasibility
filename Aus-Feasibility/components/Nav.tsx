'use client';

/* The navigation of the single-file build, kept in its shape.
 *
 * Eight top-level views; three of them hold more than one pane and grow a
 * sub-strip underneath the pane heading. NAV below is the same table as the
 * legacy `const NAV = [...]`, in the same order, with the same labels —
 * anyone who knows the original should read this and recognise it.
 *
 * Two entries are additions rather than ports: "Sources and uses" and
 * "Debt and cover" are panes this build has and the single-file build did
 * not. They are appended inside the Statements group rather than dropped,
 * because losing a finished statement to fit a menu would be the wrong
 * trade. Everything else is the legacy structure verbatim. */

export type PaneId =
  | 'verdict' | 'map'
  | 'pl' | 'cf' | 'bs' | 'su' | 'debt' | 'monthly'
  | 'sens' | 'two'
  | 'scn' | 'opt' | 'offer'
  | 'cpl' | 'ccf' | 'cbs' | 'port';

export type GroupId = 'verdict' | 'map' | 'stmt' | 'sens' | 'scn' | 'opt' | 'offer' | 'port';

export type NavGroup = { id: GroupId; lab: string; panes: [PaneId, string][] };

export const NAV: NavGroup[] = [
  { id: 'verdict', lab: 'Summary', panes: [['verdict', 'Summary']] },
  { id: 'map', lab: 'MAP', panes: [['map', 'Site intelligence']] },
  {
    id: 'stmt',
    lab: 'Statements',
    panes: [
      ['pl', 'Profit and loss'],
      ['cf', 'Cashflow'],
      ['bs', 'Balance sheet'],
      ['su', 'Sources and uses'],
      ['debt', 'Debt and cover'],
      ['monthly', 'Monthly engine'],
    ],
  },
  { id: 'sens', lab: 'Sensitivity', panes: [['sens', 'One driver'], ['two', 'Two drivers']] },
  { id: 'scn', lab: 'Scenarios', panes: [['scn', 'Scenario lab']] },
  { id: 'opt', lab: 'Optimiser', panes: [['opt', 'Optimiser']] },
  { id: 'offer', lab: 'Land value', panes: [['offer', 'Offer price']] },
  {
    id: 'port',
    lab: 'Consolidation',
    panes: [
      ['cpl', 'Consolidated P&L'],
      ['ccf', 'Consolidated cashflow'],
      ['cbs', 'Consolidated balance sheet'],
      ['port', 'Project comparison'],
    ],
  },
];

export const GROUP_OF: Record<PaneId, GroupId> = NAV.reduce((m, g) => {
  g.panes.forEach(([id]) => { m[id] = g.id; });
  return m;
}, {} as Record<PaneId, GroupId>);

/** Heading and standfirst for each pane, as the legacy scaffold wrote them. */
export const PANE_HEAD: Record<PaneId, { h: string; d?: string }> = {
  verdict: { h: '', d: '' },
  map: {
    h: 'Site intelligence',
    d: 'Pick a lot on the map. Title, planning, area and surroundings are read live and the measured area can be pushed straight into the appraisal.',
  },
  pl: {
    h: 'Profit and loss',
    d: 'For the parcel currently open. Gross contracted sales are recognised at settlement, output GST is deducted to reach net revenue, and recoverable input GST is credited against eligible project costs. Direct costs remain matched to the same settled lots / units.',
  },
  cf: { h: 'Cashflow', d: 'Money in and money out, by financial year, on the engine’s own month-to-year map.' },
  bs: { h: 'Balance sheet', d: 'Position at each financial year end, built from the same ledger as the cashflow.' },
  su: { h: 'Sources and uses', d: 'Where the money comes from and what it pays for, across the whole project.' },
  debt: { h: 'Debt sizing and cover', d: 'Peak debt against the facility, and cover measured only where debt service and settlement receipts actually coincide.' },
  monthly: { h: 'Monthly engine', d: 'The calculation layer behind every other tab.' },
  sens: { h: 'Sensitivity', d: 'One driver swept across a range; the appraisal runs in full at each step.' },
  two: { h: 'Heat map', d: 'Two drivers moved together. Green at or above the base case, red where value is lost.' },
  scn: {
    h: 'Scenario lab',
    d: 'Each row is a complete appraisal. Enter absolute figures; leave a cell blank to inherit the input on the left.',
  },
  opt: { h: 'Optimiser', d: 'The search evaluates a large number of complete appraisals and returns the best recipe it found.' },
  offer: { h: 'Land value', d: 'What the land can support at each return test, and the gap to the current ask.' },
  cpl: { h: 'Consolidated P&L', d: 'Every parcel in the project, added on one financial-year grid.' },
  ccf: { h: 'Consolidated cashflow', d: 'Every parcel in the project, added on one financial-year grid.' },
  cbs: { h: 'Consolidated balance sheet', d: 'Every parcel in the project, added on one financial-year grid.' },
  port: { h: 'Project comparison', d: 'Parcel against parcel on the measures that decide which one goes first.' },
};

export function Tabs({ at, onPick }: { at: GroupId; onPick: (g: GroupId) => void }) {
  return (
    <nav className="tabs" id="tabs" role="tablist" aria-label="Views">
      {NAV.map((g) => (
        <button
          key={g.id} type="button" role="tab" data-nav={g.id}
          aria-selected={g.id === at}
          onClick={() => onPick(g.id)}
        >
          {g.lab}
        </button>
      ))}
    </nav>
  );
}

export function SubTabs({ group, sel, onPick }: {
  group: NavGroup; sel: PaneId; onPick: (p: PaneId) => void;
}) {
  if (group.panes.length < 2) return null;
  return (
    <div className="sub2">
      {group.panes.map(([id, lab]) => (
        <button
          key={id} type="button" data-sub={id}
          aria-current={id === sel ? 'true' : 'false'}
          onClick={() => onPick(id)}
        >
          {lab}
        </button>
      ))}
    </div>
  );
}
