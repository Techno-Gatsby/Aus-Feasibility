# LS Attendance – Android app

The phone page (`Security Personnel Attendance.html`, deployed at `/worker/`) inside a small Android app.
The app adds one thing the web page cannot do: **it keeps recording the location during a shift with the
screen off or the app in the background** (open-source plugin `@capacitor-community/background-geolocation`, MIT).
A notification "Recording your location while you are on shift" shows while it records; it stops at check-out.
Points are stored on the phone and sent when there is signal, so nothing is lost offline.
A phone that is switched off cannot record anything; the route shows a gap for that time.

## Build (no Android Studio needed)
GitHub → Actions → **Android app** → Run workflow, with the phone page address
(e.g. `https://<your-app>.azurestaticapps.net/worker/`). Download `ls-attendance-apk` from the run and install
`app-debug.apk` on the phones (allow "install unknown apps"). Set the repository variable `LS_WORKER_URL` to
skip typing it.

## First start on a phone
Sign in as before. At the first check-in Android asks for location (choose **Allow while using the app**)
and notifications (allow). Battery: Settings → Apps → LS Attendance → Battery → **Unrestricted**, otherwise
some phones (Samsung, Xiaomi, Huawei) stop recording after a while.
