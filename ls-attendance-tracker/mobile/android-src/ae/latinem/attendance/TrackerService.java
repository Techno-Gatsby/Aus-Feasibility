package ae.latinem.attendance;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import com.google.android.gms.location.FusedLocationProviderClient;
import com.google.android.gms.location.LocationCallback;
import com.google.android.gms.location.LocationRequest;
import com.google.android.gms.location.LocationResult;
import com.google.android.gms.location.LocationServices;
import com.google.android.gms.location.Priority;

/** Records the location while a shift is open – screen off, app swiped away or after a restart – until check-out. */
public class TrackerService extends Service {
    static final String CHANNEL = "ls_tracker";
    private FusedLocationProviderClient fused;
    private LocationCallback callback;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (!Store.shiftOpen(TrackerService.this)) { stopSelf(); return; }
            Store.flush(TrackerService.this);
            handler.postDelayed(this, 3 * 60000L);
        }
    };

    @Override public IBinder onBind(Intent i) { return null; }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (!Store.shiftOpen(this)) { stopSelf(); return START_NOT_STICKY; }
        Notification n = notification();
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0;
        try { ServiceCompat.startForeground(this, 1, n, type); } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (callback == null) startUpdates();
        handler.removeCallbacks(tick); handler.post(tick);
        return START_STICKY;
    }

    private void startUpdates() {
        fused = LocationServices.getFusedLocationProviderClient(this);
        callback = new LocationCallback() {
            @Override public void onLocationResult(LocationResult r) {
                for (Location l : r.getLocations()) Store.get(TrackerService.this).add(l.getTime(), l.getLatitude(), l.getLongitude(), l.getAccuracy());
                Store.flush(TrackerService.this);
                if (!Store.shiftOpen(TrackerService.this)) stopSelf();
            }
        };
        // every 5 minutes, or sooner after moving 30 m
        LocationRequest req = new LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 5 * 60000L)
            .setMinUpdateIntervalMillis(60000L).setMinUpdateDistanceMeters(30f).setWaitForAccurateLocation(false).build();
        try { fused.requestLocationUpdates(req, callback, Looper.getMainLooper()); }
        catch (SecurityException e) { stopSelf(); }
    }

    private Notification notification() {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null)
            nm.createNotificationChannel(new NotificationChannel(CHANNEL, "Shift location", NotificationManager.IMPORTANCE_LOW));
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("LS Attendance")
            .setContentText(Store.prefs(this).getString("msg", "Recording your location while you are on shift"))
            .setOngoing(true).setContentIntent(pi).setPriority(NotificationCompat.PRIORITY_LOW).build();
    }

    @Override public void onTaskRemoved(Intent rootIntent) { /* keeps running when the app is swiped away */ }

    @Override public void onDestroy() {
        handler.removeCallbacks(tick);
        if (fused != null && callback != null) fused.removeLocationUpdates(callback);
        Store.flush(this);
        super.onDestroy();
    }
}
