package ovh.delhomme.maps

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.text.InputType
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.widget.Toast
import java.util.Locale
import androidx.appcompat.app.AlertDialog
import android.os.Build
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
    private lateinit var location: LocationBridge
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
            offerHuberaAccount()
        }, 400)
        main.postDelayed({
            askLocationIfNeeded()
            if (this::location.isInitialized) runCatching { location.startWatchUi() }
        }, 900)
        main.postDelayed({
            runCatching { InAppUpdate(this).check() }
        }, 2800)
    }

    private fun systemNight(): Boolean =
        (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES

    private fun pushSystemNight(view: WebView?) {
        if (view == null) return
        val night = systemNight()
        view.setBackgroundColor(if (night) 0xFF0F0F1A.toInt() else 0xFFF7F8FA.toInt())
        view.evaluateJavascript(
            "window.__huberaSystemNight=${if (night) "true" else "false"};try{applyTiles()}catch(e){}",
            null,
        )
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
        suite = SuiteBridge(
            this,
            { if (this::web.isInitialized) web else null },
            onChooseAccount = { offerHuberaAccount(force = true) },
        )
        target.addJavascriptInterface(suite, "HuberaSuite")
        val calendar = CalendarBridge(this) { if (this::suite.isInitialized) suite else null }
        target.addJavascriptInterface(calendar, "HuberaCalendar")
        offline = OfflineBridge(this) { if (this::web.isInitialized) web else null }
        target.addJavascriptInterface(offline, "HuberaOffline")
        updates = UpdateBridge(this)
        target.addJavascriptInterface(updates, "HuberaUpdate")
        location = LocationBridge(this) { if (this::web.isInitialized) web else null }
        target.addJavascriptInterface(location, "HuberaLocation")
        target.addJavascriptInterface(TripBridge(this), "HuberaTrip")
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
                        host.endsWith("bison-fute.gouv.fr") ||
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
                pushSystemNight(view)
                if (lastSafeJs.isNotBlank()) view?.evaluateJavascript(lastSafeJs, null)
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
        if (this::location.isInitialized) {
            runCatching { location.startWatchUi() }
        }
        if (this::tts.isInitialized) {
            runCatching { tts.ensureReady() }
        }
    }

    override fun onPause() {
        if (this::music.isInitialized) runCatching { music.stopWatch() }
        if (this::location.isInitialized && !TripKeepAliveService.running) {
            runCatching { location.stopWatchUi() }
        }
        if (this::web.isInitialized && !TripKeepAliveService.running) {
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
            else moveTaskToBack(true)
        }
    }

    private fun offerHuberaAccount(force: Boolean = false) {
        if (isFinishing || !this::suite.isInitialized) return
        if (!force && suite.token().isNotBlank()) {
            if (!isHuberaIdInstalled()) {
                AlertDialog.Builder(this)
                    .setTitle("Installer Hubera ID")
                    .setPositiveButton("Installer") { _, _ -> openHuberaIdInstall() }
                    .setNegativeButton("Plus tard", null)
                    .show()
            }
            return
        }
        val accounts = runCatching {
            cloud.hubera.id.sso.HuberaIdAccounts.listAccounts(this)
        }.getOrDefault(emptyList()).filter { it.email.isNotBlank() }
        val night = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val ink = if (night) 0xFFE8EAED.toInt() else 0xFF202124.toInt()
        val muted = if (night) 0xFF9AA0A6.toInt() else 0xFF5F6368.toInt()
        val surface = if (night) 0xFF2D2E30.toInt() else Color.WHITE
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(surface)
            setPadding(dp(8), dp(16), dp(8), dp(8))
        }
        box.addView(TextView(this).apply {
            text = "Choisir un compte"
            setTextColor(ink)
            textSize = 22f
            setPadding(dp(16), dp(8), dp(16), dp(8))
        })
        val dialog = AlertDialog.Builder(this).setView(ScrollView(this).apply { addView(box) }).create()
        accounts.forEach { acc ->
            val title = accountTitle(acc.displayName, acc.email)
            box.addView(accountRow(title, acc.email, accountInitial(title, acc.email), acc.email, ink, muted) {
                dialog.dismiss()
                if (acc.accessToken.isBlank() && acc.refreshToken.isBlank()) {
                    Toast.makeText(this@MainActivity, "Session absente", Toast.LENGTH_LONG).show()
                } else {
                    suite.continueWithHubera(acc.email)
                }
            })
        }
        box.addView(accountRow("Ajouter un compte", null, null, null, ink, muted) {
            dialog.dismiss()
            promptNewAccount()
        })
        if (!isHuberaIdInstalled()) {
            box.addView(accountRow("Installer Hubera ID", null, null, null, ink, muted) {
                dialog.dismiss()
                openHuberaIdInstall()
            })
        }
        dialog.setOnShowListener {
            dialog.window?.setBackgroundDrawable(ColorDrawable(surface))
        }
        dialog.show()
    }

    private fun accountTitle(displayName: String, email: String): String {
        val name = displayName.trim()
        if (name.isNotEmpty() && !name.equals(email, ignoreCase = true)) return name
        val local = email.substringBefore('@').trim()
        if (local.isEmpty()) return email
        return local.replaceFirstChar { if (it.isLowerCase()) it.titlecase(Locale.ROOT) else it.toString() }
    }

    private fun accountInitial(title: String, email: String): String {
        val source = title.trim().ifEmpty { email.trim() }
        return if (source.isEmpty()) "?" else source.first().uppercaseChar().toString()
    }

    private fun accountRow(
        title: String,
        subtitle: String?,
        letter: String?,
        colorKey: String?,
        ink: Int,
        muted: Int,
        onClick: () -> Unit,
    ): LinearLayout {
        val row = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            minimumHeight = dp(64)
            setPadding(dp(16), dp(8), dp(16), dp(8))
            isClickable = true
            isFocusable = true
            val out = TypedValue()
            theme.resolveAttribute(android.R.attr.selectableItemBackground, out, true)
            setBackgroundResource(out.resourceId)
            setOnClickListener { onClick() }
        }
        row.addView(TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(40), dp(40)).apply { marginEnd = dp(16) }
            gravity = Gravity.CENTER
            textSize = 16f
            if (letter == null) {
                text = "+"
                setTextColor(ink)
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(Color.TRANSPARENT)
                    setStroke(dp(1), muted)
                }
            } else {
                text = letter
                setTextColor(Color.WHITE)
                typeface = Typeface.DEFAULT_BOLD
                background = GradientDrawable().apply {
                    shape = GradientDrawable.OVAL
                    setColor(avatarColor(colorKey ?: title))
                }
            }
        })
        val labels = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)
        }
        labels.addView(TextView(this).apply {
            text = title
            setTextColor(ink)
            textSize = 16f
            maxLines = 1
        })
        val sub = subtitle?.trim().orEmpty()
        if (sub.isNotEmpty() && !sub.equals(title, ignoreCase = true)) {
            labels.addView(TextView(this).apply {
                text = sub
                setTextColor(muted)
                textSize = 14f
                maxLines = 1
            })
        }
        row.addView(labels)
        return row
    }

    private fun avatarColor(key: String): Int {
        val palette = intArrayOf(
            0xFF1A73E8.toInt(), 0xFF188038.toInt(), 0xFFE37400.toInt(), 0xFF9334E6.toInt(),
            0xFF007B83.toInt(), 0xFFC5221F.toInt(), 0xFF1967D2.toInt(), 0xFF0D7377.toInt(),
        )
        var hash = 0
        for (ch in key.lowercase(Locale.ROOT)) hash = (hash * 31 + ch.code) and 0x7fffffff
        return palette[hash % palette.size]
    }

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun promptNewAccount() {
        val email = EditText(this).apply { hint = "E-mail" }
        val password = EditText(this).apply {
            hint = "Mot de passe Hubera ID"
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        }
        val box = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(48, 16, 48, 0)
            addView(email)
            addView(password)
        }
        AlertDialog.Builder(this)
            .setTitle("Ajouter un compte")
            .setView(box)
            .setPositiveButton("Créer la session") { _, _ ->
                Thread {
                    val err = runCatching {
                        suite.loginNewAccount(email.text.toString(), password.text.toString())
                    }.getOrElse { it.message }
                    runOnUiThread {
                        if (!err.isNullOrBlank()) {
                            Toast.makeText(this, err, Toast.LENGTH_LONG).show()
                        }
                    }
                }.start()
            }
            .setNegativeButton("Annuler", null)
            .show()
    }

    private fun isHuberaIdInstalled(): Boolean =
        runCatching {
            packageManager.getPackageInfo("cloud.hubera.id", 0)
            true
        }.getOrDefault(false)

    private fun openHuberaIdInstall() {
        val launch = packageManager.getLaunchIntentForPackage("cloud.hubera.id")
        val intent = launch ?: Intent(Intent.ACTION_VIEW, Uri.parse("https://id.hubera.cloud/"))
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        runCatching { startActivity(intent) }
    }

    /** Android 15 : env(safe-area-inset-*) est souvent 0 dans la WebView. */
    private var lastSafeJs = ""

    private fun applySafeAreaJs(target: WebView, insets: WindowInsetsCompat) {
        val topRaw = insets.getInsets(WindowInsetsCompat.Type.statusBars()).top
        val bottomRaw = insets.getInsets(WindowInsetsCompat.Type.navigationBars()).bottom
        // Nothing : le glyph gonfle l’inset. Moitié de l’inset, assez pour passer
        // sous la barre d’état (0.1.86 à 18 px collait encore dessus).
        // Samsung / autres : inset réel, plancher 24, plafond 36 (réglage 0.1.85).
        val top =
            if (isNothingPhone()) {
                (topRaw / 2).coerceIn(26, 32)
            } else {
                maxOf(topRaw, 24).coerceAtMost(36)
            }
        val bottom = bottomRaw.coerceIn(0, 36)
        lastSafeJs =
            "try{var de=document.documentElement;if(de&&de.style){de.style.setProperty('--safe-top','${top}px');de.style.setProperty('--safe-bottom','${bottom}px');}}catch(e){}"
        target.evaluateJavascript(lastSafeJs, null)
    }

    private fun bindSafeArea(target: WebView) {
        ViewCompat.setOnApplyWindowInsetsListener(target) { _, insets ->
            applySafeAreaJs(target, insets)
            WindowInsetsCompat.CONSUMED
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

        /** Phone (1)/(2)/(2a)/(3) : constructeur Nothing ou nom de code AOSP. */
        fun isNothingPhone(): Boolean {
            val m = Build.MANUFACTURER
            val b = Build.BRAND
            val d = Build.DEVICE
            return m.equals("Nothing", ignoreCase = true) ||
                b.equals("Nothing", ignoreCase = true) ||
                d.startsWith("Pong", ignoreCase = true) ||
                d.startsWith("Spacewar", ignoreCase = true) ||
                d.startsWith("Pacman", ignoreCase = true) ||
                d.startsWith("Tetriq", ignoreCase = true) ||
                d.startsWith("Asteroids", ignoreCase = true)
        }
    }
}
