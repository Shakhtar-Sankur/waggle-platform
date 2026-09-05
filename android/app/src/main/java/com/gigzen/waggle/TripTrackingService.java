package com.gigzen.waggle;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ConcurrentLinkedQueue;

/**
 * Keeps a trip recording while the driver's phone is in their pocket.
 *
 * WHY THIS EXISTS AT ALL
 *
 * Everything the app did before ran in the WebView. That is fine while the
 * screen is on and completely broken the moment it is not: since Android 10, an
 * app with no visible activity and no location foreground service simply stops
 * receiving fixes. A driver would press Start, lock their phone, drive for four
 * hours, and come back to the distance they had when the screen went dark — with
 * the panel still cheerfully reading "Recording activity". Earnings are distance
 * times rate, so that is not a display bug, it is the driver's pay.
 *
 * WHY A FOREGROUND SERVICE AND NOT ACCESS_BACKGROUND_LOCATION
 *
 * They solve different problems, and only one of them fits this app. A location
 * foreground service, started while the app is visible, keeps FULL-RATE location
 * access with the screen off — which is exactly and only what recording a trip
 * the driver explicitly started requires. ACCESS_BACKGROUND_LOCATION is for
 * apps that need location when the user has not asked for anything, and Google
 * Play gates it behind a written declaration and a manual review. This app never
 * needs that: there is no tracking without a trip, and no trip without the
 * driver pressing Start. The permission is deliberately absent.
 *
 * WHY THE SERVICE COLLECTS FIXES ITSELF
 *
 * Keeping the process alive is necessary but not sufficient. A backgrounded
 * WebView has its timers throttled and its JavaScript starved, so routing every
 * fix straight into JS would still lose them — just later in the chain. Instead
 * this service asks the platform for locations directly and buffers them, and
 * the JavaScript side drains that buffer whenever it is awake enough to do so.
 * Nothing is lost while it sleeps; it just arrives in a batch.
 *
 * Each buffered fix keeps the timestamp it was RECORDED at, never the time it
 * was drained. The tracking store rejects any pair implying more than 200 km/h,
 * so stamping a batch with "now" would make an hour of honest driving look like
 * a teleport and the store would throw all of it away.
 */
public class TripTrackingService extends Service {

    public static final String ACTION_START = "com.gigzen.waggle.TRACKING_START";
    public static final String ACTION_STOP = "com.gigzen.waggle.TRACKING_STOP";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_TEXT = "text";
    /** Per-km rate and currency symbol, so the notification can show earnings.
     *  Passed in by the app because the rate and the symbol are the driver's
     *  settings, and this service has no access to them. */
    public static final String EXTRA_RATE = "rate";
    public static final String EXTRA_CURRENCY = "currency";
    /** Localised "km", so the notification is not the one English string left
     *  on an otherwise translated phone. */
    public static final String EXTRA_UNIT = "unit";

    private static final String CHANNEL_ID = "waggle_trip_tracking";
    private static final int NOTIFICATION_ID = 4711;

    /** Ask for a fix at most this often, and only once the driver has moved. */
    private static final long MIN_INTERVAL_MS = 2000L;
    private static final float MIN_DISTANCE_M = 5f;

    /**
     * Roughly a day of driving at the rate above. The buffer only grows while
     * the app is asleep, and the drain empties it on every resume, so reaching
     * this at all means something is very wrong. Dropping the OLDEST fix is the
     * least-bad answer: it costs one segment of an already-lost trip, where
     * refusing the newest would silently stop recording from here on.
     */
    private static final int MAX_BUFFERED = 50000;

    private static final ConcurrentLinkedQueue<JSONObject> BUFFER = new ConcurrentLinkedQueue<>();
    private static volatile boolean running = false;

    /*
     * The same gates useLocationStore applies, for the same reasons: below 15 m
     * is GPS noise rather than travel, a fix that cannot place you inside 100 m
     * is not worth counting, and no road vehicle covers ground at 200 km/h.
     * Kept in step with src/stores/useLocationStore.ts — if those change, these
     * change with them or the notification and the app start disagreeing.
     */
    private static final double MIN_MOVE_KM = 0.015;
    private static final double MAX_ACCURACY_M = 100.0;
    private static final double MAX_PLAUSIBLE_KMH = 200.0;

    /** Live trip state, for the notification only. */
    private static volatile double totalKm = 0.0;
    private static volatile long startedAt = 0L;
    private static volatile double lastLat = Double.NaN;
    private static volatile double lastLng = Double.NaN;
    private static volatile long lastFixAt = 0L;
    /** Throttle: redrawing the notification on every fix is 30 redraws a minute
     *  for a number that changes in the first decimal place. */
    private static volatile long lastNotifiedAt = 0L;
    private static volatile double lastNotifiedKm = -1.0;

    private static volatile double ratePerKm = 0.0;
    private static volatile String currencySymbol = "";
    private static volatile String distanceUnit = "km";
    private static volatile String notifTitle = "Waggle";

