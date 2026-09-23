# LS Attendance Tracker

`Attendance Tracker.html` is one self-contained page for Latinem Securities attendance and client billing.
To use it, copy the file into `OneDrive - Sobha LLC\Desktop\LS_Documents` and open it in **Microsoft Edge** or **Chrome**.

## First run
1. Data saves automatically in the browser. Click **Backup** now and then and keep the file in `LS_Documents`.
2. Go to **Data & settings**, choose **Import from Excel**, and import the master payroll workbook. You can also import a client timesheet workbook, such as `SCL TR TIME SHEET - JUNE 2026.xlsx`, to build the projects and sites.
3. Go to **Clients, projects & sites**. Add the clients, then map each *unmapped site* to its project. For each project, set its SAP code, PO number, billing basis, rate and VAT, using the figures from `ENGINEER BILLING\Trackers.xlsx`.

## Monthly flow
- **Master attendance** shows the payroll month (21st–20th) or the calendar month. Select cells and press P / A / O / R / L / S / E / T, or Delete to clear. Double-click a cell to post a reliever to another site or change their shift for that day.
- **Client timesheets** shows the calendar month, one LS/DO/F-026 sheet per project. Print it to PDF or export it to Excel.
- **Invoices**: choose the client, projects and months, enter the SAP fields, and generate the lines. Then **Print pack**, which gives the invoice followed by the timesheets. Use **Merge PDFs** to add the SAP Work Order Instruction and any signed scans.

## Development
Edit the files in `src/`, then run `node build.mjs` to rebuild `Attendance Tracker.html`.
The Excel and PDF features load SheetJS, ExcelJS and pdf-lib from cdn.jsdelivr.net, so they need an internet connection.
