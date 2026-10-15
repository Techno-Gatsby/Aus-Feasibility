# Sobha USA cashflow & P&L dashboard

A single HTML page with the Consol, Landowner and Homebuilder cashflows, P&Ls, Actuals,
project details and the G&A (overhead) budget. Its figures can be refreshed by uploading the model workbooks: the page reads
them in the browser, shows what would change, and applies them for everyone who uses the page.

- `Sobha_USA_Cashflow_Dashboard.html` — the built page. Opens straight from disk.
- `src/` — what the page is built from (edit these, then rebuild).
- `test/parity.mjs` — proves the upload reproduces the figures the page ships with.

## Updating the figures

1. Open the dashboard and click **Update from models** (top right).
2. Drop in any of these, all five or just the ones that changed:
   - `V5_Consol_Cashflow_Sobha_USA.xlsx` (Consol model)
   - `V5_US_Landowner_Sobha_US_2026.xlsx` (Landowner model)
   - `V5_US_Homebuilder_Sobha_US_2026.xlsx` (Homebuilder model)
   - `Sobha_USA - BP Input Sheets ….xlsx` (the timeline)
   - `Sobha_USA - GA ….xlsx` (the G&A budget)

   Files are recognised by their sheets, not their names. Anything you leave out keeps its
   current figures.
3. Review the panel: headline figures before and after, integrity checks (cash rolls forward,
   totals add up, P&L ties out, Consol = Homebuilder sales), which datasets are updated and
   which are kept, and any warnings.
4. **Apply**. The bar under the tabs then shows which files the figures came from, with
   **Go back to original figures** and **Download updated dashboard** (a standalone copy with
   the current figures, edits and photos built in).

Workbooks must be saved by Excel after recalculating: the page reads the values Excel saved,
and warns when formula cells have none.

## Editing project details

**Project details → Edit details** opens a form for the overview (name, location, status,
note), development and finance metrics, milestones and returns per entity, and photos (add,
remove, recaption). Each field shows the value from the models underneath it. An edit
overrides that one field; ↺ goes back to the model value. Edits survive later model uploads,
and every field nobody edited keeps refreshing from the models.

## Actuals in Excel

On any Actuals tab, **Download Excel** saves `Sobha USA - BP vs Actuals - <date>.xlsx` with all six
statements (Consol, Landowner, Homebuilder; cash flow and P&L):
- **BP vs Actuals**: the BP figures, and next to each period an Actual column linked to the
  Actuals sheet.
- **Actuals**: type actuals into the yellow cells; totals, balances and the All Projects rows
  are formulas that add up the same way the dashboard does.

**Upload Excel** reads the filled-in file back: typed yellow cells replace the dashboard's
actuals for those cells, blank cells keep what the dashboard has.

## G&A

Each entity tab has a **G&A** view next to Cashflow, P&L and Actuals: Consol shows OHcost-H+V,
Landowner OHcost-H and Homebuilder OHcost-V, as laid out in the workbook, with the rows under
the table (entity split, cost categories, G&A provision per project; click a project for its
lines). LO share and HB share by year sit above the heads. Click a head for its full cost, project
share (full cost × Proj. %, calculated) and overhead (click it for Landowner and Homebuilder),
then the OPEX lines behind it (Sr No, months, total, counted) or, for depreciation, each purchase
batch's CAPEX lines. A red ! marks lines counted twice or taken from another month. On Consol,
**Incl. project costs** switches the table to the full cost of each head (the G&A sheet's cost
columns, overhead and project share together; the contingency plug is not a cost there).
**Collapse all** closes everything opened, as in Cashflow and P&L.

## Exposure

