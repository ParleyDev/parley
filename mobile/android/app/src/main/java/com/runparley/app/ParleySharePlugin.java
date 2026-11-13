package com.runparley.app;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;

/**
 * Sharing into Parley from other apps (the system share sheet's ACTION_SEND / ACTION_SEND_MULTIPLE): the intent is
 * kept until the web client asks for it with `ParleyShare.take()` (it opens its "Share to…" picker), and a share
 * arriving while the app is open fires `shared` so it asks right away.
 */
@CapacitorPlugin(name = "ParleyShare")
public class ParleySharePlugin extends Plugin {
    /** Big files are left out (they'd be copied through the bridge in memory); the server's upload limit is lower anyway. */
    private static final long MAX_FILE = 100L * 1024 * 1024;
    private static final int MAX_FILES = 10;
    private Intent pending;

    static boolean isShare(Intent i) {
        return i != null && (Intent.ACTION_SEND.equals(i.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(i.getAction()));
    }

    @Override
    public void load() {
        Intent i = getActivity().getIntent();
        if (isShare(i)) pending = i;
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!isShare(intent)) return;
        pending = intent;
        notifyListeners("shared", new JSObject(), true);
    }

    @PluginMethod
    public void take(PluginCall call) {
        Intent i = pending;
        pending = null;
        JSObject out = new JSObject();
        if (i == null) { call.resolve(out); return; }
        // Taken: an activity recreated later (rotation) must not offer it again.
        getActivity().runOnUiThread(() -> getActivity().setIntent(new Intent(Intent.ACTION_MAIN)));
        CharSequence text = i.getCharSequenceExtra(Intent.EXTRA_TEXT);
        if (text != null) out.put("text", text.toString());
        String subject = i.getStringExtra(Intent.EXTRA_SUBJECT);
        if (subject != null) out.put("title", subject);
        ArrayList<Uri> uris = new ArrayList<>();
        if (Intent.ACTION_SEND_MULTIPLE.equals(i.getAction())) {
            ArrayList<Uri> list = i.getParcelableArrayListExtra(Intent.EXTRA_STREAM);
            if (list != null) uris.addAll(list);
        } else {
            Uri u = i.getParcelableExtra(Intent.EXTRA_STREAM);
            if (u != null) uris.add(u);
        }
        JSArray files = new JSArray();
        ContentResolver cr = getContext().getContentResolver();
        for (Uri u : uris) {
            if (files.length() >= MAX_FILES) break;
            try {
                JSObject f = read(cr, u, i.getType());
                if (f != null) files.put(f);
            } catch (Exception e) {
                // One unreadable item doesn't stop the rest.
            }
        }
        if (files.length() > 0) out.put("files", files);
        call.resolve(out);
    }

    private JSObject read(ContentResolver cr, Uri u, String fallbackType) throws Exception {
        String name = null;
        long size = -1;
        try (Cursor c = cr.query(u, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME), s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0) name = c.getString(n);
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
            }
        }
        if (size > MAX_FILE) return null;
        String type = cr.getType(u);
        if (type == null) type = fallbackType != null && !fallbackType.contains("*") ? fallbackType : "application/octet-stream";
        if (name == null) name = u.getLastPathSegment() != null ? u.getLastPathSegment() : "file";
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        try (InputStream in = cr.openInputStream(u)) {
            if (in == null) return null;
            byte[] chunk = new byte[64 * 1024];
            int r;
            while ((r = in.read(chunk)) != -1) {
                buf.write(chunk, 0, r);
                if (buf.size() > MAX_FILE) return null;
            }
        }
        JSObject f = new JSObject();
        f.put("name", name);
        f.put("type", type);
        f.put("data", Base64.encodeToString(buf.toByteArray(), Base64.NO_WRAP));
        return f;
    }
}
