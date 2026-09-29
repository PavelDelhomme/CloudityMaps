package ovh.delhomme.maps

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.webkit.JavascriptInterface
import android.webkit.WebView
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Hubera ID + Contacts depuis Maps (file:// n’a pas le JWT suite).
 * GET https://contacts.hubera.cloud/contacts avec le Bearer stocké.
 */
class SuiteBridge(
    private val context: Context,
    private val web: () -> WebView?,
) {
    private val main = Handler(Looper.getMainLooper())
    private val io = Executors.newSingleThreadExecutor()
    private val prefs = context.getSharedPreferences("hubera_suite", Context.MODE_PRIVATE)
    @Volatile
    private var pendingContacts = "[]"

    init {
        pendingContacts = prefs.getString("contacts_cache", "[]") ?: "[]"
    }

    fun ingest(data: Uri?) {
        if (data == null) return
        val token =
            data.getQueryParameter("token")
                ?: data.getQueryParameter("access")
                ?: data.getQueryParameter("access_token")
        val email = data.getQueryParameter("email")
        if (!token.isNullOrBlank()) setToken(token)
        if (!email.isNullOrBlank()) {
            prefs.edit().putString("email", email.trim()).apply()
        }
        if (!token.isNullOrBlank() || data.host == "auth") refreshContacts()
    }

    @JavascriptInterface
    fun setToken(token: String) {
        val t = token.trim()
        if (t.isBlank()) return
        prefs.edit().putString("token", t).apply()
    }

    @JavascriptInterface
    fun token(): String = prefs.getString("token", "") ?: ""

    @JavascriptInterface
    fun email(): String = prefs.getString("email", "paul@delhomme.ovh") ?: "paul@delhomme.ovh"

    @JavascriptInterface
    fun refreshContacts() {
        io.execute {
            val body = fetchContacts()
            if (!body.isNullOrBlank() && body.startsWith("[")) {
                pendingContacts = body
                prefs.edit().putString("contacts_cache", body).apply()
            } else if (pendingContacts == "[]") {
                pendingContacts = prefs.getString("contacts_cache", "[]") ?: "[]"
            }
            main.post {
                web()?.evaluateJavascript(
                    "window.__mapsContactsReady&&window.__mapsContactsReady()",
                    null,
                )
            }
        }
    }

    @JavascriptInterface
    fun takeContacts(): String = pendingContacts

    @JavascriptInterface
    fun openContacts() {
        main.post {
            val launch = context.packageManager.getLaunchIntentForPackage(CONTACTS_PKG)
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                runCatching { context.startActivity(launch) }
                return@post
            }
            val web = Intent(Intent.ACTION_VIEW, Uri.parse("https://contacts.hubera.cloud")).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            runCatching { context.startActivity(web) }
        }
    }

    private fun fetchContacts(): String? {
        val token = token()
        if (token.isBlank()) return "[]"
        for (url in CONTACTS_URLS) {
            val body = getJson(url, token) ?: continue
            if (body.startsWith("[")) return body
        }
        return "[]"
    }

    private fun getJson(url: String, token: String): String? {
        val conn = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 12_000
            readTimeout = 12_000
            instanceFollowRedirects = true
            setRequestProperty("Accept", "application/json")
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("User-Agent", "HuberaMaps/0.1.42")
        }
        return try {
            val code = conn.responseCode
            android.util.Log.i("HuberaSuite", "GET $code $url")
            if (code !in 200..299) return null
            conn.inputStream.bufferedReader().use { it.readText() }
        } catch (t: Throwable) {
            android.util.Log.w("HuberaSuite", "${t.javaClass.simpleName} $url ${t.message}")
            null
        } finally {
            conn.disconnect()
        }
    }

    companion object {
        const val CONTACTS_PKG = "fr.cloudity.cloudity_contacts"
        val CONTACTS_URLS = listOf(
            "https://api.cloudity.delhomme.ovh/contacts",
            "https://contacts.hubera.cloud/contacts",
            "http://192.168.1.134:6002/contacts",
        )
    }
}
