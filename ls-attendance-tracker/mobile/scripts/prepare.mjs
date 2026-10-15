// Before `cap sync`: point the app at the deployed phone page and add the location permissions.
// LS_WORKER_URL = the Azure address of the phone page, e.g. https://<your-app>.azurestaticapps.net/worker/
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
const url = (process.env.LS_WORKER_URL || '').trim();
if (!/^https:\/\//.test(url)) { console.error('Set LS_WORKER_URL to the https address of the phone page'); process.exit(1); }
const cfg = JSON.parse(readFileSync('capacitor.config.json', 'utf8')); cfg.server.url = url.endsWith('/') ? url : url + '/';
cfg.server.allowNavigation = [new URL(url).host];
writeFileSync('capacitor.config.json', JSON.stringify(cfg, null, 2));
const mf = 'android/app/src/main/AndroidManifest.xml';
if (existsSync(mf)) {
  let x = readFileSync(mf, 'utf8');
  const perms = ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'FOREGROUND_SERVICE', 'FOREGROUND_SERVICE_LOCATION', 'POST_NOTIFICATIONS', 'CAMERA', 'WAKE_LOCK']
    .filter(p => !x.includes(`android.permission.${p}"`)).map(p => `    <uses-permission android:name="android.permission.${p}" />`).join('\n');
  x = x.replace('</manifest>', `${perms}\n    <uses-feature android:name="android.hardware.location.gps" android:required="false" />\n</manifest>`);
  writeFileSync(mf, x); console.log('Permissions added to', mf);
}
console.log('App opens', cfg.server.url);
