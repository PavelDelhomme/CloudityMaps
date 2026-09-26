package ovh.delhomme.maps

import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * Overpass depuis le natif : le WebView file:// bloque CORS, donc le JS
 * ne voit jamais maxspeed. Même parser que Fuel / web/app.js.
 */
class SpeedLimitBridge(
    private val web: () -> WebView?,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    @Volatile
    private var lastAt = 0L

    @JavascriptInterface
    fun lookup(lat: Double, lon: Double) {
        val now = System.currentTimeMillis()
        if (now - lastAt < 3500) return
        lastAt = now
        io.execute {
            val kmh = runCatching { fetch(lat, lon) }.getOrNull()
            if (kmh != null) push(kmh)
        }
    }

    private fun push(kmh: Int) {
        main.post {
            web()?.evaluateJavascript(
                "window.__huberaSpeedLimit && window.__huberaSpeedLimit($kmh)",
                null,
            )
        }
    }

    private fun fetch(lat: Double, lon: Double): Int? {
        val la = String.format(java.util.Locale.US, "%.5f", lat)
        val lo = String.format(java.util.Locale.US, "%.5f", lon)
        val query =
            "[out:json][timeout:10];way(around:80,$la,$lo)[highway];out center tags 24;"
        val body = "data=" + java.net.URLEncoder.encode(query, Charsets.UTF_8.name())
        for (endpoint in ENDPOINTS) {
            val raw = post(endpoint, body) ?: continue
            val parsed = parse(raw, lat, lon)
            if (parsed != null) return parsed
        }
        return null
    }

    private fun post(endpoint: String, body: String): String? {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 12_000
            readTimeout = 12_000
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "HuberaMaps/0.1.20 (https://maps.hubera.cloud)")
        }
        return try {
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode !in 200..299) return null
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (_: Throwable) {
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun parse(raw: String, lat: Double, lon: Double): Int? {
        val root = JSONObject(raw)
        val elements = root.optJSONArray("elements") ?: return null
        var bestDist = Double.POSITIVE_INFINITY
        var bestSpeed: Int? = null
        var bestTagged = false
        for (i in 0 until elements.length()) {
            val el = elements.optJSONObject(i) ?: continue
            val tags = el.optJSONObject("tags") ?: continue
            val hw = tags.optString("highway")
            if (skipPedestrian(hw)) continue
            val center = el.optJSONObject("center")
            val dist = if (center != null) {
                meters(lat, lon, center.optDouble("lat"), center.optDouble("lon"))
            } else {
                999.0
            }
            val tagged = taggedSpeed(tags)
            val speed = tagged ?: impliedHighway(hw) ?: continue
            val better =
                dist < bestDist - 10 ||
                    (kotlin.math.abs(dist - bestDist) < 10 && tagged != null && !bestTagged)
            if (better || bestSpeed == null) {
                bestDist = dist
                bestSpeed = speed
                bestTagged = tagged != null
            }
        }
        return bestSpeed
    }

    companion object {
        private val ENDPOINTS = listOf(
            "https://overpass-api.de/api/interpreter",
            "https://overpass.kumi.systems/api/interpreter",
        )
        private val FR = mapOf(
            "FR:urban" to 50,
            "FR:rural" to 80,
            "FR:zone30" to 30,
            "FR:zone20" to 20,
            "FR:motorway" to 130,
            "FR:trunk" to 110,
            "FR:living_street" to 20,
        )
        private val SKIP =
            setOf(
                "footway", "cycleway", "path", "steps", "pedestrian", "bridleway",
                "construction", "proposed", "elevator", "corridor", "platform", "track",
            )

        private fun skipPedestrian(hw: String) = hw.isBlank() || hw in SKIP

        private fun parseMaxspeed(raw: String?): Int? {
            if (raw.isNullOrBlank()) return null
            val s = raw.trim()
            if (s == "none" || s == "signals") return null
            FR[s]?.let { return it }
            val frNum = Regex("^FR:(\\d{1,3})$", RegexOption.IGNORE_CASE).matchEntire(s)
            if (frNum != null) {
                val v = frNum.groupValues[1].toInt()
                if (v in 5..140) return v
            }
            val fr = Regex("^FR:(\\w+)", RegexOption.IGNORE_CASE).find(s)
            if (fr != null) FR["FR:${fr.groupValues[1].lowercase()}"]?.let { return it }
            val km = Regex("^(\\d+(?:\\.\\d+)?)\\s*(km/h|kmh)?$", RegexOption.IGNORE_CASE).matchEntire(s)
            if (km != null) {
                val v = km.groupValues[1].toDouble()
                if (v in 5.0..140.0) return v.toInt()
            }
            val mph = Regex("^(\\d+)\\s*mph$", RegexOption.IGNORE_CASE).matchEntire(s)
            if (mph != null) return (mph.groupValues[1].toInt() * 1.609).toInt()
            return null
        }

        private fun taggedSpeed(tags: JSONObject): Int? {
            for (k in listOf(
                "maxspeed", "maxspeed:forward", "maxspeed:backward",
                "source:maxspeed", "maxspeed:type", "zone:maxspeed",
            )) {
                parseMaxspeed(tags.optString(k).ifBlank { null })?.let { return it }
            }
            return null
        }

        private fun impliedHighway(hw: String): Int? = when (hw) {
            "living_street" -> 20
            "motorway", "motorway_link" -> 130
            "trunk", "trunk_link" -> 110
            "residential", "unclassified",
            "tertiary", "tertiary_link",
            "secondary", "secondary_link",
            "primary", "primary_link",
            -> 50
            else -> null
        }

        private fun meters(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val r = 6371000.0
            val p1 = Math.toRadians(lat1)
            val p2 = Math.toRadians(lat2)
            val dp = Math.toRadians(lat2 - lat1)
            val dl = Math.toRadians(lon2 - lon1)
            val a = sin(dp / 2) * sin(dp / 2) + cos(p1) * cos(p2) * sin(dl / 2) * sin(dl / 2)
            return 2 * r * atan2(sqrt(a), sqrt(1 - a))
        }
    }
}
