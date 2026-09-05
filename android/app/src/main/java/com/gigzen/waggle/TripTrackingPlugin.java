package com.gigzen.waggle;

import android.content.Intent;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.List;

/**
 * The JavaScript handle on {@link TripTrackingService}.
 *
 * Four methods and no events, on purpose. An event per fix would race the
 * buffer: a fix delivered live is still sitting in the queue waiting to be
 * drained, so the same metre of road gets counted twice — and distance times
 * rate is the driver's pay, so double-counting is not a cosmetic bug either.
 * Draining is the single path, which makes "has this fix been counted?" a
 * question with one answer instead of two.
 *
 * The notification's words arrive from JavaScript rather than living in
 * strings.xml, because the app speaks 43 languages and its translations are all
 * on that side. A second copy in Android resources would be the one nobody
 * remembers to update.
 */
@CapacitorPlugin(name = "TripTracking")
public class TripTrackingPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        Intent intent = new Intent(getContext(), TripTrackingService.class);
        intent.setAction(TripTrackingService.ACTION_START);
        intent.putExtra(TripTrackingService.EXTRA_TITLE, call.getString("title", "Waggle"));
        intent.putExtra(TripTrackingService.EXTRA_TEXT, call.getString("text", "Recording your trip"));
        Double rate = call.getDouble("rate");
        intent.putExtra(TripTrackingService.EXTRA_RATE, rate == null ? 0.0 : rate);
        intent.putExtra(TripTrackingService.EXTRA_CURRENCY, call.getString("currency", ""));
        intent.putExtra(TripTrackingService.EXTRA_UNIT, call.getString("unit", "km"));

        try {
            ContextCompat.startForegroundService(getContext(), intent);
            call.resolve();
        } catch (Exception error) {
            // Most likely ForegroundServiceStartNotAllowedException: Android 12+
            // refuses to start a foreground service from the background. The
            // driver pressed a button, so the app IS foreground and this should
            // not happen — but if it does, JavaScript needs to hear about it so
            // it can fall back rather than believe it is recording.
            call.reject("Could not start trip recording: " + error.getMessage(), error);
        }
    }

    /**
     * Hand the service the app's own distance.
     *
     * The service counts independently so the notification stays live while the
     * phone is locked and the WebView is suspended. It applies the same gates
     * but not every one of them, so the two can drift over a long stretch —
     * this makes the app's figure authoritative whenever the app is awake.
     */
    @PluginMethod
    public void sync(PluginCall call) {
        Double km = call.getDouble("distanceKm");
        if (km != null) TripTrackingService.syncDistance(km);
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Intent intent = new Intent(getContext(), TripTrackingService.class);
        intent.setAction(TripTrackingService.ACTION_STOP);
        // startService, not stopService: the service stops ITSELF once it has
        // released the location listener. Killing it from out here would leave
        // the platform still delivering updates to a dead object.
        getContext().startService(intent);
        call.resolve();
    }

    /** Everything recorded since the last call, oldest first, and clears it. */
    @PluginMethod
    public void drain(PluginCall call) {
        List<JSONObject> fixes = TripTrackingService.drain();
        JSArray out = new JSArray();
        for (JSONObject fix : fixes) {
            out.put(fix);
        }
        JSObject result = new JSObject();
        result.put("fixes", out);
        call.resolve(result);
    }

    @PluginMethod
    public void isRunning(PluginCall call) {
        JSObject result = new JSObject();
        result.put("running", TripTrackingService.isRunning());
        call.resolve(result);
    }
}
