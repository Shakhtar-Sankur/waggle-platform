package com.gigzen.waggle;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Registered BEFORE super.onCreate: the bridge builds its plugin
        // registry during that call, and anything added afterwards is invisible
        // to JavaScript.
        registerPlugin(TripTrackingPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
