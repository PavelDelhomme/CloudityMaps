package ovh.delhomme.maps

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
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
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat

/**
 * UI WebView d’avant le chrome natif 0.1.80 (HUD / search / tabs HTML).
 * Cold start 0.1.79 : carte d’abord, adoptHuberaId hors UI, GPS après le paint.
 */
class MainActivity : AppCompatActivity() {
    private lateinit var web: WebView
    private lateinit var music: MusicBridge
    private lateinit var fuel: FuelBridge
    private lateinit var speed: SpeedLimitBridge
    private lateinit var tts: TtsBridge
    private lateinit var suite: SuiteBridge
    private lateinit var offline: OfflineBridge
    private lateinit var updates: UpdateBridge
    private val main = Handler(Looper.getMainLooper())
    private var askedLocation = false

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        try {
            bootUi()
        } catch (t: Throwable) {
            Log.e(TAG, "cold start failed, showing map shell", t)
            runCatching { showBareMap() }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun bootUi() {
        web = WebView(this)
        setContentView(web)
        bindWeb(web)
        bindSafeArea(web)
        web.loadUrl(urlFromIntent(intent))
        // Carte d’abord. SSO / GPS / OTA après le premier paint — jamais bloquer le thread UI.
        main.post {
            runCatching { if (this::suite.isInitialized) suite.ingest(intent?.data) }
        }
        main.postDelayed({
            runCatching { if (this::suite.isInitialized) suite.adoptHuberaId() }
        }, 400)
        main.postDelayed({ askLocationIfNeeded() }, 900)
        main.postDelayed({
            runCatching { InAppUpdate(this).check() }
        }, 2800)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun bindWeb(target: WebView) {
        music = MusicBridge(this) { if (this::web.isInitialized) web else null }
        target.settings.javaScriptEnabled = true
        target.settings.domStorageEnabled = true
        target.settings.databaseEnabled = true
        target.settings.cacheMode = WebSettings.LOAD_DEFAULT
        target.settings.setGeolocationEnabled(true)
        target.settings.allowFileAccess = true
        target.settings.allowContentAccess = true
        target.settings.mediaPlaybackRequiresUserGesture = true
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(target, true)
        @Suppress("DEPRECATION")
        target.settings.allowUniversalAccessFromFileURLs = true
        target.addJavascriptInterface(music, "HuberaMusic")
        fuel = FuelBridge(this)
        target.addJavascriptInterface(fuel, "HuberaFuel")
        tts = TtsBridge(this)
        target.addJavascriptInterface(tts, "HuberaTts")
        speed = SpeedLimitBridge { if (this::web.isInitialized) web else null }
        target.addJavascriptInterface(speed, "HuberaSpeed")
        val routes = RouteBridge { if (this::web.isInitialized) web else null }
        target.addJavascriptInterface(routes, "HuberaRoute")
        suite = SuiteBridge(this) { if (this::web.isInitialized) web else null }
        target.addJavascriptInterface(suite, "HuberaSuite")
        val calendar = CalendarBridge(this) { if (this::suite.isInitialized) suite else null }
        target.addJavascriptInterface(calendar, "HuberaCalendar")
        offline = OfflineBridge(this) { if (this::web.isInitialized) web else null }
        target.addJavascriptInterface(offline, "HuberaOffline")
        updates = UpdateBridge(this)
        target.addJavascriptInterface(updates, "HuberaUpdate")
        target.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest,
            ): WebResourceResponse? {
                return runCatching {
                    OfflineBridge.serveTile(this@MainActivity, request.url)
                }.getOrNull() ?: super.shouldInterceptRequest(view, request)
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "gasoiltracking" || u.scheme == "ytmusic" || u.scheme == "plm") {
                    safeView(u)
                    return true
                }
                val host = (u.host ?: "").lowercase()
                val path = u.path ?: ""
                val mapsOta =
                    host.endsWith("maps.hubera.cloud") &&
                        (path.startsWith("/install") ||
                            path.startsWith("/apk") ||
                            path.startsWith("/download") ||
                            path.startsWith("/updates"))
                val huberaOta =
                    host == "hubera.cloud" && path.startsWith("/updates/maps")
                if (mapsOta || huberaOta) {
                    runCatching { InAppUpdate(this@MainActivity).check() }
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
                    safeView(u)
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                view?.requestApplyInsets()
                runCatching { if (this@MainActivity::music.isInitialized) music.startWatch() }
                runCatching { if (this@MainActivity::suite.isInitialized) suite.refreshContacts() }
            }
        }
        target.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?,
            ) {
                callback?.invoke(origin, true, false)
            }

