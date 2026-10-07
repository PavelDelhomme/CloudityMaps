package ovh.delhomme.maps

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
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
    @Volatile
    private var lastOk = false

    @JavascriptInterface
    fun lookup(lat: String, lon: String) {
        val la = lat.toDoubleOrNull() ?: return
        val lo = lon.toDoubleOrNull() ?: return
        lookupCoords(la, lo)
    }

    private fun lookupCoords(lat: Double, lon: Double) {
        val now = System.currentTimeMillis()
        val wait = if (lastOk) 4000L else 800L
        if (now - lastAt < wait) return
        lastAt = now
        io.execute {
            val hit = runCatching { fetch(lat, lon) }.getOrNull()
            lastOk = hit != null
            Log.i(TAG, "speed lookup $lat,$lon -> $hit")
            if (hit != null) push(hit)
        }
    }

    private fun push(hit: SpeedHit) {
        main.post {
            web()?.evaluateJavascript(
                "window.__huberaSpeedLimit && window.__huberaSpeedLimit(${hit.kmh}, ${if (hit.zone) "true" else "false"})",
                null,
            )
        }
    }

    private fun fetch(lat: Double, lon: Double): SpeedHit? {
        val la = String.format(java.util.Locale.US, "%.5f", lat)
        val lo = String.format(java.util.Locale.US, "%.5f", lon)
        val query =
            "[out:json][timeout:8];(" +
                "way(around:28,$la,$lo)[highway];" +
                "way(around:90,$la,$lo)[\"zone:maxspeed\"];" +
                "way(around:90,$la,$lo)[\"maxspeed:type\"~\"zone\"];" +
                ");out center tags 50;"
        val body = "data=" + java.net.URLEncoder.encode(query, Charsets.UTF_8.name())
        val winner = AtomicReference<SpeedHit?>(null)
        val latch = CountDownLatch(1)
        val pool = Executors.newFixedThreadPool(ENDPOINTS.size.coerceAtMost(4)) { r ->
            Thread(r, "HuberaOverpass").apply {
                isDaemon = true
                uncaughtExceptionHandler = Thread.UncaughtExceptionHandler { _, t ->
                    Log.w(TAG, "overpass thread: ${t.message}")
                }
            }
        }
        try {
            for (endpoint in ENDPOINTS) {
                pool.execute {
                    runCatching {
                        if (winner.get() != null) return@runCatching
                        val raw = post(endpoint, body) ?: return@runCatching
                        val parsed = parse(raw, lat, lon) ?: return@runCatching
                        if (winner.compareAndSet(null, parsed)) latch.countDown()
                    }.onFailure { t ->
                        Log.w(TAG, "overpass worker $endpoint: ${t.message}")
                    }
                }
            }
            latch.await(7, TimeUnit.SECONDS)
            return winner.get()
        } finally {
            pool.shutdownNow()
        }
    }

    private fun post(endpoint: String, body: String): String? {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 5_000
            readTimeout = 6_000
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "HuberaMaps/0.1.76 (https://maps.hubera.cloud)")
        }
        return try {
            conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            if (conn.responseCode !in 200..299) return null
            val text = conn.inputStream.bufferedReader().use { it.readText() }
            if (!looksLikeJson(text)) {
                Log.w(TAG, "overpass html/xml $endpoint")
                return null
            }
            text
        } catch (t: Throwable) {
            Log.w(TAG, "overpass fail $endpoint: ${t.message}")
            null
        } finally {
            conn.disconnect()
        }
    }

    private fun parse(raw: String, lat: Double, lon: Double): SpeedHit? {
        if (!looksLikeJson(raw)) {
            Log.w(TAG, "overpass skip non-json ${raw.trimStart().take(32)}")
            return null
        }
        return runCatching { parseJson(raw.trimStart().removePrefix("\uFEFF").trimStart(), lat, lon) }
            .onFailure { t -> Log.w(TAG, "overpass parse: ${t.message}") }
            .getOrNull()
    }

    private fun parseJson(raw: String, lat: Double, lon: Double): SpeedHit? {
        val root = JSONObject(raw)
        val elements = root.optJSONArray("elements") ?: return null
        data class Cand(val dist: Double, val tagged: Int?, val implied: Int?, val urban: Boolean, val zone: Boolean)
        val cands = ArrayList<Cand>()
        for (i in 0 until elements.length()) {
            val el = elements.optJSONObject(i) ?: continue
            val tags = el.optJSONObject("tags") ?: continue
            val hw = tags.optString("highway")
            if (hw.isNotBlank() && skipPedestrian(hw)) continue
            val center = el.optJSONObject("center")
            val dist = if (center != null) {
                meters(lat, lon, center.optDouble("lat"), center.optDouble("lon"))
            } else {
                999.0
            }
            val tagged = taggedSpeed(tags)
            val implied = impliedHighway(hw)
            if (tagged == null && implied == null) continue
            val urban = hw == "residential" || hw == "living_street" || hw == "unclassified"
            val zone = zoneTag(tags)
            cands.add(Cand(dist, tagged, implied, urban, zone))
        }
        if (cands.isEmpty()) return null
        cands.sortBy { it.dist }
        val zoneHit = cands.firstOrNull { it.zone && it.tagged != null && it.dist <= 90.0 }
        if (zoneHit != null) return SpeedHit(zoneHit.tagged!!, true)
        val tagged = cands.firstOrNull { it.tagged != null && it.dist <= 55.0 }
        if (tagged != null) return SpeedHit(tagged.tagged!!, tagged.zone)
        val closest = cands[0]
        val speed = closest.tagged ?: closest.implied ?: return null
        return SpeedHit(speed, closest.zone)
    }

    companion object {
        private const val TAG = "HuberaSpeed"
        data class SpeedHit(val kmh: Int, val zone: Boolean)
        private val ENDPOINTS = listOf(
            "https://overpass.osm.ch/api/interpreter",
            "https://maps.hubera.cloud/overpass",
            "https://overpass.kumi.systems/api/interpreter",
            "https://overpass-api.de/api/interpreter",
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

        private fun looksLikeJson(raw: String): Boolean {
            val t = raw.trimStart().removePrefix("\uFEFF").trimStart()
            return t.startsWith("{") || t.startsWith("[")
        }

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

        private fun zoneTag(tags: JSONObject): Boolean {
            if (tags.optString("zone:maxspeed").isNotBlank()) return true
            val type = tags.optString("maxspeed:type").lowercase()
            if (type.contains("zone")) return true
            return tags.optString("source:maxspeed").lowercase().contains("zone")
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
