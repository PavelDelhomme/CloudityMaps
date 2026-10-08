package ovh.delhomme.maps

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.Locale

/**
 * Hubera Fuel depuis Maps.
 * openApp() : vraiment ouvrir l’app.
 * control() : broadcast + service headless — **jamais** d’Activity, Maps reste à l’écran.
 */
class FuelBridge(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var bringBack: Runnable? = null

    fun cancelBringBack() {
        bringBack?.let { main.removeCallbacks(it) }
        bringBack = null
    }

    private fun installedFuelPkg(preferNew: Boolean): String? {
        val order = if (preferNew) FUEL_PKGS else FUEL_PKGS.reversed()
        return order.firstOrNull { pkg ->
            runCatching { context.packageManager.getLaunchIntentForPackage(pkg) != null }
                .getOrDefault(false)
        }
    }

    /** Ouvre Hubera Fuel pour de vrai (garage, pleins, budget) — Maps ne reprend pas le premier plan.
     *  Prefere cloud.hubera.fuel (le compte owner) si les deux APK sont installes. */
    @JavascriptInterface
    fun openApp() {
        main.post {
            cancelBringBack()
            val pkg = installedFuelPkg(preferNew = true)
            if (pkg != null) {
                val launch = context.packageManager.getLaunchIntentForPackage(pkg) ?: return@post
                launch.addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP,
                )
                runCatching { context.startActivity(launch) }
                return@post
            }
            val view = Intent(Intent.ACTION_VIEW, Uri.parse("gasoiltracking://")).apply {
                setPackage(FUEL_PKG)
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TASK or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP,
                )
            }
            val launched = runCatching { context.startActivity(view) }.isSuccess
            if (!launched) openInstallPage()
        }
    }

    @JavascriptInterface
    fun isInstalled(): Boolean {
        return runCatching { installedFuelPkg(preferNew = true) != null }.getOrDefault(false)
    }

    private fun openInstallPage() {
        val install = Intent(Intent.ACTION_VIEW, Uri.parse(FUEL_INSTALL)).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(install) }
    }

    @JavascriptInterface
    fun control(action: String, payloadJson: String) {
        main.post {
            cancelBringBack()
            val extra = runCatching { JSONObject(payloadJson) }.getOrElse { JSONObject() }
            val act = action.lowercase(Locale.ROOT)
            val preferNew = extra.optString("preferLegacy") != "1"
            val extras = Bundle().apply {
                putString("action", act)
                putString("silent", "1")
                listOf("tripId", "dest", "liters", "total", "station", "vehicleId").forEach { key ->
                    val v = extra.optString(key)
                    if (v.isNotBlank()) putString(key, v)
                }
            }
            val chosen = installedFuelPkg(preferNew = preferNew)
            val targets = listOfNotNull(chosen).ifEmpty { FUEL_PKGS.take(1) }
            for (pkg in targets) {
                val bcast = Intent(ACTION_MAPS_CONTROL).apply {
                    setPackage(pkg)
                    putExtras(extras)
                    addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
                }
                runCatching { context.sendBroadcast(bcast) }
            }
            android.util.Log.i("FuelBridge", "control $act broadcast ${targets.joinToString()} , pas d'Activity")
        }
    }

    companion object {
        const val FUEL_PKG = "cloud.hubera.fuel"
        const val FUEL_PKG_LEGACY = "com.gasoiltracking.app"
        val FUEL_PKGS = listOf(FUEL_PKG, FUEL_PKG_LEGACY)
        const val FUEL_INSTALL = "https://fuel.hubera.cloud/install"
        const val ACTION_MAPS_CONTROL = "com.gasoiltracking.app.MAPS_CONTROL"
    }
}
