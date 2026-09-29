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
3. **Invoice** – tick projects and months, type the SAP fields, *Generate lines* ("4 Security @ 31 Days" × 4,100, pro-rata on calendar days; fixed monthly amounts for projects like Sobha Waves), *Save*, *Print pack* (Tax Invoice Amount Break-up + timesheets). *Track* follows the Tax Invoice Tracker stages; *Merge PDFs* joins the SAP invoice, break-up, timesheets and Work Order Instruction.

Import Excel (File menu) accepts the master payroll workbook and client timesheet workbooks; sheet types are detected automatically.

## Development
- Edit `src/`, then `node build.mjs` → `Attendance Tracker.html`.
- `src/00-seed.js` is generated: `node tools/mkseed.mjs <folder with real-master.xlsx, real-scl.xlsx, real-trackers.xlsx>` (needs Playwright and the CDN libraries in `<folder>/node_modules`). The workbooks themselves are not in the repo.
- Excel/PDF features load SheetJS, ExcelJS and pdf-lib from cdn.jsdelivr.net.
