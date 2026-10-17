package ovh.delhomme.maps

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONArray
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
 * Overpass depuis le natif : le WebView file:// bloque CORS.
 * La limite vient du tag OSM de la voie (maxspeed, zone, living_street).
 * Aucun 50 inventé si la voie n’a pas de tag.
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
        runCatching {
            val la = lat.toDoubleOrNull() ?: return
            val lo = lon.toDoubleOrNull() ?: return
            lookupCoords(la, lo)
        }
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
        val kmh = if (hit.known && hit.kmh != null) hit.kmh.toString() else "null"
        val known = if (hit.known) "true" else "false"
        main.post {
            web()?.evaluateJavascript(
                "window.__huberaSpeedLimit && window.__huberaSpeedLimit($kmh, ${if (hit.zone) "true" else "false"}, $known)",
                null,
            )
        }
    }

    private fun fetch(lat: Double, lon: Double): SpeedHit? {
        val la = String.format(java.util.Locale.US, "%.5f", lat)
        val lo = String.format(java.util.Locale.US, "%.5f", lon)
        val ways =
            "[out:json][timeout:12];(" +
                "way(around:42,$la,$lo)[\"highway\"];" +
                "way(around:55,$la,$lo)[\"zone:maxspeed\"];" +
                ");out tags geom;"
        val area =
            "[out:json][timeout:8];" +
                "is_in($la,$lo)->.a;" +
                "(" +
                "relation(pivot.a)[\"zone:maxspeed\"];" +
                "way(pivot.a)[\"zone:maxspeed\"];" +
                "relation(pivot.a)[\"enforcement\"=\"maxspeed\"];" +
                ");out tags;"
        val waysBody = "data=" + java.net.URLEncoder.encode(ways, Charsets.UTF_8.name())
        val areaBody = "data=" + java.net.URLEncoder.encode(area, Charsets.UTF_8.name())
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
                        val raw = post(endpoint, waysBody) ?: return@runCatching
                        val parsed = parse(raw, lat, lon) ?: return@runCatching
                        val hit = if (parsed.known) {
                            parsed
                        } else {
                            val zone = runCatching {
                                val areaRaw = post(endpoint, areaBody)
                                if (areaRaw == null) null else lowestZone(areaRaw)
                            }.getOrNull()
                            zone ?: parsed
                        }
                        if (winner.compareAndSet(null, hit)) latch.countDown()
                    }.onFailure { t ->
                        Log.w(TAG, "overpass worker $endpoint: ${t.message}")
                    }
                }
            }
            latch.await(8, TimeUnit.SECONDS)
            return winner.get()
        } finally {
            pool.shutdownNow()
        }
    }

    private fun post(endpoint: String, body: String): String? {
        val conn = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = "POST"
            connectTimeout = 5_000
            readTimeout = 8_000
            doOutput = true
            setRequestProperty("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8")
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "HuberaMaps/0.1.107 (https://maps.hubera.cloud)")
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
        if (!looksLikeJson(raw)) return null
        return runCatching { parseJson(raw.trimStart().removePrefix("\uFEFF").trimStart(), lat, lon) }
            .onFailure { t -> Log.w(TAG, "overpass parse: ${t.message}") }
            .getOrNull()
    }

    private fun parseJson(raw: String, lat: Double, lon: Double): SpeedHit? {
        val root = JSONObject(raw)
        val elements = root.optJSONArray("elements") ?: return null
        if (elements.length() == 0) return null
        data class Cand(val dist: Double, val bearing: Double?, val tags: JSONObject)
        val cands = ArrayList<Cand>()
        val zones = ArrayList<Int>()
        for (i in 0 until elements.length()) {
            val el = elements.optJSONObject(i) ?: continue
            val tags = el.optJSONObject("tags") ?: continue
            val contained = zoneKmh(tags)?.let { z ->
                if (contains(lat, lon, el)) z else null
            }
            if (contained != null) zones.add(contained)
            val hw = tags.optString("highway")
            if (hw.isBlank() || skipPedestrian(hw)) continue
            val d = wayDistance(lat, lon, el)
            cands.add(Cand(d.first, d.second, tags))
        }
        cands.sortBy { it.dist }
        val near = cands.firstOrNull { it.dist <= 48.0 }
        if (near != null) {
            val ex = explicitSpeed(near.tags, near.bearing)
            if (ex != null) return SpeedHit(ex.first, ex.second, true)
            if (near.tags.optString("highway") == "living_street") return SpeedHit(20, true, true)
        }
        if (zones.isNotEmpty()) return SpeedHit(zones.min(), true, true)
        if (near != null) return SpeedHit(null, false, false)
        return null
    }

    private fun lowestZone(raw: String): SpeedHit? {
        if (!looksLikeJson(raw)) return null
        val root = runCatching { JSONObject(raw.trimStart().removePrefix("\uFEFF").trimStart()) }.getOrNull() ?: return null
        val elements = root.optJSONArray("elements") ?: return null
        var best: Int? = null
        for (i in 0 until elements.length()) {
            val tags = elements.optJSONObject(i)?.optJSONObject("tags") ?: continue
            val z = zoneKmh(tags) ?: continue
            if (best == null || z < best) best = z
        }
        val kmh = best ?: return null
        return SpeedHit(kmh, true, true)
    }

    companion object {
        private const val TAG = "HuberaSpeed"
        data class SpeedHit(val kmh: Int?, val zone: Boolean, val known: Boolean)
        private val ENDPOINTS = listOf(
            "https://overpass-api.de/api/interpreter",
            "https://maps.hubera.cloud/overpass",
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

        private fun looksLikeJson(raw: String): Boolean {
            val t = raw.trimStart().removePrefix("\uFEFF").trimStart()
            return t.startsWith("{") || t.startsWith("[")
        }

        private fun skipPedestrian(hw: String) = hw.isBlank() || hw in SKIP

        private fun parseMaxspeed(raw: String?): Int? {
            if (raw.isNullOrBlank()) return null
            val s = raw.trim()
            if (s == "none" || s == "signals" || s == "walk" || s == "variable") return null
            FR[s]?.let { return it }
            val zone = Regex("^FR:zone:?(\\d{1,3})$", RegexOption.IGNORE_CASE).matchEntire(s)
            if (zone != null) {
                val v = zone.groupValues[1].toInt()
                if (v in 5..140) return v
            }
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

        private fun zoneTag(tags: JSONObject): Boolean {
            if (tags.optString("zone:maxspeed").isNotBlank()) return true
            if (tags.optString("maxspeed:type").lowercase().contains("zone")) return true
            if (tags.optString("source:maxspeed").lowercase().contains("zone")) return true
            return tags.optString("highway") == "living_street"
        }

        private fun explicitSpeed(tags: JSONObject, bearing: Double?): Pair<Int, Boolean>? {
            val directed = directedKmh(tags, bearing)
            if (directed != null) return directed to zoneTag(tags)
            val zone = parseMaxspeed(tags.optString("zone:maxspeed").ifBlank { null })
            if (zone != null) return zone to true
            val type = tags.optString("maxspeed:type").trim()
            if (type.contains("zone", ignoreCase = true)) {
                parseMaxspeed(type)?.let { return it to true }
            }
            if (Regex("^FR:\\d{1,3}$", RegexOption.IGNORE_CASE).matches(type)) {
                parseMaxspeed(type)?.let { return it to false }
            }
            return null
        }

        private fun directedKmh(tags: JSONObject, bearing: Double?): Int? {
            val base = parseMaxspeed(tags.optString("maxspeed").ifBlank { null })
            val fwd = parseMaxspeed(tags.optString("maxspeed:forward").ifBlank { null })
            val back = parseMaxspeed(tags.optString("maxspeed:backward").ifBlank { null })
            if (fwd == null && back == null) return base
            if (bearing == null) {
                if (base != null) return base
                if (fwd != null && back != null) return minOf(fwd, back)
                return fwd ?: back
            }
            if (base != null && fwd == null && back == null) return base
            return base ?: fwd ?: back
        }

        private fun zoneKmh(tags: JSONObject): Int? {
            if (tags.optString("zone:maxspeed").isNotBlank()) {
                return parseMaxspeed(tags.optString("zone:maxspeed"))
            }
            val type = tags.optString("maxspeed:type")
            if (type.contains("zone", ignoreCase = true)) {
                return parseMaxspeed(type) ?: parseMaxspeed(tags.optString("maxspeed").ifBlank { null })
            }
            if (tags.optString("enforcement") == "maxspeed" || tags.optString("type") == "enforcement") {
                return parseMaxspeed(tags.optString("maxspeed").ifBlank { null })
            }
            return null
        }

        private fun contains(lat: Double, lon: Double, el: JSONObject): Boolean {
            val rings = ArrayList<JSONArray>()
            val members = el.optJSONArray("members")
            if (members != null) {
                for (i in 0 until members.length()) {
                    val m = members.optJSONObject(i) ?: continue
                    val role = m.optString("role")
                    if (role.isNotBlank() && role != "outer") continue
                    val g = m.optJSONArray("geometry") ?: continue
                    if (ringClosed(g)) rings.add(g)
                }
            }
            val geom = el.optJSONArray("geometry")
            if (geom != null && ringClosed(geom)) rings.add(geom)
            return rings.any { pointInRing(lat, lon, it) }
        }

        private fun ringClosed(geom: JSONArray): Boolean {
            if (geom.length() < 4) return false
            val a = geom.optJSONObject(0) ?: return false
            val b = geom.optJSONObject(geom.length() - 1) ?: return false
            return kotlin.math.abs(a.optDouble("lat") - b.optDouble("lat")) < 1e-5 &&
                kotlin.math.abs(a.optDouble("lon") - b.optDouble("lon")) < 1e-5
        }

        private fun pointInRing(lat: Double, lon: Double, ring: JSONArray): Boolean {
            var inside = false
            var j = ring.length() - 1
            for (i in 0 until ring.length()) {
                val pi = ring.optJSONObject(i) ?: continue
                val pj = ring.optJSONObject(j) ?: continue
                val yi = pi.optDouble("lat")
                val xi = pi.optDouble("lon")
                val yj = pj.optDouble("lat")
                val xj = pj.optDouble("lon")
                val intersect = (yi > lat) != (yj > lat) &&
                    lon < (xj - xi) * (lat - yi) / (if (yj == yi) 1e-12 else (yj - yi)) + xi
                if (intersect) inside = !inside
                j = i
            }
            return inside
        }

        private fun wayDistance(lat: Double, lon: Double, el: JSONObject): Pair<Double, Double?> {
            val geom = el.optJSONArray("geometry")
            if (geom == null || geom.length() == 0) {
                val c = el.optJSONObject("center") ?: return 9999.0 to null
                return meters(lat, lon, c.optDouble("lat"), c.optDouble("lon")) to null
            }
            if (geom.length() == 1) {
                val p = geom.optJSONObject(0) ?: return 9999.0 to null
                return meters(lat, lon, p.optDouble("lat"), p.optDouble("lon")) to null
            }
            var best = 1e12
            var bearing: Double? = null
            for (i in 1 until geom.length()) {
                val a = geom.optJSONObject(i - 1) ?: continue
                val b = geom.optJSONObject(i) ?: continue
                val hit = distPointSeg(lat, lon, a.optDouble("lat"), a.optDouble("lon"), b.optDouble("lat"), b.optDouble("lon"))
                if (hit.first < best) {
                    best = hit.first
                    bearing = hit.second
                }
            }
            return best to bearing
        }

        private fun distPointSeg(lat: Double, lon: Double, lat1: Double, lon1: Double, lat2: Double, lon2: Double): Pair<Double, Double> {
            val cosLat = cos(Math.toRadians(lat))
            val px = lon * 111320.0 * cosLat
            val py = lat * 110540.0
            val ax = lon1 * 111320.0 * cosLat
            val ay = lat1 * 110540.0
            val bx = lon2 * 111320.0 * cosLat
            val by = lat2 * 110540.0
            val dx = bx - ax
            val dy = by - ay
            val l2 = dx * dx + dy * dy
            var t = 0.0
            if (l2 > 1) t = (((px - ax) * dx + (py - ay) * dy) / l2).coerceIn(0.0, 1.0)
            val dist = kotlin.math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            return dist to bearing(lat1, lon1, lat2, lon2)
        }

        private fun bearing(lat1: Double, lon1: Double, lat2: Double, lon2: Double): Double {
            val p1 = Math.toRadians(lat1)
            val p2 = Math.toRadians(lat2)
            val dl = Math.toRadians(lon2 - lon1)
            val y = sin(dl) * cos(p2)
            val x = cos(p1) * sin(p2) - sin(p1) * cos(p2) * cos(dl)
            return (Math.toDegrees(atan2(y, x)) + 360.0) % 360.0
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
