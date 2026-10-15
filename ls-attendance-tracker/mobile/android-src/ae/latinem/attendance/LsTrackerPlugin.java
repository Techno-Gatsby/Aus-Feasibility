package ae.latinem.attendance;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** Bridge for the phone page: start / stop recording for the shift, hand over a fresh sign-in, report status. */
@CapacitorPlugin(name = "LsTracker", permissions = {
    @Permission(alias = "location", strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }),
    @Permission(alias = "notifications", strings = { "android.permission.POST_NOTIFICATIONS" })
})
public class LsTrackerPlugin extends Plugin {
    private boolean granted(String p) { return ContextCompat.checkSelfPermission(getContext(), p) == PackageManager.PERMISSION_GRANTED; }

    @PluginMethod public void start(PluginCall call) {
        Store.prefs(getContext()).edit()
            .putBoolean("on", true).putString("api", call.getString("api", "")).putString("token", call.getString("token", ""))
            .putLong("until", call.getLong("until", System.currentTimeMillis() + 16L * 3600000L))
            .putString("msg", call.getString("msg", "Recording your location while you are on shift"))
            .putBoolean("tokenExpired", false).apply();
        try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), TrackerService.class)); call.resolve(status()); }
        catch (Exception e) { call.reject("Could not start recording: " + e.getMessage()); }
    }

    @PluginMethod public void stop(PluginCall call) {
        Store.prefs(getContext()).edit().putBoolean("on", false).apply();
        getContext().stopService(new Intent(getContext(), TrackerService.class));
        Store.flush(getContext());
        call.resolve(status());
    }

    @PluginMethod public void setToken(PluginCall call) {
        Store.prefs(getContext()).edit().putString("token", call.getString("token", "")).putString("api", call.getString("api", Store.prefs(getContext()).getString("api", ""))).putBoolean("tokenExpired", false).apply();
        Store.flush(getContext());
        if (Store.shiftOpen(getContext())) { try { ContextCompat.startForegroundService(getContext(), new Intent(getContext(), TrackerService.class)); } catch (Exception e) { } }
        call.resolve(status());
    }

    @PluginMethod public void status(PluginCall call) { call.resolve(status()); }

    /** Android 10+: "Allow all the time" lets recording resume by itself after a restart */
    @PluginMethod public void requestBackground(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 29 && !granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
            ActivityCompat.requestPermissions(getActivity(), new String[]{ Manifest.permission.ACCESS_BACKGROUND_LOCATION }, 7001);
        call.resolve(status());
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("running", Store.shiftOpen(getContext()));
        o.put("queued", Store.get(getContext()).count());
        o.put("lastSent", Store.prefs(getContext()).getLong("lastSent", 0));
        o.put("location", granted(Manifest.permission.ACCESS_FINE_LOCATION));
        o.put("background", Build.VERSION.SDK_INT < 29 || granted(Manifest.permission.ACCESS_BACKGROUND_LOCATION));
        o.put("tokenExpired", Store.prefs(getContext()).getBoolean("tokenExpired", false));
        return o;
    }
}
