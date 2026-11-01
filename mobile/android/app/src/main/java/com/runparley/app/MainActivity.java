package com.runparley.app;

import android.app.DownloadManager;
import android.net.Uri;
import android.os.Bundle;
import android.os.Environment;
import android.webkit.CookieManager;
import android.webkit.URLUtil;
import android.widget.Toast;
import androidx.webkit.WebSettingsCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CallKeepAlivePlugin.class);
        super.onCreate(savedInstanceState);
        // Passkeys and security keys: Android's web view only runs WebAuthn when the app opts in, and then only for
        // sites whose /.well-known/assetlinks.json lists this app (ANDROID_APP_CERTS on the server).
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_AUTHENTICATION)) {
            WebSettingsCompat.setWebAuthenticationSupport(getBridge().getWebView().getSettings(), WebSettingsCompat.WEB_AUTHENTICATION_SUPPORT_FOR_APP);
        }
        // Save buttons (attachments' ?download=1 links): the web view can't save files itself, so hand them to the
        // system's download manager, which shows progress and puts them in Downloads.
        getBridge().getWebView().setDownloadListener((url, userAgent, disposition, mimeType, length) -> {
            if (!url.startsWith("http")) return;
            try {
                String name = URLUtil.guessFileName(url, disposition, mimeType);
                DownloadManager.Request req = new DownloadManager.Request(Uri.parse(url))
                    .setMimeType(mimeType)
                    .setTitle(name)
                    .addRequestHeader("User-Agent", userAgent)
                    .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                    .setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, name);
                String cookies = CookieManager.getInstance().getCookie(url);
                if (cookies != null) req.addRequestHeader("Cookie", cookies);
                ((DownloadManager) getSystemService(DOWNLOAD_SERVICE)).enqueue(req);
                Toast.makeText(this, "Downloading " + name, Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Couldn't download that file", Toast.LENGTH_SHORT).show();
            }
        });
    }
}
