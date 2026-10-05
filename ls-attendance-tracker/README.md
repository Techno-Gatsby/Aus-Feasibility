# LS Attendance Tracker

`Attendance Tracker.html` is one self-contained page for Latinem Securities attendance, client timesheets and tax-invoice break-ups.
Copy it into `OneDrive - Sobha LLC\Desktop\LS_Documents` and open it in Edge or Chrome.

It ships with the data from the LS workbooks (master payroll attendance 21 Jun–20 Jul 2026, CLIENT TIME SHEET July 2026,
SUB-CONTRACTORS, SCL TR TIME SHEET June 2026, billing structure and Waves invoice history from Trackers.xlsx, the Elwood
Jan–May 2026 invoice). Everything you change is saved in the browser; **File → Download backup** keeps a copy.

## Layout
- **Menu bar** File / Edit / View / Help. **Toolbar** commands for the open document.
- **Tree** on the left: clients → projects → sites with today's headcount. Click a node to filter the open document, click again to clear, double-click to edit.
- **Documents**: 1 Attendance · 2 Client timesheets · 3 Invoice · Employees · Projects & sites · Settings.
- **Status bar**: the period shown and data counts.

## Monthly flow
1. **Attendance** – payroll month (21st–20th) or calendar month. Select days (click, drag, Shift+click), then click a code or press its key. Enter = reliever at another site / other shift. Del clears, Ctrl+Z undoes. The yellow bar lists data problems; *Review* takes you to each fix.
2. **Client timesheets** – calendar month, one LS/DO/F-026 sheet per project (sites, RELIEVER section, COUNTIF totals, signatories). Tick projects, then *Print / PDF* or *Export Excel* (same cell positions as the SCL TR workbook).
3. **Invoice** – tick projects and months, type the SAP fields, *Generate lines* ("4 Security @ 31 Days" × 4,100, pro-rata on calendar days; fixed monthly amounts for projects like Sobha Waves), *Save*. **4 · Pack** lists every page in the Elwood order: SAP invoice (generated, or the SAP PDF you upload), break-up (generated), timesheets (generated from attendance, or the client-signed scans you upload) and the project's documents such as the Work Order Instruction. *Download pack PDF* joins them into one file; *Print / PDF* prints the generated pages. *Track* follows the Tax Invoice Tracker stages.
   - **Identify pages from a PDF…** reads any PDF (SAP export, scanned pack, an old pack): each page is labelled SAP invoice / break-up / signed timesheet / Work Order Instruction with a thumbnail, the PO, project code, invoice number and total are picked out of the text, the project is recognised, and one click puts the SAP page and signed sheets on this invoice and saves the WOI pages to the project.
   - **Project documents** (Projects & sites → Edit project → Documents): upload the Work Order Instruction once; every pack of that project includes it unless the invoice uses another file. Documents are kept in the browser and included in *Download backup*.

Import Excel (File menu) accepts the master payroll workbook and client timesheet workbooks; sheet types are detected automatically.

## Development
- Edit `src/`, then `node build.mjs` → `Attendance Tracker.html`.
- `src/00-seed.js` is generated: `node tools/mkseed.mjs <folder with real-master.xlsx, real-scl.xlsx, real-trackers.xlsx>` (needs Playwright and the CDN libraries in `<folder>/node_modules`). The workbooks themselves are not in the repo.
- Excel/PDF features load SheetJS, ExcelJS, pdf-lib, pdf.js and html2canvas from cdn.jsdelivr.net.
- `node tests/pack.e2e.mjs` with `PACK_PDF=<pack PDF>` checks page identification and the pack build (the PDF is not in the repo).

## Worker app (phone) – `Worker Attendance.html`
- **Workers** sign in with Emp ID (remembered) + 4-digit PIN, then **CHECK IN / CHECK OUT**. Each punch stores GPS (lat, lng, ±accuracy) and a watermarked front-camera photo. With no signal the punch waits on the phone and is sent later.
- **Zones:** a punch is accepted when (distance to the site pin − GPS accuracy) ≤ zone radius and accuracy ≤ 50 m. Otherwise it waits in **Worker app → Punches to review**.
- **No check-in:** there are no leave requests in the app. The supervisor (phone menu → Supervisor) or the admin (**Worker app → No check-in**) decides what the day is: A, OFF, SL, AL, EL, UL, SIRA or P.
- **Admin, in the tracker:**
  - **Projects & sites → Edit project or Edit site:** map (Map / Satellite), search with suggestions, pins and zone radius. A project location covers every site of the project that has no pin of its own; a site pin overrides it.
  - **Employees:** tick workers → **App access…** gives PINs and prints slips.
  - **Worker app → Publish roster**, then **Sync** (automatic every 5 minutes).
  - **Right-click a day** in Attendance → **Punch details**: coordinates, distance, photos and map.
- **Demo mode:** opened as files from LS_Documents, both pages share a demo store in the same browser. On Azure they use `/api`. See `azure/README-deploy.md`.
- **Documents** are in `docs/`: architecture diagram, Azure resource requirements (xlsx) and additional application requirements (docx).
- **Tests** are in `tests/`:
  - `node tests/api.test.mjs` runs the API rules.
  - `worker-app.e2e.mjs` and `worker-phone.e2e.mjs` need Playwright and the libraries in `tests/package.json`.
