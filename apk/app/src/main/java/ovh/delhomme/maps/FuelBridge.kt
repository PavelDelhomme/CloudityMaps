package ovh.delhomme.maps

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONObject
import java.util.Locale

/**
 * Commande Hubera Fuel depuis Maps sans rester sur l’UI Fuel :
 * deep link silencieux. Maps ne reprend le premier plan qu’après
 * que Fuel ait eu le temps de démarrer le GPS (FGS), sinon le suivi
 * libre meurt (le vol à 320 ms tuait getCurrentLocation).
 * Fuel ramène Maps via hubera-maps://fuel ; le délai est un filet.
 */
class FuelBridge(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var bringBack: Runnable? = null

    fun cancelBringBack() {
        bringBack?.let { main.removeCallbacks(it) }
        bringBack = null
    }

    /** Ouvre Hubera Fuel pour de vrai (garage, pleins, budget) — Maps ne reprend pas le premier plan.
     *  Si Fuel n’est pas installé : page d’install indépendante (APK). */
    @JavascriptInterface
    fun openApp() {
        main.post {
            cancelBringBack()
            val launch = context.packageManager.getLaunchIntentForPackage(FUEL_PKG)
            if (launch != null) {
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
        return context.packageManager.getLaunchIntentForPackage(FUEL_PKG) != null
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
            val b = Uri.parse("gasoiltracking://trip/control").buildUpon()
                .appendQueryParameter("action", act)
                .appendQueryParameter("silent", "1")
              listOf("tripId", "dest", "liters", "total", "station", "vehicleId").forEach { key ->
                val v = extra.optString(key)
                if (v.isNotBlank()) b.appendQueryParameter(key, v)
            }
            val fuel = Intent(Intent.ACTION_VIEW, b.build()).apply {
                setPackage(FUEL_PKG)
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_NO_ANIMATION or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP or
                        Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
                )
            }
            runCatching { context.startActivity(fuel) }
            val task = Runnable {
                bringBack = null
                val back = Intent(context, MainActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_NO_ANIMATION,
                    )
                }
                runCatching { context.startActivity(back) }
            }
            bringBack = task
            main.postDelayed(task, bringBackMs(act))
        }
    }

    companion object {
        const val FUEL_PKG = "com.gasoiltracking.app"
        const val FUEL_INSTALL = "https://fuel.hubera.cloud/install"

        /** start : GPS + FGS (~3–7 s). history : SQLite. le reste : instantané. */
        fun bringBackMs(action: String): Long = when (action) {
            "start" -> 8_000L
            "snapshot" -> 500L
            "history" -> 1_600L
            "select", "vehicle" -> 500L
            "fill" -> 900L
            "stop" -> 1_400L
            else -> 500L
        }
    }
}
