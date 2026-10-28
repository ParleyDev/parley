package com.runparley.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Keeps a call going while Parley is in the background. Android silences the microphone of apps in the background
 * (and may stop them) unless they run a foreground service, which shows as the ongoing "In a call" notification.
 * Started and stopped from the web app through CallKeepAlivePlugin when a call starts and ends.
 */
public class CallService extends Service {
    static final String CHANNEL = "calls";
    static final int ID = 4711;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String title = intent != null && intent.getStringExtra("title") != null ? intent.getStringExtra("title") : "In a call";
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Calls", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while you're in a voice or video call");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT);
        PendingIntent tap = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification n = new NotificationCompat.Builder(this, CHANNEL)
                .setContentTitle(title)
                .setContentText("Tap to return to the call")
                .setSmallIcon(getApplicationInfo().icon)
                .setOngoing(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setContentIntent(tap)
                .build();
        // Microphone needs the permission already granted; without it, fall back to keeping playback alive.
        int[] types = Build.VERSION.SDK_INT >= Build.VERSION_CODES.R
                ? new int[] { ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK }
                : new int[] { 0 };
        for (int type : types) {
            try {
                ServiceCompat.startForeground(this, ID, n, type);
                return START_NOT_STICKY;
            } catch (RuntimeException e) {
                // Not allowed with this type: try the next.
            }
        }
        stopSelf();
        return START_NOT_STICKY;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        // The app was swiped away: the call is over.
        stopSelf();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
