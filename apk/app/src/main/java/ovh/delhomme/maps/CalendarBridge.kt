package ovh.delhomme.maps

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.CalendarContract
import android.webkit.JavascriptInterface
import android.widget.Toast
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Enregistrer un trajet Maps dans Hubera Calendar.
 * 1) POST /calendar/events si un Bearer Hubera ID est là.
 * 2) Sinon stub durable : intent content:// + URL calendar.hubera.cloud.
 */
class CalendarBridge(
    private val context: Context,
    private val suite: () -> SuiteBridge?,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @JavascriptInterface
    fun saveTrip(title: String, location: String, startMs: String, endMs: String) {
        saveTripWithId(title, location, startMs, endMs, "")
    }

    @JavascriptInterface
    fun saveTripWithId(title: String, location: String, startMs: String, endMs: String, tripId: String) {
        val t = title.trim().ifBlank { "Trajet Hubera Maps" }
        val loc = location.trim()
        val start = startMs.toLongOrNull() ?: return
        val end = endMs.toLongOrNull()?.takeIf { it > start } ?: (start + 30L * 60_000L)
        val id = tripId.trim().ifBlank { "planned-$start" }
        persist(
            JSONObject()
                .put("title", t)
                .put("location", loc)
                .put("start", start)
                .put("end", end)
                .put("trip_id", id)
                .put("at", System.currentTimeMillis()),
        )
        io.execute {
            val posted = runCatching { postEvent(t, loc, start, end, id) }.getOrDefault(false)
            main.post {
                if (posted) {
                    Toast.makeText(context, "Ajouté à Hubera Calendar", Toast.LENGTH_SHORT).show()
                } else {
                    openStub(t, loc, start, end, id)
                }
            }
        }
    }

    @JavascriptInterface
    fun lastStub(): String = prefs.getString(KEY_LAST, "") ?: ""

    private fun persist(row: JSONObject) {
        val list = runCatching { JSONArray(prefs.getString(KEY_QUEUE, "[]")) }
            .getOrDefault(JSONArray())
        list.put(row)
        val trimmed = JSONArray()
        val from = (list.length() - 24).coerceAtLeast(0)
        for (i in from until list.length()) trimmed.put(list.get(i))
        prefs.edit()
            .putString(KEY_LAST, row.toString())
            .putString(KEY_QUEUE, trimmed.toString())
            .apply()
    }

    private fun postEvent(title: String, location: String, start: Long, end: Long, tripId: String): Boolean {
        val token = suite()?.token()?.trim().orEmpty()
        if (token.isBlank()) return false
        val body = JSONObject()
            .put("trip_id", tripId)
            .put("title", title)
            .put("start_at", java.time.Instant.ofEpochMilli(start).toString())
            .put("end_at", java.time.Instant.ofEpochMilli(end).toString())
            .put("location", location.ifBlank { JSONObject.NULL })
            .put("description", "Trajet Hubera Maps")
            .toString()
        for (url in EVENT_URLS) {
            val conn = (URL(url).openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = 10_000
                readTimeout = 12_000
                doOutput = true
                instanceFollowRedirects = true
                setRequestProperty("Accept", "application/json")
                setRequestProperty("Content-Type", "application/json; charset=UTF-8")
                setRequestProperty("Authorization", "Bearer $token")
                setRequestProperty("User-Agent", "HuberaMaps/0.1.81")
            }
            val ok = try {
                conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                conn.responseCode in 200..299
            } catch (t: Throwable) {
                android.util.Log.w(TAG, "POST $url ${t.message}")
                false
            } finally {
                conn.disconnect()
            }
            if (ok) return true
        }
        return false
    }

    private fun openStub(title: String, location: String, start: Long, end: Long, tripId: String) {
        val fromMaps = Intent("cloud.hubera.calendar.FROM_MAPS").apply {
            putExtra("trip_id", tripId)
            putExtra("title", title)
            putExtra("location", location)
            putExtra("start_at", java.time.Instant.ofEpochMilli(start).toString())
            putExtra("end_at", java.time.Instant.ofEpochMilli(end).toString())
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        for (pkg in CAL_PKGS) {
            fromMaps.setPackage(pkg)
            if (runCatching { context.startActivity(fromMaps) }.isSuccess) {
                Toast.makeText(context, "Agenda ouvert", Toast.LENGTH_SHORT).show()
                return
            }
        }
        val insert = Intent(Intent.ACTION_INSERT).apply {
            data = CalendarContract.Events.CONTENT_URI
            putExtra(CalendarContract.Events.TITLE, title)
            putExtra(CalendarContract.Events.EVENT_LOCATION, location)
            putExtra(CalendarContract.Events.DESCRIPTION, "Trajet Hubera Maps")
            putExtra("trip_id", tripId)
            putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, start)
            putExtra(CalendarContract.EXTRA_EVENT_END_TIME, end)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        for (pkg in CAL_PKGS) {
            insert.setPackage(pkg)
            if (runCatching { context.startActivity(insert) }.isSuccess) {
                Toast.makeText(context, "Agenda ouvert", Toast.LENGTH_SHORT).show()
                return
            }
        }
        insert.setPackage(null)
        if (runCatching { context.startActivity(insert) }.isSuccess) {
            Toast.makeText(context, "Agenda ouvert", Toast.LENGTH_SHORT).show()
            return
        }
        val q = Uri.Builder()
            .scheme("https")
            .authority("calendar.hubera.cloud")
            .path("/app/")
            .appendQueryParameter("from", "maps")
            .appendQueryParameter("trip_id", tripId)
            .appendQueryParameter("title", title)
            .appendQueryParameter("location", location)
            .appendQueryParameter("start", java.time.Instant.ofEpochMilli(start).toString())
            .appendQueryParameter("end", java.time.Instant.ofEpochMilli(end).toString())
            .build()
        val view = Intent(Intent.ACTION_VIEW, q).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { context.startActivity(view) }
            .onFailure { android.util.Log.w(TAG, "calendar stub: ${it.message}") }
        Toast.makeText(context, "Ouverture de calendar.hubera.cloud", Toast.LENGTH_SHORT).show()
    }

    companion object {
        private const val TAG = "HuberaCalendar"
        private const val PREFS = "hubera_maps_calendar"
        private const val KEY_LAST = "last_stub"
        private const val KEY_QUEUE = "queue"
        val CAL_PKGS = listOf("cloud.hubera.calendar", "fr.cloudity.cloudity_calendar")
        val EVENT_URLS = listOf(
            "https://calendar.hubera.cloud/calendar/events/from-maps",
            "https://calendar.hubera.cloud/api/calendar/events/from-maps",
        )
    }
}
