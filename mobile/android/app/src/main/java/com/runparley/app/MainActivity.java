package com.runparley.app;

import android.os.Bundle;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        // Passkeys and security keys: Android's web view only runs WebAuthn when the app opts in, and then only for
        // sites whose /.well-known/assetlinks.json lists this app (ANDROID_APP_CERTS on the server).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(getBridge().getWebView().getSettings(), WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
        }
    }
}
