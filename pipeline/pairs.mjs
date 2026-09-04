/* Which workbook cell each app parcel is measured against.

   This is deliberately explicit rather than inferred. Several workbooks carry
   two or three scenarios on separate sheets - Drummoyne has Base, Uplift and Max;
   Paddington has FSR 4 and FSR 2.86 - and picking the nearest number to the app's
   own answer would make the reconciliation circular. Where the pairing is a
   judgement rather than a fact it is marked `confirm`, and the report says so
   instead of quietly choosing.

   `sheet`/`cell` name the XIRR cell that defines the comparison. eqirr.mjs reads
   the formula there to find the cashflow row, the date row and the column range,
   so nothing here has to record a cell address that could drift. */
export const PAIRS = [
  { match: /Glenmore.*Paddington/i, nth: 0,
    file: "Peddington Feasibility - 2 scenario.xlsx", sheet: "Monthly CF FSR 4", cell: "C62",
    note: "FSR 4 scenario" },
  { match: /Glenmore.*Paddington/i, nth: 1,
    file: "Peddington Feasibility - 2 scenario.xlsx", sheet: "Monthly CF FSR 2.86", cell: "C62",
    note: "FSR 2.86 scenario" },

  /* Confirmed: compare Drummoyne against the Base scenario only. The workbook
     also carries Uplift and Max, and the app has a second "Uplifted" parcel, but
     the scenario each app parcel represents was never established - so the second
     one is left without a reference rather than matched on which number is
     nearest, which would make the reconciliation circular. */
  { match: /^Drummoyne, Sydney/i,
    file: "Drummoyne - Feasibility.xlsx", sheet: "SC 1 Quarterly CF - Base", cell: "C75",
    note: "Base scenario, per instruction", quarterly: true },

  /* Only the Monthly CF scenario is a reference; the second Oxlade parcel has no
     matching sheet and is reported unpaired. */
  { match: /Oxlade/i, nth: 0,
    file: "12. Oxlade Dr Feasibility - july26.xlsx", sheet: "Monthly CF", cell: "C74" },

  { match: /SP Boulevard/i,
    file: "SP Boulevard CF-20.05.2026.xlsx", sheet: "Monthly CF - Sum", cell: "C72" },
  { match: /Brunswick/i,
    file: "Brunswick CF.xlsx", sheet: "Brunswick_50 floors option (2)", cell: "K84",
    note: "last populated rung of the IFERROR ladder - the full-length series" },
  { match: /Terry Road/i,
    file: "Feasibility-16 Terry Road- 2 phase scheme.xlsx", sheet: "Monthyl CF", cell: "C65" },
  { match: /Menin/i,
    file: "11. Menin Road working file.xlsx", sheet: "Monthly CF", cell: "C61" },
  { match: /Beckett/i,
    file: "10. Beckett Road submitted DA.xlsx", sheet: "Monthly CF", cell: "C61" },
  /* Added as a check on the lot template: a project the engine had never been tuned
     against. Paired to the Project-8 file rather than "Hendra -2.xlsx" because the
     seed's 4% selling stack matches it, where Hendra-2 carries 5%. */
  { match: /Hendra/i,
    file: "Project -8 (Self equity - Hendra).xlsx", sheet: "Monthly CF - lots", cell: "C59" },
];

/* Workbooks with no app parcel. Listed so the report can say they were seen and
   skipped rather than leaving them silently out of the count. */
export const UNPAIRED_WORKBOOKS = [
  "Hendra -2.xlsx",
  "Project -7 (SPB) - Self Equity 1.xlsx",
  "Project 9 - self funded (drummoyne).xlsx",
  "Walloon Road Ipswich - OR + Rev share .xlsx",
];

/* Counting has to be per pattern, not per parcel name: the two Paddington
   scenarios have different names but share one `match`, so keying the counter on
   the name gave them both nth 0 and pointed both at the FSR 4 sheet. */
export function pairFor(parcelName, seenCounts) {
  const hits = PAIRS.filter(p => p.match.test(parcelName));
  if (!hits.length) return null;
  const key = hits[0].match.source;
  const n = seenCounts.get(key) || 0;
  seenCounts.set(key, n + 1);
  const exact = hits.find(p => p.nth === n);
  if (exact) return exact;
  /* When every entry for this pattern is numbered, an extra parcel beyond them has
     no reference and must be reported unpaired. Falling back to the first entry is
     what made the second Oxlade parcel look 10 points out against a scenario it
     was never meant to be compared with. */
  if (hits.every(p => p.nth !== undefined)) return null;
  return hits.find(p => p.nth === undefined) || null;
}
