package ovh.delhomme.maps

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
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
        web.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val u = request.url
                if (u.scheme == "gasoiltracking" || u.scheme == "ytmusic" || u.scheme == "plm") {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
                val host = u.host ?: ""
                val tiles =
                    host.endsWith("openstreetmap.org") ||
                        host.endsWith("openstreetmap.de") ||
                        host.endsWith("komoot.io") ||
                        host.endsWith("project-osrm.org") ||
                        host.endsWith("transitous.org")
                if ((u.scheme == "https" || u.scheme == "http") && !tiles) {
                    startActivity(Intent(Intent.ACTION_VIEW, u))
                    return true
                }
                return false
            }

            override fun onPageFinished(view: WebView?, url: String?) {
                music.connect()
                music.pushToWeb()
            }
        }
        web.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String?,
                callback: GeolocationPermissions.Callback?,
            ) {
                callback?.invoke(origin, true, false)
            }
        }
        web.loadUrl(urlFromIntent(intent))
    }

    override fun onResume() {
        super.onResume()
        if (this::web.isInitialized) {
            web.resumeTimers()
            web.onResume()
            web.evaluateJavascript(
                "window.__mapsEnergyResume&&window.__mapsEnergyResume()",
                null,
            )
        }
        if (this::music.isInitialized) {
            music.connect()
            music.pushToWeb()
        }
    }

    override fun onPause() {
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
        // Retour Fuel (hubera-maps:// sans query) : garder le guidage, ne pas recharger.
        if (!q.isNullOrBlank()) {
            val auth = q.contains("email=") || data?.host == "auth"
            if (auth) {
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
