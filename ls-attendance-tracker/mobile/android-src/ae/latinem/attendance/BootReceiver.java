package ae.latinem.attendance;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import androidx.core.content.ContextCompat;

/** After a restart or an app update: carry on recording if a shift is still open. */
public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context c, Intent i) {
        if (!Store.shiftOpen(c)) return;
        try { ContextCompat.startForegroundService(c, new Intent(c, TrackerService.class)); }
        catch (Exception e) { /* Android refused (no "Allow all the time"): resumes when the app is opened */ }
    }
}