    /**
     * Replace the running total with the app's own figure.
     *
     * The app applies a couple of filters this service does not, so after a
     * long locked stretch the two can differ slightly. Whenever the app is
     * open it drains the buffer and calls this, which makes its number the one
     * on the notification and stops any drift accumulating across a shift.
     */
    static void syncDistance(double km) {
        if (km >= 0) totalKm = km;
    }

    static double currentDistanceKm() {
        return totalKm;
    }

    private LocationManager locationManager;

    /** The live service, so the static fix handler can ask it to redraw the
     *  notification. Cleared on destroy so nothing holds a dead context. */
    private static volatile TripTrackingService instance;

    /*
     * onStatusChanged and friends are deprecated from API 29 and gained default
     * implementations at API 30 — but this app supports API 24, where the
     * interface still declares them abstract. Dropping them would compile
     * cleanly against SDK 36 and throw AbstractMethodError on an older phone,
     * which is the half of the driver base least likely to have a spare one.
     */
    @SuppressWarnings("deprecation")
    private final LocationListener listener = new LocationListener() {
        @Override
        public void onLocationChanged(Location location) {
            record(location);
        }

        // Required by the pre-API-29 interface. A provider going offline mid-trip
        // is not an error worth surfacing — GPS drops under bridges and comes
        // back, and the driver can do nothing about either.
        @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
        @Override public void onProviderEnabled(String provider) {}
        @Override public void onProviderDisabled(String provider) {}
    };

    /** Fixes recorded since the last drain, oldest first. Clears as it returns. */
    public static List<JSONObject> drain() {
        List<JSONObject> out = new ArrayList<>();
        JSONObject next;
        while ((next = BUFFER.poll()) != null) {
            out.add(next);
        }
        return out;
    }

    public static boolean isRunning() {
        return running;
    }

    private static void record(Location location) {
        try {
            JSONObject fix = new JSONObject();
            fix.put("lat", location.getLatitude());
            fix.put("lng", location.getLongitude());
            fix.put("accuracy", location.getAccuracy());
            // getTime() is when the fix was OBSERVED. See the class comment:
            // replacing this with the drain time makes a real trip look like a
            // teleport and the tracking store discards it.
            fix.put("timestamp", location.getTime());
            while (BUFFER.size() >= MAX_BUFFERED) {
                BUFFER.poll();
            }
            BUFFER.add(fix);
            accumulate(location);
            TripTrackingService live = instance;
            if (live != null) live.refreshNotification();
        } catch (JSONException ignored) {
            // A fix we cannot serialise is a fix we cannot use. Losing one is
            // survivable; throwing here would take the whole service down and
            // lose the rest of the trip with it.
        }
    }

    /**
     * Add one fix to the running total, applying the same gates as the app.
     *
     * Static because record() is, and record() is static because the buffer
     * outlives any one service instance.
     */
    private static void accumulate(Location location) {
        long now = location.getTime();
        if (location.hasAccuracy() && location.getAccuracy() > MAX_ACCURACY_M) return;

        if (!Double.isNaN(lastLat)) {
            double km = haversineKm(lastLat, lastLng, location.getLatitude(), location.getLongitude());
            long ms = now - lastFixAt;
            // Below the noise floor is not travel.
            double gate = Math.max(MIN_MOVE_KM,
                (location.hasAccuracy() ? location.getAccuracy() : 0) / 1000.0);
            if (km < gate) return;
            if (ms > 0 && km / (ms / 3600000.0) > MAX_PLAUSIBLE_KMH) return;
            totalKm += km;
        }
        lastLat = location.getLatitude();
        lastLng = location.getLongitude();
        lastFixAt = now;
    }

    private static double haversineKm(double lat1, double lng1, double lat2, double lng2) {
        double r = 6371.0088;
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                 + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                 * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * r * Math.asin(Math.min(1.0, Math.sqrt(a)));
    }

    /** "12.4 km · ₹124 · 1h 03m" — what the trip is worth, at a glance. */
    private String liveText() {
        StringBuilder sb = new StringBuilder();
        sb.append(String.format(java.util.Locale.getDefault(), "%.1f %s", totalKm, distanceUnit));
        if (ratePerKm > 0 && !currencySymbol.isEmpty()) {
            sb.append(" · ").append(currencySymbol)
              .append(String.format(java.util.Locale.getDefault(), "%.0f", totalKm * ratePerKm));
        }
        if (startedAt > 0) {
            long mins = Math.max(0, (System.currentTimeMillis() - startedAt) / 60000L);
            sb.append(" · ");
            if (mins >= 60) {
                sb.append(String.format(java.util.Locale.getDefault(), "%dh %02dm", mins / 60, mins % 60));
            } else {
                sb.append(String.format(java.util.Locale.getDefault(), "%dm", mins));
            }
        }
        return sb.toString();
    }

