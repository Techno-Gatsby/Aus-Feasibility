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

## G&A tab

Overhead 2026–2030 for Consol, Landowner (Sobha Developers, H) and Homebuilder (Sobha Homes,
V). For Consol, switch between overhead, full cost and the project share (full cost ×
Proj. %). The workbook never multiplies the project share out, so the page calculates it
and labels it as calculated. Click any head to see:
- its split by year: full cost, OH %, overhead, project share, Landowner % and both entities;
- how its figures are built: the `Cal.` row behind 2026 and the rule for later years;
- the OPEX lines (or depreciation batches) behind it.

The drill-down flags lines that `Cal.` counts twice, takes from the wrong month or mislabels.
*Worth knowing* lists them, along with the contingency share and the Landowner ratios.

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
| Cashflow tabs | `… Projectwise cash PRT` in each model (Landowner/Homebuilder copies in the Consol model are used if those models aren't uploaded) |
| Landowner / Homebuilder P&L | `landowner Projectwise PL`, `Homebuilde Projectwise PL` (first block = all projects, then one block per project; *Corporate level & differences* is the remainder) |
| Consol P&L | `Cons P&L` for the totals; per project calculated from revenue in the Consol cashflow, costs from `Cons Budgetd Costs new` spread by revenue, property tax from `Real property tax V2 - updated`, tax rates from `Cons Assumption` |
| Consol line breakdown | which Landowner/Homebuilder lines each `Consol Projectwise cash PRT` cell sums (cells calculated in the Consol sheet itself show as *Consol-sheet override*) |
| Equity IRR | the XIRR row under each block of the PRT sheets |
| Revenue, profit, equity, ROE tiles | `Summary val` (Landowner model) |
| Units, cost, peak debt, dates | cashflow lines, budget sheets and the timeline |
| Timeline | BP Input Sheets › `Timeline Assumptions` |
| G&A tab | G&A workbook › `G&A` (cost, OH % / Proj. %, TOTAL OH, Sobha Developers = Landowner (H), Sobha Homes = Homebuilder (V), Allowed); drill-down follows each head's `Cal.` row to the `OPEX` lines and the depreciation batches |

Sheet names live in `MODELS` and `SHEETS` at the top of `src/extract.js`; a renamed sheet is
a one-line change there. Timeline rows are matched to model projects by name
(`TIMELINE_ALIASES` for names that differ, e.g. *Willard - Commercial* → *Creek Park
Commercial*).

## Building and testing

```
node build.mjs                 # -> Sobha_USA_Cashflow_Dashboard.html and dist/artifact.html
node test/parity.mjs           # needs the four workbooks in fixtures/ (gitignored)
node test/parity.mjs --only=consol_cf,kpi_extra --show=20
node test/actuals-xlsx.mjs      # Actuals Excel: formulas match the tab, upload round-trips (no fixtures needed)
```

The parity test runs the page's own extraction code on the workbooks and compares every
dataset with `src/baseline.json` (the figures the page ships with), within $1. Run it after
changing anything in `src/extract.js` or `src/derive-*.js`.

`src/baseline.json` is the data built into the page. To ship new default figures, upload the
models in the page, use **Download updated dashboard**, or replace `baseline.json` with the
uploaded data and rebuild.
