package com.ybex.app;

import android.os.Bundle;
import android.webkit.WebSettings;
import com.getcapacitor.BridgeActivity;

// v418: registers Ybex's own native plugin (MetaEventsPlugin: Meta app events + Google Play install referrer).
// Copied over the generated MainActivity by android-app/scripts/mac-prepare-android.sh.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MetaEventsPlugin.class);
        registerPlugin(MetaEventsPlugin.YbexBarsPlugin.class); // v430: status bar in the app's colour (Android 15+ too)
        super.onCreate(savedInstanceState);
        // v476 (Android QA A14): phone "Large / Huge font" (130–160%) cut the bottom nav labels ("Camp…") and broke
        // headings. Text still grows with the phone setting, but at most 115%.
        try {
            WebSettings ws = getBridge().getWebView().getSettings();
            int zoom = Math.round(getResources().getConfiguration().fontScale * 100);
            ws.setTextZoom(Math.max(100, Math.min(zoom, 115)));
        } catch (Exception ignored) { }
    }
}
