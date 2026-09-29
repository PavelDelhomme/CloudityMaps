package ovh.delhomme.maps

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat

class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var music: MusicBridge
    private lateinit var fuel: FuelBridge
    private lateinit var speed: SpeedLimitBridge
    private lateinit var tts: TtsBridge
    private lateinit var suite: SuiteBridge
    private lateinit var offline: OfflineBridge
    private lateinit var updates: UpdateBridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, true)
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            != PackageManager.PERMISSION_GRANTED
        ) {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                1,
            )
        }
        web = WebView(this)
        setContentView(web)
        music = MusicBridge(this) { if (this::web.isInitialized) web else null }
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.databaseEnabled = true
        web.settings.cacheMode = WebSettings.LOAD_DEFAULT
        web.settings.setGeolocationEnabled(true)
        web.settings.allowFileAccess = true
        web.settings.allowContentAccess = true
        web.settings.mediaPlaybackRequiresUserGesture = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true)
        @Suppress("DEPRECATION")
        web.settings.allowUniversalAccessFromFileURLs = true
        web.addJavascriptInterface(music, "HuberaMusic")
        fuel = FuelBridge(this)
        web.addJavascriptInterface(fuel, "HuberaFuel")
        tts = TtsBridge(this)
        web.addJavascriptInterface(tts, "HuberaTts")
        speed = SpeedLimitBridge { if (this::web.isInitialized) web else null }
        web.addJavascriptInterface(speed, "HuberaSpeed")
        val routes = RouteBridge { if (this::web.isInitialized) web else null }
        web.addJavascriptInterface(routes, "HuberaRoute")
        suite = SuiteBridge(this) { if (this::web.isInitialized) web else null }
        web.addJavascriptInterface(suite, "HuberaSuite")
        suite.ingest(intent?.data)
        offline = OfflineBridge(this) { if (this::web.isInitialized) web else null }
        web.addJavascriptInterface(offline, "HuberaOffline")
        updates = UpdateBridge(this)
        web.addJavascriptInterface(updates, "HuberaUpdate")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                return OfflineBridge.serveTile(this@MainActivity, request.url)
                    ?: super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "gasoiltracking" || u.scheme == "ytmusic" || u.scheme == "plm") {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
                val host = (u.host ?: "").lowercase()
                val path = u.path ?: ""
                // Jamais Chrome pour MAJ Maps : tout passe par InAppUpdate.
                val mapsOta =
                    host.endsWith("maps.hubera.cloud") &&
                        (path.startsWith("/install") || path.startsWith("/apk") || path.startsWith("/updates"))
                val huberaOta =
                    host == "hubera.cloud" && path.startsWith("/updates/maps")
                if (mapsOta || huberaOta) {
                    InAppUpdate(this@MainActivity).check()
                    return true
                }
                val tiles =
                    host.endsWith("openstreetmap.org") ||
                        host.endsWith("openstreetmap.de") ||
                        host.endsWith("openstreetmap.fr") ||
                        host.endsWith("arcgisonline.com") ||
                        host.endsWith("komoot.io") ||
                        host.endsWith("project-osrm.org") ||
                        host.endsWith("transitous.org") ||
                        host.endsWith("overpass-api.de") ||
                        host.endsWith("kumi.systems") ||
                        host.endsWith("cartocdn.com") ||
                        host.endsWith("nominatim.org")
                if ((u.scheme == "https" || u.scheme == "http") && !tiles) {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                music.startWatch()
                if (this@MainActivity::suite.isInitialized) suite.refreshContacts()
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?,
            ) {
                callback?.invoke(origin, true, false)
            }

            override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                val m = consoleMessage ?: return super.onConsoleMessage(consoleMessage)
                android.util.Log.w(
                    "MapsJS",
                    "${m.messageLevel()} ${m.sourceId()}:${m.lineNumber()} ${m.message()}",
                )
                return true
            }
        }
        web.loadUrl(urlFromIntent(intent))
        val updater = InAppUpdate(this)
        Handler(Looper.getMainLooper()).postDelayed({ updater.check() }, 400)
        Handler(Looper.getMainLooper()).postDelayed({ updater.check() }, 2500)
        Handler(Looper.getMainLooper()).postDelayed({ updater.check() }, 8000)
    }

    override fun onResume() {
        super.onResume()
        InAppUpdate(this).retryPending()
        InAppUpdate(this).check()
        if (this::web.isInitialized) {
            web.resumeTimers()
            web.onResume()
            web.evaluateJavascript(
                "window.__mapsEnergyResume&&window.__mapsEnergyResume()",
                null,
            )
        }
        if (this::music.isInitialized) {
            music.startWatch()
        }
    }

    override fun onPause() {
        if (this::music.isInitialized) music.stopWatch()
        if (this::web.isInitialized) {
            web.evaluateJavascript(
                "window.__mapsEnergyPause&&window.__mapsEnergyPause()",
                null,
            )
            web.onPause()
            web.pauseTimers()
        }
        super.onPause()
    }

    override fun onDestroy() {
        if (this::music.isInitialized) music.release()
        if (this::tts.isInitialized) tts.release()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val data: Uri? = intent.data
        val q =
            if (data != null && (data.scheme == "hubera-maps" || data.scheme == "cloudity-maps")) {
                data.encodedQuery
            } else {
                null
            }
        // Retour Fuel silencieux (hubera-maps://fuel?tripId=&trips=) : garder le guidage.
        val fuelBack =
            data?.host == "fuel" ||
                (!q.isNullOrBlank() &&
                    (q.contains("tripId=") || q.contains("trips=") || q.contains("ok=")) &&
                    !q.contains("toLat") &&
                    !q.contains("lat="))
        if (fuelBack) {
            if (this::fuel.isInitialized) fuel.cancelBringBack()
            val safe = (q ?: "").replace("\\", "\\\\").replace("'", "\\'")
            web.evaluateJavascript(
                "window.__mapsFuelEvent&&window.__mapsFuelEvent('$safe')",
                null,
            )
            return
        }
        if (!q.isNullOrBlank()) {
            val auth =
                q.contains("email=") ||
                    q.contains("token=") ||
                    q.contains("access=") ||
                    data?.host == "auth"
            if (auth) {
                if (this::suite.isInitialized) suite.ingest(data)
                val safe = q.replace("\\", "\\\\").replace("'", "\\'")
                web.evaluateJavascript(
                    "window.__mapsApplyAuth&&window.__mapsApplyAuth('$safe')",
                    null,
                )
            } else {
                web.loadUrl("file:///android_asset/index.html?$q")
            }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (!this::web.isInitialized) {
            super.onBackPressed()
            return
        }
        web.evaluateJavascript("(function(){try{return window.__mapsBack&&window.__mapsBack()||false;}catch(e){return false;}})()") { raw ->
            if (raw == "true") return@evaluateJavascript
            if (web.canGoBack()) web.goBack()
            else super.onBackPressed()
        }
    }

    private fun urlFromIntent(intent: Intent?): String {
        val data: Uri? = intent?.data
        val q =
            if (data != null && (data.scheme == "hubera-maps" || data.scheme == "cloudity-maps")) {
                data.encodedQuery
            } else {
                null
            }
        return if (!q.isNullOrBlank()) {
            "file:///android_asset/index.html?$q"
        } else {
            "file:///android_asset/index.html"
        }
    }

}