Each entity tab also has an **Exposure** view: the projected exposure statement (Consol `Cons
Exposure`, Landowner `HS Exposure`, Homebuilder `Cons Exposure`) section by section, as laid out in
the sheet. A line opens to the rows behind it (for example working capital per project from the
inventory and land sheets; anything not covered shows as Other) and, on Consol, to the same line
in the Landowner and Homebuilder statements where the two add up to the Consol line (the Consol
sheet is built from its own schedules, net of intercompany items, so many lines don't).
**Collapse all** closes every opened line.

## Using it on your own computer

Open `Sobha_USA_Cashflow_Dashboard.html` in Chrome or Edge, straight from the folder; nothing
needs installing and no internet connection is required (fonts fall back to the system font
offline). Uploads, detail edits, photos and actuals are saved in that browser for that file:
keep the file in the same place and use the same browser. To take everything to another
computer, use **Download updated dashboard** (figures, edits and photos built in) and the
Actuals Excel download (re-upload it on the Actuals tab there).

## Where it saves

Published as an artifact (with the `db`, `user` and `downloads` capabilities), uploads,
detail edits, photos and Actuals are shared: everyone with the link sees the latest. People at
Contributor level and above can upload and edit; Viewers see read-only. Opened from disk, the
same things are saved in that browser only.

Shared storage layout: `plans/current` points at the figures in use, stored in 200 KB pieces
under `plans/<id>/chunks/` (documents are capped at 256 KB); `details/<project>` holds one
project's edits; `photos/<id>` one added photo (resized to under ~180 KB); `actuals/…` the
Actuals tab.

## Where each figure comes from

| Dashboard | Workbook › sheet |
|---|---|
| Cashflow tabs | Consol `Consol Projectwise cash`, Landowner `landowner Projectwise cashflow`, Homebuilder `Homebuilde Projectwise cashflow` (not the `… PRT` print copies; without the Landowner / Homebuilder model, the copies inside the Consol model are used) |
| Landowner / Homebuilder P&L | `landowner Projectwise PL`, `Homebuilde Projectwise PL` (first block = all projects, then one block per project; *Corporate level & differences* is the remainder) |
| Consol P&L | `Cons P&L` for the totals; per project calculated from revenue in the Consol cashflow, costs from `Cons Budgetd Costs new` spread by revenue, property tax from `Real property tax V2 - updated`, tax rates from `Cons Assumption` |
| Consol line breakdown | which Landowner/Homebuilder lines each `Consol Projectwise cash` cell sums (cells calculated in the Consol sheet itself show as *Consol-sheet override*) |
| Equity IRR | `Summary val` › IRR (Pre tax) of each entity's block (All Projects from `Total`, and after overheads from `Total (inc Overheads)`); where it is blank or 0, the XIRR row under the project's block of the cashflow sheet |
| Revenue, profit, equity, ROE tiles | `Summary val` (Landowner model): one column per project, `Total` = All Projects; a `Total (inc Overheads)` column is not a project: it gives All Projects' overheads and net profit, margin, IRR and ROE after overheads (shown under the Net profit and ROE tiles) |
| Units, cost, peak debt, dates | cashflow lines, `Cons Budgetd Costs new` / `HS Budget costs1` and the timeline |
| Project details, milestones | `Summary val`, `landowner Projectwise cashflow`, `Homebuilde Projectwise cashflow`, the timeline |
| Timeline | BP Input Sheets › `Timeline Assumptions` |
| Actuals (plan columns) | the cashflow and P&L datasets above, Homebuilder `Cons P&L` |
| Exposure | Consol `Cons Exposure`, Landowner `HS Exposure`, Homebuilder `Cons Exposure`; the breakdown follows each line's formulas into the sheets they point at (inventory, land bank, land under development, schedules, land payable, …) |
| G&A (in each entity tab) | G&A workbook (recognised by `OHcost-H+V`) › `OHcost-H+V` / `OHcost-H` / `OHcost-V` for the three tables; a Consol head opens to its OHcost-H and OHcost-V rows (paired by the G&A row their formulas read, else by label). When the workbook also has `G&A`, `Cal.`, `OPEX` and `CAPEX`: cost, OH % / Proj. %, LO / HB share, the full-cost view and the drill-down to the OPEX lines and depreciation batches. Without them (an OHcost-only workbook), LO / HB share comes from the Land Development / Developer (Homes) rows and the earlier workbook's lines are not kept |

Sheet names live in `MODELS` and `SHEETS` at the top of `src/extract.js`; a renamed sheet is
a one-line change there (the G&A and Exposure sheets: top of `src/derive-ga.js`,
`src/derive-exposure.js`). Within a sheet nothing is read by cell address: rows are found by
their labels, projects by their blocks or names, years and periods by their headers, so added
rows, projects and years are picked up. Saved values are read (formulas are not recalculated),
so save the workbook after Excel recalculates. Timeline rows are matched to model projects by name
(`TIMELINE_ALIASES` for names that differ, e.g. *Willard - Commercial* → *Creek Park
Commercial*).

## Building and testing

```
node build.mjs                 # -> Sobha_USA_Cashflow_Dashboard.html and dist/artifact.html
node test/parity.mjs           # needs the four workbooks in fixtures/ (gitignored)
node test/parity.mjs --only=consol_cf,kpi_extra --show=20
node test/actuals-xlsx.mjs      # Actuals Excel: formulas match the tab, upload round-trips (no fixtures needed)
node test/flex.mjs              # models with 5 more years and a new project (made from fixtures/ in memory) still read
```

`test/flex.mjs` changes the fixture workbooks in memory the way a later model would: every sheet
read by year gets five more years (cashflows to FY 2040; the G&A sheet's year blocks and the
OHcost sheets to FY 2035; each Exposure table five more periods), and Brook Hollow is copied as a new
project after the last one in every per-project sheet, running five years later. It checks
that every dataset picks up the new years and the new project, and runs the Actuals Excel test on
the result. `--dump=file.json` / `--write=dir` save that data or those workbooks (model figures:
keep them out of the repository) to try in the page.

The parity test runs the page's own extraction code on the workbooks and compares every
dataset with `src/baseline.json` (the figures the page ships with), within $1. Run it after
changing anything in `src/extract.js` or `src/derive-*.js`.

`src/baseline.json` is the data built into the page. To ship new default figures, upload the
models in the page, use **Download updated dashboard**, or replace `baseline.json` with the
uploaded data and rebuild.