            override fun onConsoleMessage(consoleMessage: android.webkit.ConsoleMessage?): Boolean {
                val m = consoleMessage ?: return super.onConsoleMessage(consoleMessage)
                Log.w(
                    "MapsJS",
                    "${m.messageLevel()} ${m.sourceId()}:${m.lineNumber()} ${m.message()}",
                )
                return true
            }
        }
    }

    private fun showBareMap() {
        if (!this::web.isInitialized) {
            web = WebView(this)
            setContentView(web)
            runCatching { bindWeb(web) }
            bindSafeArea(web)
        }
        runCatching { web.loadUrl("file:///android_asset/index.html") }
    }

    private fun askLocationIfNeeded() {
        if (askedLocation || isFinishing) return
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION)
            == PackageManager.PERMISSION_GRANTED
        ) {
            return
        }
        askedLocation = true
        runCatching {
            ActivityCompat.requestPermissions(
                this,
                arrayOf(
                    Manifest.permission.ACCESS_FINE_LOCATION,
                    Manifest.permission.ACCESS_COARSE_LOCATION,
                ),
                1,
            )
        }
    }

    private fun safeView(uri: Uri) {
        runCatching {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
        }.onFailure { Log.w(TAG, "view ${uri.scheme}: ${it.message}") }
    }

    override fun onResume() {
        super.onResume()
        runCatching { InAppUpdate(this).retryPending() }
        if (this::web.isInitialized) {
            runCatching {
                web.resumeTimers()
                web.onResume()
                web.evaluateJavascript(
                    "window.__mapsEnergyResume&&window.__mapsEnergyResume()",
                    null,
                )
            }
        }
        if (this::music.isInitialized) {
            runCatching { music.startWatch() }
        }
    }

    override fun onPause() {
        if (this::music.isInitialized) runCatching { music.stopWatch() }
        if (this::web.isInitialized) {
            runCatching {
                web.evaluateJavascript(
                    "window.__mapsEnergyPause&&window.__mapsEnergyPause()",
                    null,
                )
                web.onPause()
                web.pauseTimers()
            }
        }
        super.onPause()
    }

    override fun onDestroy() {
        if (this::music.isInitialized) runCatching { music.release() }
        if (this::tts.isInitialized) runCatching { tts.release() }
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
        val fuelBack =
            data?.host == "fuel" ||
                (!q.isNullOrBlank() &&
                    (q.contains("tripId=") || q.contains("trips=") || q.contains("ok=")) &&
                    !q.contains("toLat") &&
                    !q.contains("lat="))
        if (fuelBack) {
            if (this::fuel.isInitialized) fuel.cancelBringBack()
            val safe = (q ?: "").replace("\\", "\\\\").replace("'", "\\'")
            runCatching {
                web.evaluateJavascript(
                    "window.__mapsFuelEvent&&window.__mapsFuelEvent('$safe')",
                    null,
                )
            }
            return
        }
        if (!q.isNullOrBlank()) {
            val auth =
                q.contains("email=") ||
                    q.contains("token=") ||
                    q.contains("access=") ||
                    data?.host == "auth"
            if (auth) {
                if (this::suite.isInitialized) runCatching { suite.ingest(data) }
                val safe = q.replace("\\", "\\\\").replace("'", "\\'")
                runCatching {
                    web.evaluateJavascript(
                        "window.__mapsApplyAuth&&window.__mapsApplyAuth('$safe')",
                        null,
                    )
                }
            } else if (this::web.isInitialized) {
                runCatching { web.loadUrl("file:///android_asset/index.html?$q") }
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

    /** Android 15 : env(safe-area-inset-*) est souvent 0 dans la WebView. */
    private fun bindSafeArea(target: WebView) {
        ViewCompat.setOnApplyWindowInsetsListener(target) { _, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            val js =
                "document.documentElement.style.setProperty('--safe-top','${bars.top}px');" +
                    "document.documentElement.style.setProperty('--safe-bottom','${bars.bottom}px');"
            target.evaluateJavascript(js, null)
            insets
        }
        ViewCompat.requestApplyInsets(target)
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

    companion object {
        private const val TAG = "HuberaMaps"
    }
}
