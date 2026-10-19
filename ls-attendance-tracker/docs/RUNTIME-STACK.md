# Application runtime stack and versions

As built and tested on 30 September 2026.

| Layer | Component | Version | Note |
|---|---|---|---|
| Hosting | Azure Static Web Apps | Standard plan | Both pages + managed API, custom domain, managed TLS, role routes |
| API runtime | Azure Functions host (managed by SWA) | 4.x | Extension bundle `[4.*, 5.0.0)`, Functions v4 programming model |
| API language | Node.js | 20 LTS | `azure/api/package.json` engines `>=20` |
| API packages | `@azure/functions` · `@azure/data-tables` · `@azure/storage-blob` | ^4.5.0 · ^13.2.2 · ^12.24.0 | Only three dependencies |
| Data | Azure Table Storage + Blob Storage (StorageV2, LRS) | TLS 1.2+ | Tables `lsworkers lssites lspunches lsmarks lsconfig`, container `ls-photos` (private) |
| Security | WebCrypto PBKDF2-SHA256 (100k rounds) · HMAC-SHA256 tokens | built into browser and Node 20 | PIN hashing, 20-hour worker sessions; Entra ID for staff via SWA |
| Front end | HTML5 + vanilla JavaScript (ES2020), two single-file pages | n/a | No framework; built by `node build.mjs` |
| Maps | Leaflet · Esri World Street Map · Esri World Imagery · Photon / Nominatim search | 1.9.4 | Loaded from cdn.jsdelivr.net; optional ArcGIS key |
| Excel / PDF | SheetJS · ExcelJS · pdf-lib · pdf.js · html2canvas · qrcode-generator | 0.18.5 · 4.4.0 · 1.17.1 · 4.10.38 · 1.4.1 · 1.4.4 | Import, LS/DO/F-026 export, invoice pack (page identification, generated pages rendered to A4 images, one PDF), PIN-slip QR |
| Browser storage | IndexedDB · localStorage · Service Worker | built-in | Admin data + backup, offline punch queue, remembered Emp ID |
| Browsers – admin | Microsoft Edge / Google Chrome | Chromium 110+ | Print dialog for PDFs |
| Browsers – worker | Chrome for Android / Safari on iOS | Android 9+ (Chrome 110+) · iOS 16.4+ | Camera and GPS require HTTPS; add to Home screen |
| Build / test | Node.js · Playwright + Chromium · Azurite | 20+ (tested 22.22) · 1.47+ · 3.x | `tests/` |
| Local dev | `azure/dev-server.mjs` | Node 20+ | Stand-in for SWA with in-memory API |

Outbound hosts the browser calls: `cdn.jsdelivr.net`, `server.arcgisonline.com`, `photon.komoot.io`, `nominatim.openstreetmap.org`, `geocode-api.arcgis.com` (key only).

- **Face check** (Insights / App & review): @vladmandic/face-api 1.7.15 from jsDelivr (MIT; SSD MobileNet v1 detector, 68-point landmarks, ResNet-34 128-number descriptor). Runs in the admin browser; match ≤ 0.52, unsure ≤ 0.58.
- **Shift positions** (`POST worker/ping`, pulled by the tracker with `GET admin/pings`, kept 62 days): Android app (`mobile/`, Capacitor 6 + built-in foreground service with Google Play location) records every ~5 min / 30 m with the screen off, app closed and after a restart; the web / home-screen app (iPhone) every 10 min or ~50 m while open.

- **Ask Claude** (admin tracker, beta): for now runs through the **Claude CLI on the same PC** – `node tools/claude-bridge.mjs` (no dependencies; Claude Code installed and signed in) listens on 127.0.0.1:8787. The page posts the question plus a data snapshot; the bridge runs `claude -p` in a private temp folder where Claude may only run `node analyse.mjs`, which executes its read-only JavaScript analysis with the page's own helpers (D, H) in an isolated Node `vm` context; only results go to Claude. No API key in the browser. Model: the CLI default, or Opus 5.5 / Sonnet 5.5 / Haiku 5.5. Passport / Emirates ID / phones / address / health are withheld unless enabled. CSP connect-src includes http://localhost:8787. Planned: a server-side key in Azure instead of the local CLI.
- **Employee directory**: HR details on each person (`e.hr`), imported from the LS EMPLOYEE LIST / RESIGNATION workbook (headers matched loosely, values tidied), exported back in that layout.
