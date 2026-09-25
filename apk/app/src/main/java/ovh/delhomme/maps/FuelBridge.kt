package ovh.delhomme.maps

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Commande Hubera Fuel depuis Maps sans rester sur l’UI Fuel :
 * deep link silencieux + Maps revient au premier plan.
 */
class FuelBridge(private val context: Context) {
    private val main = Handler(Looper.getMainLooper())

    @JavascriptInterface
    fun control(action: String, payloadJson: String) {
        main.post {
            val extra = runCatching { JSONObject(payloadJson) }.getOrElse { JSONObject() }
            val b = Uri.parse("gasoiltracking://trip/control").buildUpon()
                .appendQueryParameter("action", action)
                .appendQueryParameter("silent", "1")
            listOf("tripId", "dest", "liters", "total", "station").forEach { key ->
                val v = extra.optString(key)
                if (v.isNotBlank()) b.appendQueryParameter(key, v)
            }
            val fuel = Intent(Intent.ACTION_VIEW, b.build()).apply {
                setPackage(FUEL_PKG)
                addFlags(
                    Intent.FLAG_ACTIVITY_NEW_TASK or
                        Intent.FLAG_ACTIVITY_NO_ANIMATION or
                        Intent.FLAG_ACTIVITY_CLEAR_TOP,
                )
            }
            runCatching { context.startActivity(fuel) }
            main.postDelayed({
                val back = Intent(context, MainActivity::class.java).apply {
                    addFlags(
                        Intent.FLAG_ACTIVITY_REORDER_TO_FRONT or
                            Intent.FLAG_ACTIVITY_SINGLE_TOP or
                            Intent.FLAG_ACTIVITY_NO_ANIMATION,
                    )
                }
                runCatching { context.startActivity(back) }
            }, 320)
        }
    }

    companion object {
        const val FUEL_PKG = "com.gasoiltracking.app"
    }
}
