package ovh.delhomme.maps

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * OSRM en natif : le fetch WebView file:// rate souvent, donc pas d’itinéraire.
 * Le JSON (geojson) est trop gros pour evaluateJavascript : on le rend via take().
 */
class RouteBridge(
    private val web: () -> WebView?,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val pending = ConcurrentHashMap<String, String>()

    @JavascriptInterface
    fun osrm(fromLon: Double, fromLat: Double, toLon: Double, toLat: Double, mode: String, reqId: String) {
        io.execute {
            val body = runCatching {
                get(urlFor(fromLon, fromLat, toLon, toLat, mode))
            }.getOrNull()
            if (body != null) pending[reqId] = body
            val ok = if (body != null) "true" else "false"
            main.post {
                web()?.evaluateJavascript(
                    "window.__huberaOsrmReady && window.__huberaOsrmReady('${reqId}', $ok)",
                    null,
                )
            }
        }
    }

    @JavascriptInterface
    fun take(reqId: String): String = pending.remove(reqId) ?: ""

    private fun urlFor(
        fromLon: Double,
        fromLat: Double,
        toLon: Double,
        toLat: Double,
        mode: String,
    ): String {
        val base = when (mode) {
            "walk" -> "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
            "bike" -> "https://routing.openstreetmap.de/routed-bike/route/v1/driving/"
            else -> "https://router.project-osrm.org/route/v1/driving/"
        }
        val la = String.format(java.util.Locale.US, "%.6f", fromLat)
        val lo = String.format(java.util.Locale.US, "%.6f", fromLon)
        val tb = String.format(java.util.Locale.US, "%.6f", toLat)
        val tn = String.format(java.util.Locale.US, "%.6f", toLon)
        return "${base}${lo},${la};${tn},${tb}?overview=full&geometries=geojson&alternatives=true&steps=true"
    }

    private fun get(url: String): String? {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "HuberaMaps/0.1.22 (https://maps.hubera.cloud)")
        }
        return try {
            if (conn.responseCode !in 200..299) return null
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (_: Throwable) {
            null
        } finally {
            conn.disconnect()
        }
    }
}
