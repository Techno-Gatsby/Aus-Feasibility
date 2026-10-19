# LS Attendance – Android app (installed from your own Azure site, no Play Store)

The phone page inside a small Android app, plus a **built-in location recorder** (`android-src/`):
- starts at check-in, stops at check-out (safety stop after 16 h);
- keeps recording about every 5 minutes / 30 m **with the screen off, the app swiped away, and after a
  restart** (needs "Allow all the time"), shown by the notification "Recording your location while you are on shift";
- stores points on the phone and sends them when there is signal – nothing is lost offline;
- a phone that is switched off records nothing; the route shows a gap for that time.
iPhones: the same app is built for iPhone too (see **iPhone app – free** below); without it, iPhones use the home-screen web app, which records only while it is open.

## One-time setup (GitHub)
1. **Signing key** – Actions → *Android signing key (one-time)* → Run, type a password. Download `ls-android-key`,
   add the three secrets it lists (Settings → Secrets and variables → Actions), keep `ls.keystore` safe, delete the download.
2. **Address** – Settings → Secrets and variables → Actions → Variables → `LS_WORKER_URL` = `https://<your-app>.azurestaticapps.net/worker/`.

## Each release
Actions → *Android app* → Run workflow. Download `ls-attendance-apk`, unzip, copy `ls-attendance.apk` to
`azure/web/worker/` and deploy. Android phones that open `/worker/` in Chrome then see **Get the LS Attendance app**.
With the signing key set, a new version installs over the old one; without it (debug build) the old app must be uninstalled first.

## On each phone (first time)
Open the link → download → allow "Install unknown apps" for Chrome → Install. Sign in, check in, and allow:
location **Allow all the time**, notifications **Allow**. Then Settings → Apps → LS Attendance → Battery →
**Unrestricted** (Samsung, Xiaomi, Oppo, Huawei otherwise stop it after a while).

## Quick test on one phone
Check in → lock the phone and walk ~200 m for 15 min → swipe the app away → restart the phone → walk again →
open the app, check out. In the tracker: Sync, Insights → pick the person → the route should show the whole walk.

## iPhone app – free
GitHub → Actions → **iPhone app** → Run workflow (same phone page address). It builds on GitHub's Mac machines
without an Apple account and gives `LS-Attendance-unsigned.ipa` (artifact `ls-attendance-ios`).

The iPhone recorder (`ios-src/LsTracker.swift`) keeps recording during the shift with the screen locked or the app in
the background (blue location indicator). With **Allow Always**, iOS restarts it after the app is closed or the phone
restarts (once the phone moves a few hundred metres); points wait on the phone until there is signal.

**Installing without paying Apple** – iPhones only run apps signed by Apple. Free signing uses each person's own Apple ID:
1. Install **SideStore** (or AltStore) once on the iPhone, following sidestore.io – this needs a computer the first time.
2. Copy `LS-Attendance-unsigned.ipa` to the phone and open it in SideStore; sign in with the person's Apple ID when asked.
3. Settings → General → VPN & Device Management → trust the developer (the person's Apple ID).
4. Open LS Attendance, sign in, check in; allow location **Always** and camera.

Limits Apple puts on free signing: the app must be refreshed in SideStore **every 7 days** (it stops opening otherwise),
and at most 3 such apps per phone. Fine for a pilot or a few supervisors; for all staff, an Apple Developer account
($99 / year) lets the same IPA be signed once for up to 100 iPhones (ad hoc) or distributed privately – no code change.
