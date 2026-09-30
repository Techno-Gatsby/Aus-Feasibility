# Deploying the LS Attendance apps on Azure

One **Azure Static Web App** (Standard plan) hosts both pages and the API, and one **Storage account** holds the data and photos.

| Path | What | Who |
|---|---|---|
| `/` | Attendance Tracker (admin) | Entra ID users with the role **admin**, **supervisor** or **viewer** |
| `/worker/` | Worker Attendance (phone) | Anyone. Workers sign in with Emp ID and PIN |
| `/api/worker/*` | Worker login, punch, own month | Anonymous, but every call needs the signed PIN token |
| `/api/supervisor/*` | Site board, punch on behalf, mark no-check-in days | supervisor, admin |
| `/api/admin/*` | Roster, punches, review, photos, day marks | GET: admin, supervisor, viewer · changes: admin |

`staticwebapp.config.json` in `web/` enforces those routes. It also sets the security headers and allows only the map, search and CDN hosts the pages use.

## Folder
```
azure/
  web/                      ← app_location (built by `node build.mjs`)
    index.html              ← Attendance Tracker
    worker/index.html       ← Worker Attendance (+ manifest, icon, service worker)
    staticwebapp.config.json
  api/                      ← api_location (Azure Functions, Node 20)
    src/functions/api.js    ← one HTTP function: /api/{*path}
    src/lsapi.js            ← API rules (copied from shared/ by the build)
    src/store-azure.js      ← Table Storage + Blob Storage
  dev-server.mjs            ← local stand-in, see below
```

## 1. Create the resources (Azure CLI)
```bash
RG=rg-ls-attendance; LOC=westeurope; ST=lsattendance$RANDOM; APP=ls-attendance
az group create -n $RG -l $LOC
az storage account create -n $ST -g $RG -l $LOC --sku Standard_LRS --kind StorageV2 --min-tls-version TLS1_2 --allow-blob-public-access false
az staticwebapp create -n $APP -g $RG -l $LOC --sku Standard
```
The UAE North region can be used for storage if data must stay in the UAE. Static Web Apps is available in a smaller set of regions, but its API calls go to the storage region you choose.

## 2. App settings
```bash
CONN=$(az storage account show-connection-string -n $ST -g $RG -o tsv)
SECRET=$(openssl rand -base64 48)
az staticwebapp appsettings set -n $APP -g $RG --setting-names LS_STORAGE="$CONN" LS_TOKEN_SECRET="$SECRET"
```
- `LS_STORAGE` is the storage connection string. The tables `lsworkers`, `lssites`, `lspunches`, `lsmarks` and `lsconfig`, and the private container `ls-photos`, are created on first use.
- `LS_TOKEN_SECRET` signs the worker sessions and must be at least 32 characters. Changing it signs every worker out.

## 3. Build and deploy
```bash
cd ls-attendance-tracker
node build.mjs                                   # writes azure/web/* and azure/api/src/lsapi.js
cd azure/api && npm install --omit=dev && cd ..
npx @azure/static-web-apps-cli deploy ./web --api-location ./api --api-language node --api-version 20 \
  --deployment-token "$(az staticwebapp secrets list -n $APP -g $RG --query properties.apiKey -o tsv)" --env production
```
A GitHub Actions workflow can also do this. Point `app_location: ls-attendance-tracker/azure/web` and `api_location: ls-attendance-tracker/azure/api` at the folders, and set `skip_app_build: true`.

## 4. Sign-in and roles
- **Sign-in:** Microsoft Entra ID is built in (`/.auth/login/aad`). For a single-tenant login, register an app in Entra ID and add it under **Authentication** on the Static Web App.
- **Roles:** Static Web App → **Role management** → **Invite**. Enter the person's Sobha e-mail and the role: `admin` for the tracker owner, `supervisor` for site supervisors and `viewer` for accounts. Each person accepts the invitation link once.
- **Workers:** they need no Entra account. They use the worker page with Emp ID and PIN.

## 5. First run
1. Open `https://<app>.azurestaticapps.net/`. The tracker loads its shipped data. **Worker app** → Settings shows the API as `/api`. Add the worker page link, `https://<app>.azurestaticapps.net/worker/`, for the PIN-slip QR code.
2. **Projects & sites** → **Edit site** → set each site's location and zone radius. Search, drag the pin or paste coordinates.
3. **Employees** → tick workers → **App access…** → print the PIN slips.
4. **Worker app** → **Publish roster**. Publish again whenever workers, sites, PINs or shift times change.
5. Workers open the link on their phone, then **Add to Home screen**. The tracker syncs punches every 5 minutes; **Sync now** fetches them straight away.

## Data and privacy
- **Location:** read only at the moment of a punch, never tracked in the background.
- **Photos:** stored in the private `ls-photos` container and served only through `/api/admin/photo` after the role check. To keep them for a set time only, add a Storage **Lifecycle management** rule that deletes blobs older than, say, 365 days:
  ```bash
  az storage account management-policy create --account-name $ST -g $RG --policy '{"rules":[{"name":"photos-12m","enabled":true,"type":"Lifecycle","definition":{"filters":{"blobTypes":["blockBlob"],"prefixMatch":["ls-photos/"]},"actions":{"baseBlob":{"delete":{"daysAfterModificationGreaterThan":365}}}}}]}'
  ```
- **PINs:** hashed in the tracker (PBKDF2-SHA256, 100 000 rounds, per-worker salt). The server stores and compares hashes only. After 5 wrong PINs the ID locks for 15 minutes.
- **One phone per worker:** the first phone to sign in is registered. The admin resets it in Employees → Edit → Worker app → Reset phone, then publishes.

## Maps and search
- **Map tiles:** OpenStreetMap (Map) and Esri World Imagery (Satellite), both free for light internal use.
- **Search:** Photon, a free OpenStreetMap service with type-ahead; Nominatim answers on Enter.
- **Heavy use:** OpenStreetMap's public servers are not for heavy production traffic. For many admins or high volume, add an **ArcGIS Location Platform** key in Worker app → Settings. Search then uses ArcGIS; the satellite tiles need no key.

## Run it locally
```bash
node build.mjs && node azure/dev-server.mjs     # http://localhost:4280/  and  /worker/
```
The dev server acts like Static Web Apps with every admin call treated as `DEV_ROLE` (default `admin`). It keeps data in `azure/.dev-data.json`. Camera and GPS work on `localhost` in a desktop browser. A phone needs HTTPS, which means the Azure address.

## Phase 2 (not built yet)
The admin data (attendance, projects, rates, invoices) still lives in the admin's browser, with Backup/Restore. The worker app, punches, photos and supervisor day marks are shared through Azure.

Moving the admin data to the API as well would let several admins work at once. The same store and role checks can be reused.
