package ovh.delhomme.maps

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.util.Locale

/**
 * GPS natif → JS. Le WebView Chromium filtre souvent les positions mock
 * (`cmd location`) : sans ce pont, la pastille reste sur last-me réel.
 */
class LocationBridge(
    private val activity: Activity,
    private val web: () -> WebView?,
) : LocationListener {
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var watching = false
    @Volatile private var last: Location? = null
    private val poll = object : Runnable {
        override fun run() {
            if (!watching) return
            pushLastKnown()
            main.postDelayed(this, 900)
        }
    }

    @JavascriptInterface
    fun hasPermission(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            activity,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        return fine
    }

    @JavascriptInterface
    fun gpsEnabled(): Boolean {
        val lm = activity.getSystemService(LocationManager::class.java) ?: return false
        return runCatching {
            // Interrupteur Android « Localisation ». isProviderEnabled(GPS) peut
            // rester faux au démarrage ou en économie alors que le réglage est actif.
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && lm.isLocationEnabled) {
                return@runCatching true
            }
            val fused = Build.VERSION.SDK_INT >= 31 &&
                lm.isProviderEnabled(LocationManager.FUSED_PROVIDER)
            lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ||
                lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER) ||
                fused
        }.getOrDefault(false)
    }

    @JavascriptInterface
    fun requestPermission() {
        activity.runOnUiThread {
            ActivityCompat.requestPermissions(
                activity,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                71,
            )
        }
    }

    @JavascriptInterface
    fun openSettings() {
        activity.runOnUiThread {
            runCatching {
                activity.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS))
            }
        }
    }

    @JavascriptInterface
    fun startWatch() {
        main.post { startWatchUi() }
    }

    @JavascriptInterface
    fun stopWatch() {
        main.post { stopWatchUi() }
    }

    @JavascriptInterface
    fun lastFixJson(): String {
        val loc = last ?: return ""
        return jsonOf(loc).toString()
    }

    fun startWatchUi() {
        if (watching) return
        if (!hasPermission()) return
        val lm = activity.getSystemService(LocationManager::class.java) ?: return
        watching = true
        for (p in providersOf(lm)) {
            runCatching {
                lm.requestLocationUpdates(p, 700L, 0f, this, Looper.getMainLooper())
            }.onFailure { Log.w(TAG, "watch $p: ${it.message}") }
        }
        pushLastKnown()
        main.removeCallbacks(poll)
        main.post(poll)
    }

    fun stopWatchUi() {
        if (!watching) return
        watching = false
        main.removeCallbacks(poll)
        val lm = activity.getSystemService(LocationManager::class.java) ?: return
        runCatching { lm.removeUpdates(this) }
    }

    private fun providersOf(lm: LocationManager): List<String> {
        return lm.allProviders.filter { it.isNotBlank() }
    }

    private fun pushLastKnown() {
        val lm = activity.getSystemService(LocationManager::class.java) ?: return
        val fixes = providersOf(lm).mapNotNull { p ->
            runCatching { lm.getLastKnownLocation(p) }.getOrNull()
        }
        val mock = fixes.filter { isMock(it) }.maxByOrNull { it.time }
        val real = fixes.filter { !isMock(it) }.maxByOrNull { it.time }
        val chosen = when {
            mock != null && System.currentTimeMillis() - mock.time < 120_000L -> mock
            real != null -> real
            else -> return
        }
        push(chosen)
    }

    override fun onLocationChanged(location: Location) {
        val cur = last
        if (cur != null && isMock(cur) && !isMock(location) && location.time - cur.time < 60_000L) {
            return
        }
        push(location)
    }

    @Deprecated("Deprecated in Java")
    override fun onLocationChanged(locations: MutableList<Location>) {
        locations.lastOrNull()?.let { onLocationChanged(it) }
    }

    @Deprecated("Deprecated in Java")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit

    override fun onProviderEnabled(provider: String) = Unit

    override fun onProviderDisabled(provider: String) = Unit

    private fun isMock(loc: Location): Boolean {
        return if (Build.VERSION.SDK_INT >= 31) loc.isMock else @Suppress("DEPRECATION") loc.isFromMockProvider
    }

    private fun jsonOf(loc: Location): JSONObject {
        return JSONObject()
            .put("lat", loc.latitude)
            .put("lon", loc.longitude)
            .put("acc", loc.accuracy.toDouble())
            .put("mock", isMock(loc))
            .put("provider", loc.provider ?: "")
    }

    private fun push(loc: Location) {
        val prev = last
        if (prev != null &&
            prev.latitude == loc.latitude &&
            prev.longitude == loc.longitude &&
            isMock(prev) == isMock(loc) &&
            loc.time - prev.time < 400
        ) {
            return
        }
        last = loc
        val mock = isMock(loc)
        Log.i(TAG, "fix ${loc.latitude},${loc.longitude} acc=${loc.accuracy} mock=$mock p=${loc.provider}")
        val js = String.format(
            Locale.US,
            "window.__mapsNativeFix&&window.__mapsNativeFix(%f,%f,%f,%s)",
            loc.latitude,
            loc.longitude,
            loc.accuracy,
            mock,
        )
        main.post {
            runCatching { web()?.evaluateJavascript(js, null) }
        }
    }

    companion object {
        private const val TAG = "HuberaLoc"
    }
}
