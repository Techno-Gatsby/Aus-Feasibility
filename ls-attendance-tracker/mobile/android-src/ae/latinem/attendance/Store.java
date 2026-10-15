package ae.latinem.attendance;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** Settings of the open shift + the queue of recorded points (kept on the phone until sent). */
public class Store extends SQLiteOpenHelper {
    private static Store inst;
    private static final ExecutorService IO = Executors.newSingleThreadExecutor();

    static synchronized Store get(Context c) { if (inst == null) inst = new Store(c.getApplicationContext()); return inst; }
    static SharedPreferences prefs(Context c) { return c.getApplicationContext().getSharedPreferences("ls_tracker", Context.MODE_PRIVATE); }
    static boolean shiftOpen(Context c) { SharedPreferences p = prefs(c); return p.getBoolean("on", false) && System.currentTimeMillis() < p.getLong("until", 0); }

    private Store(Context c) { super(c, "ls_tracker.db", null, 1); }
    @Override public void onCreate(SQLiteDatabase db) { db.execSQL("CREATE TABLE q (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, lat REAL, lng REAL, acc REAL)"); }
    @Override public void onUpgrade(SQLiteDatabase db, int a, int b) { }

    synchronized void add(long ts, double lat, double lng, float acc) {
        ContentValues v = new ContentValues(); v.put("ts", ts); v.put("lat", lat); v.put("lng", lng); v.put("acc", acc);
        getWritableDatabase().insert("q", null, v);
        // keep at most ~3 days of points
        getWritableDatabase().execSQL("DELETE FROM q WHERE ts < ?", new Object[]{ System.currentTimeMillis() - 72L * 3600000L });
    }
    synchronized int count() { Cursor c = getReadableDatabase().rawQuery("SELECT COUNT(*) FROM q", null); try { return c.moveToFirst() ? c.getInt(0) : 0; } finally { c.close(); } }

    /** Send queued points to {api}/worker/ping in batches of 100. Safe to call often; runs off the main thread. */
    static void flush(Context ctx) {
        final Context c = ctx.getApplicationContext();
        IO.execute(() -> {
            SharedPreferences p = prefs(c);
            String api = p.getString("api", ""), token = p.getString("token", "");
            if (api.isEmpty() || token.isEmpty() || p.getBoolean("tokenExpired", false)) return;
            Store s = get(c);
            for (int round = 0; round < 50; round++) {
                List<Long> ids = new ArrayList<>(); StringBuilder json = new StringBuilder("{\"pts\":[");
                synchronized (s) {
                    Cursor cur = s.getReadableDatabase().rawQuery("SELECT id, ts, lat, lng, acc FROM q ORDER BY ts LIMIT 100", null);
                    try {
                        while (cur.moveToNext()) {
                            if (!ids.isEmpty()) json.append(',');
                            ids.add(cur.getLong(0));
                            json.append(String.format(Locale.US, "{\"ts\":%d,\"lat\":%.7f,\"lng\":%.7f,\"acc\":%.0f}", cur.getLong(1), cur.getDouble(2), cur.getDouble(3), cur.getDouble(4)));
                        }
                    } finally { cur.close(); }
                }
                if (ids.isEmpty()) return;
                json.append("]}");
                int code;
                try {
                    HttpURLConnection h = (HttpURLConnection) new URL(api.replaceAll("/+$", "") + "/worker/ping").openConnection();
                    h.setConnectTimeout(15000); h.setReadTimeout(20000); h.setDoOutput(true); h.setRequestMethod("POST");
                    h.setRequestProperty("Content-Type", "application/json"); h.setRequestProperty("Authorization", "Bearer " + token);
                    try (OutputStream o = h.getOutputStream()) { o.write(json.toString().getBytes(StandardCharsets.UTF_8)); }
                    code = h.getResponseCode(); h.disconnect();
                } catch (Exception e) { return; }                       // no signal: points stay queued
                if (code == 401) { p.edit().putBoolean("tokenExpired", true).apply(); return; }   // sent after the next sign-in
                if (code != 200 && code != 400) return;
                synchronized (s) { for (Long id : ids) s.getWritableDatabase().delete("q", "id=?", new String[]{ String.valueOf(id) }); }
                p.edit().putLong("lastSent", System.currentTimeMillis()).apply();
            }
        });
    }
}
