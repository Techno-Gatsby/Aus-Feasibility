// After `cap add android`, before `cap sync`: point the app at the deployed phone page, add the built-in
// location recorder (android-src), its permissions, service and restart receiver, and release signing.
// LS_WORKER_URL = https address of the phone page, e.g. https://<your-app>.azurestaticapps.net/worker/
import { readFileSync, writeFileSync, existsSync, cpSync } from 'node:fs';
const url = (process.env.LS_WORKER_URL || '').trim();
if (!/^https:\/\//.test(url)) { console.error('Set LS_WORKER_URL to the https address of the phone page'); process.exit(1); }
const cfg = JSON.parse(readFileSync('capacitor.config.json', 'utf8'));
cfg.server.url = url.endsWith('/') ? url : url + '/'; cfg.server.allowNavigation = [new URL(url).host];
writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2));

// iPhone: copy the recorder, use its view controller (registers the plugin), resume recording on every app start
if (process.argv[2] === 'ios') {
  const I = 'ios/App/App/';
  if (!existsSync(I + 'AppDelegate.swift')) { console.error('Run `npx cap add ios` first'); process.exit(1); }
  cpSync('ios-src/LsTracker.swift', I + 'LsTracker.swift');
  const sb = I + 'Base.lproj/Main.storyboard'; let x = readFileSync(sb, 'utf8');
  x = x.replace(/customClass="CAPBridgeViewController" customModule="Capacitor"/, 'customClass="LsBridgeViewController" customModule="App" customModuleProvider="target"'); writeFileSync(sb, x);
  let ad = readFileSync(I + 'AppDelegate.swift', 'utf8');
  if (!ad.includes('LsTracker.shared')) ad = ad.replace(/(didFinishLaunchingWithOptions[^{]*\{)/, '$1\n        LsTracker.shared.resumeIfShift()'); writeFileSync(I + 'AppDelegate.swift', ad);
  console.log('App opens', cfg.server.url, '· iPhone recorder added'); process.exit(0);
}
const A = 'android/app/', mf = A + 'src/main/AndroidManifest.xml', gr = A + 'build.gradle';
if (!existsSync(mf)) { console.error('Run `npx cap add android` first'); process.exit(1); }
cpSync('android-src', A + 'src/main/java', { recursive: true });           // MainActivity (registers the plugin) + tracker

let x = readFileSync(mf, 'utf8');
const perms = ['INTERNET', 'ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'ACCESS_BACKGROUND_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION',
  'POST_NOTIFICATIONS', 'RECEIVE_BOOT_COMPLETED', 'WAKE_LOCK', 'CAMERA'].filter(p => !x.includes(`android.permission.${p}"`))
  .map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
x = x.replace(/<application/, `${perms}\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n    <application`);
x = x.replace('</application>', `        <service android:name=".TrackerService" android:exported="false" android:foregroundServiceType="location" android:stopWithTask="false" />
        <receiver android:name=".BootReceiver" android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.BOOT_COMPLETED" />
                <action android:name="android.intent.action.MY_PACKAGE_REPLACED" />
            </intent-filter>
        </receiver>
    </application>`);
writeFileSync(mf, x);

let g = readFileSync(gr, 'utf8');
if (!g.includes('play-services-location')) g = g.replace(/dependencies\s*\{/, `dependencies {\n    implementation 'com.google.android.gms:play-services-location:21.3.0'`);
// release signing with a fixed key (secrets) so new versions install over old ones
if (process.env.LS_KEYSTORE && existsSync(process.env.LS_KEYSTORE)) g += `
android {
    signingConfigs { lsRelease { storeFile file(System.getenv("LS_KEYSTORE")); storePassword System.getenv("LS_KEYSTORE_PASSWORD"); keyAlias System.getenv("LS_KEY_ALIAS"); keyPassword System.getenv("LS_KEYSTORE_PASSWORD") } }
    buildTypes { release { signingConfig signingConfigs.lsRelease; minifyEnabled false } }
}
`;
writeFileSync(gr, g);
console.log('App opens', cfg.server.url, '· recorder added ·', process.env.LS_KEYSTORE ? 'release signing on' : 'no signing key – debug build');
