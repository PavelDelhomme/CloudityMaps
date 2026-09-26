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
    fun osrm(fromLon: String, fromLat: String, toLon: String, toLat: String, mode: String, reqId: String) {
        io.execute {
            android.util.Log.i("HuberaRoute", "osrm $reqId start $mode")
            val body = runCatching {
                val flo = fromLon.replace(',', '.').toDouble()
                val fla = fromLat.replace(',', '.').toDouble()
                val tlo = toLon.replace(',', '.').toDouble()
                val tla = toLat.replace(',', '.').toDouble()
                fetchFirst(flo, fla, tlo, tla, mode)
            }.onFailure {
                android.util.Log.w("HuberaRoute", "osrm $reqId fail ${it.javaClass.simpleName} ${it.message}")
            }.getOrNull()
            android.util.Log.i("HuberaRoute", "osrm $reqId bytes=${body?.length ?: -1}")
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

    private fun bases(mode: String): List<String> {
        val foot = "https://routing.openstreetmap.de/routed-foot/route/v1/driving/"
        val bike = "https://routing.openstreetmap.de/routed-bike/route/v1/driving/"
        val carOsm = "https://routing.openstreetmap.de/routed-car/route/v1/driving/"
        val carDemo = "https://router.project-osrm.org/route/v1/driving/"
        return when (mode) {
            "walk" -> listOf(foot, carDemo)
            "bike" -> listOf(bike, carDemo)
            else -> listOf(carOsm, carDemo)
        }
    }

    private fun fetchFirst(
        fromLon: Double,
        fromLat: Double,
        toLon: Double,
        toLat: Double,
        mode: String,
    ): String? {
        val la = String.format(java.util.Locale.US, "%.6f", fromLat)
        val lo = String.format(java.util.Locale.US, "%.6f", fromLon)
        val tb = String.format(java.util.Locale.US, "%.6f", toLat)
        val tn = String.format(java.util.Locale.US, "%.6f", toLon)
        val tail = "${lo},${la};${tn},${tb}?overview=full&geometries=geojson&alternatives=true&steps=true"
        for (base in bases(mode)) {
            val got = get(base + tail)
            if (got != null) return got
        }
        return null
    }

    private fun get(url: String): String? {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 12_000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty(
                "User-Agent",
                "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36",
            )
        }
        return try {
            val code = conn.responseCode
            android.util.Log.i("HuberaRoute", "GET $code ${url.take(80)}")
            if (code !in 200..299) {
                val err = conn.errorStream?.bufferedReader()?.use { it.readText() }?.take(180)
                android.util.Log.w("HuberaRoute", "body $err")
                return null
            }
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (t: Throwable) {
            android.util.Log.w("HuberaRoute", "ex ${t.javaClass.simpleName} ${t.message}")
            null
        } finally {
            conn.disconnect()
        }
    }
}
