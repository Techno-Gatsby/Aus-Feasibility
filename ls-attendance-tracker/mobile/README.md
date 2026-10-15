# LS Attendance – Android app (installed from your own Azure site, no Play Store)

The phone page inside a small Android app, plus a **built-in location recorder** (`android-src/`):
- starts at check-in, stops at check-out (safety stop after 16 h);
- keeps recording about every 5 minutes / 30 m **with the screen off, the app swiped away, and after a
  restart** (needs "Allow all the time"), shown by the notification "Recording your location while you are on shift";
- stores points on the phone and sends them when there is signal – nothing is lost offline;
- a phone that is switched off records nothing; the route shows a gap for that time.
iPhones use the home-screen web app (records while the app is open – Apple allows background recording only for App Store / Apple-distributed apps).

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
