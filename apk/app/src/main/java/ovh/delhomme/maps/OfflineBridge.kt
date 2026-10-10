package ovh.delhomme.maps

import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebResourceResponse
import android.webkit.WebView
import org.json.JSONArray
import org.json.JSONObject
import java.io.ByteArrayInputStream
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.cos
import kotlin.math.ln
import kotlin.math.tan

/**
 * Cache tuiles OSM pour la carte hors ligne.
 * Intercepte a.tile.openstreetmap.org/{z}/{x}/{y}.png
 */
class OfflineBridge(
    private val context: Context,
    private val web: () -> WebView?,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newFixedThreadPool(3)
    private val busy = AtomicBoolean(false)
    private val cancel = AtomicBoolean(false)

    @Volatile
    private var progressDone = 0

    @Volatile
    private var progressTotal = 0

    @Volatile
    private var progressName = ""

    @JavascriptInterface
    fun status(): String = packsFile(context).let { f ->
        val root = if (f.isFile) runCatching { JSONObject(f.readText()) }.getOrElse { emptyRoot() } else emptyRoot()
        root.put("downloading", busy.get())
        root.put("done", progressDone)
        root.put("total", progressTotal)
        root.put("name", progressName)
        root.put("bytes", tileBytes(context))
        root.put("tiles", countTiles(context))
        root.toString()
    }

    @JavascriptInterface
    fun download(lat: String, lon: String, name: String) {
        val la = lat.replace(',', '.').toDoubleOrNull() ?: return
        val lo = lon.replace(',', '.').toDoubleOrNull() ?: return
        val label = name.trim().ifBlank { "Zone" }
        if (!busy.compareAndSet(false, true)) return
        cancel.set(false)
        io.execute {
            try {
                runDownload(la, lo, label)
            } finally {
                busy.set(false)
                progressDone = 0
                progressTotal = 0
                ping("done")
            }
        }
    }

    @JavascriptInterface
    fun cancel() {
        cancel.set(true)
    }

    @JavascriptInterface
    fun clear() {
        cancel.set(true)
        runCatching { tilesDir(context).deleteRecursively() }
        packsFile(context).delete()
        ping("cleared")
    }

    private fun runDownload(lat: Double, lon: Double, name: String) {
        progressName = name
        val jobs = mutableListOf<Triple<Int, Int, Int>>()
        for (z in MIN_Z..MAX_Z) {
            val (x0, y0) = latLonToTile(lat, lon, z)
            val span = tileSpan(z)
            val n = 1 shl z
            for (x in (x0 - span)..(x0 + span)) {
                for (y in (y0 - span)..(y0 + span)) {
                    val xx = x.coerceIn(0, n - 1)
                    val yy = y.coerceIn(0, n - 1)
                    jobs.add(Triple(z, xx, yy))
                }
            }
        }
        val unique = jobs.distinct()
        progressTotal = unique.size
        progressDone = 0
        ping("progress")
        var stored = 0
        for (t in unique) {
            if (cancel.get()) break
            val file = tileFile(context, t.first, t.second, t.third)
            if (!file.isFile) {
                val bytes = fetchTile(t.first, t.second, t.third)
                if (bytes != null && bytes.size > 80) {
                    file.parentFile?.mkdirs()
                    val tmp = File(file.parentFile, file.name + ".tmp")
                    tmp.writeBytes(bytes)
                    tmp.renameTo(file)
                    stored++
                }
            } else {
                stored++
            }
            progressDone++
            if (progressDone % 12 == 0) ping("progress")
        }
        if (!cancel.get() && stored > 0) {
            appendPack(lat, lon, name, stored)
        }
        ping("progress")
    }

    private fun appendPack(lat: Double, lon: Double, name: String, tiles: Int) {
        val f = packsFile(context)
        val root = if (f.isFile) runCatching { JSONObject(f.readText()) }.getOrElse { emptyRoot() } else emptyRoot()
        val arr = root.optJSONArray("packs") ?: JSONArray()
        val pack = JSONObject()
            .put("id", System.currentTimeMillis().toString(36))
            .put("name", name)
            .put("lat", lat)
            .put("lon", lon)
            .put("tiles", tiles)
            .put("at", System.currentTimeMillis())
        arr.put(pack)
        root.put("packs", arr)
        f.parentFile?.mkdirs()
        f.writeText(root.toString())
    }

    private fun ping(kind: String) {
        val js = "window.__mapsOfflineEvent&&window.__mapsOfflineEvent('${kind}')"
        main.post { web()?.evaluateJavascript(js, null) }
    }

    companion object {
        private const val MIN_Z = 12
        private const val MAX_Z = 16
        private const val UA =
            "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36 HuberaMaps/0.1.39"

        fun serveTile(context: Context, uri: Uri): WebResourceResponse? {
            return runCatching {
                val t = matchTile(uri) ?: return@runCatching null
                val file = tileFile(context, t.first, t.second, t.third)
                if (file.isFile && isBlockedTile(file)) {
                    file.delete()
                }
                if (file.isFile && file.length() > 80) {
                    return@runCatching pngResponse(file.readBytes())
                }
                // Pas en cache : laisser la WebView charger (osm.de / fr / ArcGIS).
                // Un fetch Java ici bloquait le fil tuiles et vidait la carte en guidage.
                null
            }.getOrNull()
        }

        private fun isBlockedTile(file: File): Boolean {
            val n = file.length()
            return n == 6933L || n in 6800L..7100L
        }

        private fun isBlockedBytes(bytes: ByteArray): Boolean {
            val n = bytes.size.toLong()
            return n == 6933L || n in 6800L..7100L
        }

        private fun matchTile(uri: Uri): Triple<Int, Int, Int>? {
            val host = (uri.host ?: "").lowercase()
            val osm =
                host.contains("tile.openstreetmap") ||
                    host == "tile.openstreetmap.org" ||
                    host == "tile.openstreetmap.de" ||
                    host.endsWith("openstreetmap.fr")
            if (!osm) return null
            val segs = uri.pathSegments
            if (segs.size < 3) return null
            val z = segs[segs.size - 3].toIntOrNull() ?: return null
            val x = segs[segs.size - 2].toIntOrNull() ?: return null
            val yRaw = segs.last().substringBefore('.')
            val y = yRaw.toIntOrNull() ?: return null
            if (z !in 0..19) return null
            return Triple(z, x, y)
        }

        private fun fetchTile(z: Int, x: Int, y: Int): ByteArray? {
            val url = "https://tile.openstreetmap.de/$z/$x/$y.png"
            return runCatching {
                val conn = URL(url).openConnection() as HttpURLConnection
                conn.connectTimeout = 8000
                conn.readTimeout = 8000
                conn.instanceFollowRedirects = true
                conn.setRequestProperty("User-Agent", UA)
                conn.setRequestProperty("Accept", "image/png,image/*")
                conn.setRequestProperty("Referer", "https://maps.hubera.cloud/")
                val code = conn.responseCode
                val bytes = if (code in 200..299) conn.inputStream.use { it.readBytes() } else null
                conn.disconnect()
                bytes
            }.getOrNull()
        }

        private fun pngResponse(bytes: ByteArray): WebResourceResponse {
            val headers = mapOf("Cache-Control" to "max-age=31536000")
            return WebResourceResponse(
                "image/png",
                null,
                200,
                "OK",
                headers,
                ByteArrayInputStream(bytes),
            )
        }

        private fun tilesDir(context: Context): File = File(context.filesDir, "offline-tiles")

        private fun tileFile(context: Context, z: Int, x: Int, y: Int): File =
            File(tilesDir(context), "$z/$x/$y.png")

        private fun packsFile(context: Context): File = File(context.filesDir, "offline-packs.json")

        private fun emptyRoot(): JSONObject = JSONObject().put("packs", JSONArray())

        private fun countTiles(context: Context): Int {
            val dir = tilesDir(context)
            if (!dir.isDirectory) return 0
            return dir.walkTopDown().count { it.isFile && it.extension == "png" }
        }

        private fun tileBytes(context: Context): Long {
            val dir = tilesDir(context)
            if (!dir.isDirectory) return 0L
            return dir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
        }

        private fun latLonToTile(lat: Double, lon: Double, z: Int): Pair<Int, Int> {
            val n = 1 shl z
            val x = ((lon + 180.0) / 360.0 * n).toInt().coerceIn(0, n - 1)
            val latRad = Math.toRadians(lat.coerceIn(-85.0, 85.0))
            val y = ((1.0 - ln(tan(latRad) + 1.0 / cos(latRad)) / Math.PI) / 2.0 * n)
                .toInt()
                .coerceIn(0, n - 1)
            return x to y
        }

        private fun tileSpan(z: Int): Int {
            return when (z) {
                16 -> 5
                15 -> 4
                14 -> 3
                13 -> 2
                else -> 1
            }
        }
    }
}
