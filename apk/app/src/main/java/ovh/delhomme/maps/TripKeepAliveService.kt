package ovh.delhomme.maps

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.webkit.JavascriptInterface
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat

/**
 * Garde GPS + WebView vivants pendant un trajet Fuel / guidage
 * (écran éteint ou autre app au-dessus). Sans ça le trace s’arrête.
 */
class TripKeepAliveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        running = true
        ensureChannel()
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notif = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle("Trajet Hubera Maps")
            .setContentText("Position et tuiles restent actives.")
            .setContentIntent(open)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
        if (Build.VERSION.SDK_INT >= 34) {
            startForeground(NOTIF_ID, notif, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        } else {
            startForeground(NOTIF_ID, notif)
        }
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        super.onDestroy()
    }

    private fun ensureChannel() {
        if (Build.VERSION.SDK_INT < 26) return
        val nm = getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, "Trajets Maps", NotificationManager.IMPORTANCE_LOW),
        )
    }

    companion object {
        const val CHANNEL = "hubera_maps_trip"
        const val NOTIF_ID = 42

        @Volatile
        var running = false

        fun set(context: Context, on: Boolean) {
            val i = Intent(context, TripKeepAliveService::class.java)
            if (on) {
                ContextCompat.startForegroundService(context, i)
            } else {
                context.stopService(i)
                running = false
            }
        }
    }
}

class TripBridge(private val context: Context) {
    @JavascriptInterface
    fun setActive(on: Boolean) {
        android.os.Handler(android.os.Looper.getMainLooper()).post {
            if (on && Build.VERSION.SDK_INT >= 33 && context is android.app.Activity) {
                val perm = android.Manifest.permission.POST_NOTIFICATIONS
                if (androidx.core.content.ContextCompat.checkSelfPermission(context, perm) !=
                    android.content.pm.PackageManager.PERMISSION_GRANTED
                ) {
                    androidx.core.app.ActivityCompat.requestPermissions(
                        context,
                        arrayOf(perm),
                        71,
                    )
                }
            }
            TripKeepAliveService.set(context, on)
        }
    }
}