    /**
     * Redraw the ongoing notification, at most every 10 seconds and only when
     * the distance has actually moved. An ongoing notification that rewrites
     * itself constantly costs battery and makes the shade flicker.
     */
    private void refreshNotification() {
        long now = System.currentTimeMillis();
        boolean moved = Math.abs(totalKm - lastNotifiedKm) >= 0.05;
        if (!moved && now - lastNotifiedAt < 30000L) return;
        if (now - lastNotifiedAt < 10000L) return;
        lastNotifiedAt = now;
        lastNotifiedKm = totalKm;

        NotificationManager manager =
            (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        manager.notify(NOTIFICATION_ID, buildNotification(notifTitle, liveText()));
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopTracking();
            return START_NOT_STICKY;
        }

        String title = "Waggle";
        String text = "Recording your trip";
        if (intent != null) {
            if (intent.getStringExtra(EXTRA_TITLE) != null) title = intent.getStringExtra(EXTRA_TITLE);
            if (intent.getStringExtra(EXTRA_TEXT) != null) text = intent.getStringExtra(EXTRA_TEXT);
            ratePerKm = intent.getDoubleExtra(EXTRA_RATE, 0.0);
            if (intent.getStringExtra(EXTRA_CURRENCY) != null) currencySymbol = intent.getStringExtra(EXTRA_CURRENCY);
            if (intent.getStringExtra(EXTRA_UNIT) != null) distanceUnit = intent.getStringExtra(EXTRA_UNIT);
            notifTitle = title;

            /* A fresh start is a fresh trip. Without this the counters carry
               over from the previous recording and the notification opens at
               yesterday's distance. */
            if (!running) {
                totalKm = 0.0;
                startedAt = System.currentTimeMillis();
                lastLat = Double.NaN;
                lastLng = Double.NaN;
                lastFixAt = 0L;
                lastNotifiedAt = 0L;
                lastNotifiedKm = -1.0;
            }
            instance = this;
        }

        startInForeground(title, text);
        requestUpdates();
        running = true;

        // REDELIVER rather than STICKY: if the system restarts us we want the
        // driver's own notification text back, not a null intent and an English
        // default in front of someone reading Bengali.
        return START_REDELIVER_INTENT;
    }

    /**
     * One builder for both the first notification and every refresh.
     *
     * setOnlyAlertOnce matters here: without it, a notification that rewrites
     * itself every ten seconds re-alerts every ten seconds. The channel is
     * IMPORTANCE_LOW so there is no sound either way, but the shade still
     * reorders and animates without it.
     */
    private Notification buildNotification(String title, String text) {
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent tap = PendingIntent.getActivity(
            this, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        return new NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_waggle)
            .setColor(0xFF4F46E5)
            .setContentIntent(tap)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            // Show the live figures on the lock screen too. This is the whole
            // point: the driver's phone is in their pocket.
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .build();
    }

    private void startInForeground(String title, String text) {
        NotificationManager manager = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Trip recording",
                // LOW: this notification exists because the platform requires
                // one, and because the driver is entitled to see that they are
                // being recorded. It is not news. No sound, no vibration, no
                // interrupting someone in traffic.
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Shown while a trip is being recorded.");
            channel.setShowBadge(false);
            if (manager != null) manager.createNotificationChannel(channel);
        }


        Notification notification = buildNotification(title, text);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            // Declaring the type is what actually buys the location access; on
            // Android 14+ starting a typed service without it throws.
            startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        } else {
            startForeground(NOTIFICATION_ID, notification);
        }
    }

    private void requestUpdates() {
        if (locationManager != null) return;

        boolean granted = ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED;
        if (!granted) {
            // The JavaScript side asks for permission before starting us, so
            // this means it was revoked from Settings mid-trip. Stop cleanly
            // rather than sitting in the status bar recording nothing.
            stopTracking();
            return;
        }

        locationManager = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (locationManager == null) return;

        try {
            if (locationManager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.GPS_PROVIDER, MIN_INTERVAL_MS, MIN_DISTANCE_M, listener
                );
            }
            // Network positions as well as, not instead of, GPS. Indoors and in
            // an underground car park GPS returns nothing at all, and a coarse
            // fix beats a hole in the trace; the 15 m movement gate upstream
            // throws away the imprecise ones that did not move anybody.
            if (locationManager.isProviderEnabled(LocationManager.NETWORK_PROVIDER)) {
                locationManager.requestLocationUpdates(
                    LocationManager.NETWORK_PROVIDER, MIN_INTERVAL_MS, MIN_DISTANCE_M, listener
                );
            }
        } catch (SecurityException revoked) {
            stopTracking();
        }
    }

    private void stopTracking() {
        if (locationManager != null) {
            try {
                locationManager.removeUpdates(listener);
            } catch (SecurityException ignored) {
                // Already gone. Nothing to release.
            }
            locationManager = null;
        }
        running = false;
        // The boolean overload is deprecated from API 33; the constant it
        // replaced exists from 24, which is this app's minimum.
        stopForeground(STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopTracking();
        // Do not leave a dead service reachable from the static fix handler.
        if (instance == this) instance = null;
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        // Nothing binds to this. The plugin talks to it through static state and
        // startService intents, which survives the service being restarted by
        // the system in a way a binding would not.
        return null;
    }
}
