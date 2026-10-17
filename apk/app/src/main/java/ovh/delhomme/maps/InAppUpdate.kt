package ovh.delhomme.maps

import android.app.Activity
import android.app.Dialog
import android.content.Intent
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.ColorDrawable
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * Mise à jour proposée, jamais forcée : même carte que Hubera Fuel.
 * Téléchargement dans le cache de l’app, puis installateur Android (pas silencieux).
 * Couleurs = thème jour/nuit du téléphone, pas celles de la carte.
 */
class InAppUpdate(private val activity: Activity) {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)

    @Volatile private var cancelDownload = false
    @Volatile private var conn: HttpURLConnection? = null
    private var card: UpdateCard? = null
    private var offer: Offer? = null

    fun check(userInitiated: Boolean = false) {
        if (userInitiated) {
            main.post {
                val local = localVersionName()
                showCard(
                    title = "Vérification…",
                    versions = "Installée $local",
                    notes = "On vérifie s’il y a une mise à jour. L’icône tourne tant que ça continue.",
                    busy = true,
                    progress = 0.15f,
                    message = "Vérification…",
                    error = null,
                    primary = null,
                )
            }
        }
        Thread {
            try {
                runCatching { checkInner(userInitiated) }
                    .onFailure {
                        if (userInitiated) {
                            main.post {
                                dismissCard()
                                Toast.makeText(
                                    activity,
                                    "Vérification impossible — réseau",
                                    Toast.LENGTH_LONG,
                                ).show()
                            }
                        }
                    }
            } catch (_: Throwable) {
                /* déjà signalé */
            }
        }.start()
    }

    /** Après Réglages « sources inconnues » : ouvrir l’installateur si l’APK est déjà là. */
    fun retryPending() {
        if (!prefs.getBoolean(PENDING_AFTER_PERM, false)) return
        if (!hasInstallPermission()) return
        prefs.edit().putBoolean(PENDING_AFTER_PERM, false).apply()
        val path = prefs.getString(PENDING_FILE, null) ?: return
        val dest = File(path)
        if (probe(dest).reusable(dest, null)) {
            main.post { installApk(dest) }
        }
    }

    private fun checkInner(userInitiated: Boolean) {
        cleanupOldCaches()
        val localName = localVersionName()
        val localVc = localVersionCode()
        val feed = fetchFeed()
        if (feed == null) {
            if (userInitiated) {
                main.post {
                    dismissCard()
                    Toast.makeText(activity, "Vérification impossible — réseau", Toast.LENGTH_LONG).show()
                }
            }
            return
        }
        if (feed.has("apkAvailable") && !feed.optBoolean("apkAvailable", true)) {
            if (userInitiated) {
                main.post {
                    dismissCard()
                    Toast.makeText(activity, "Application à jour — $localName", Toast.LENGTH_LONG).show()
                }
            } else {
                main.post { dismissCard() }
            }
            return
        }
        val found = resolveOffer(feed, localName) ?: run {
            if (userInitiated) {
                main.post {
                    dismissCard()
                    Toast.makeText(activity, "Application à jour — $localName", Toast.LENGTH_LONG).show()
                }
            } else {
                main.post { dismissCard() }
            }
            return
        }
        val remoteVc = found.versionCode
        val newer = if (remoteVc > 0L && localVc > 0L) {
            remoteVc > localVc
        } else {
            isNewer(found.version, localName)
        }
        if (!newer) {
            if (userInitiated) {
                main.post {
                    dismissCard()
                    Toast.makeText(activity, "Application à jour — $localName", Toast.LENGTH_LONG).show()
                }
            } else {
                main.post { dismissCard() }
            }
            return
        }
        if (!userInitiated && snoozed(found.version)) {
            main.post { dismissCard() }
            return
        }
        offer = found
        main.post {
            showCard(
                title = "Nouvelle version disponible",
                versions = "$localName → ${found.version}",
                notes = userNotes(found.notes, found.version),
                busy = false,
                progress = 0f,
                message = null,
                error = null,
                primary = "Installer maintenant",
            )
        }
    }

    private fun resolveOffer(feed: JSONObject, localName: String): Offer? {
        val localPkg = activity.packageName
        val slot = sequenceOf(
            feed.optJSONObject("canonical"),
            feed.optJSONObject("legacy"),
        ).firstOrNull { it != null && it.optString("package") == localPkg }
        if (slot != null) {
            val version = slot.optString("version")
            val url = slot.optString("apk_url").ifBlank { slot.optString("apk") }
            if (version.isBlank() || url.isBlank()) return null
            val notes = slot.optString("notes").ifBlank {
                feed.optString("notes").ifBlank { "" }
            }
            return Offer(
                version = version,
                versionCode = slot.optLong("versionCode", 0L),
                notes = notes,
                apkUrl = url,
                sha256 = slot.optString("sha256"),
            )
        }
        val remotePkg = feed.optString("package")
        if (remotePkg.isNotBlank() && remotePkg != localPkg) return null
        val version = feed.optString("version")
        val url = feed.optString("apk").ifBlank { feed.optString("apk_url") }
        if (version.isBlank() || url.isBlank()) return null
        if (!isNewer(version, localName) && feed.optLong("versionCode", 0L) <= 0L) return null
        return Offer(
            version = version,
            versionCode = feed.optLong("versionCode", 0L),
            notes = feed.optString("notes"),
            apkUrl = url,
            sha256 = feed.optString("sha256"),
        )
    }

    private fun startInstall() {
        val current = offer ?: return
        if (!hasInstallPermission()) {
            askInstallPermission(null)
            showCard(
                title = "Nouvelle version disponible",
                versions = "${localVersionName()} → ${current.version}",
                notes = userNotes(current.notes, current.version),
                busy = false,
                progress = 0f,
                message = null,
                error = "Autorisez « Installer des apps inconnues » pour Hubera Maps, puis relancez la mise à jour.",
                primary = "Réessayer l’installation",
            )
            return
        }
        cancelDownload = false
        showCard(
            title = "Nouvelle version disponible",
            versions = "${localVersionName()} → ${current.version}",
            notes = userNotes(current.notes, current.version),
            busy = true,
            progress = 0.08f,
            message = "Préparation…",
            error = null,
            primary = null,
        )
        Thread {
            try {
                downloadAndInstall(current)
            } catch (_: Cancelled) {
                /* l’utilisateur a choisi de continuer sans installer */
            } catch (t: Throwable) {
                val msg = t.message?.takeIf { it.isNotBlank() }
                    ?: "Téléchargement impossible. Réessayez."
                main.post {
                    if (cancelDownload) return@post
                    showCard(
                        title = "Nouvelle version disponible",
                        versions = "${localVersionName()} → ${current.version}",
                        notes = userNotes(current.notes, current.version),
                        busy = false,
                        progress = 0f,
                        message = null,
                        error = msg,
                        primary = "Réessayer l’installation",
                    )
                }
            }
        }.start()
    }

    private fun downloadAndInstall(current: Offer) {
        val dest = apkFile(current.version, current.versionCode)
        dest.parentFile?.mkdirs()
        val probed = probe(dest)
        if (!probed.zipMagic && dest.exists() && dest.length() > 0L) {
            postProgress(0.05f, "Le fichier en cache n’est pas une APK. Nouveau téléchargement.")
            dest.delete()
        }
        val again = probe(dest)
        if (again.reusable(dest, current.sha256)) {
            postProgress(0.88f, "APK déjà téléchargée — ouverture de l’installateur…")
        } else {
            val resume = again.zipMagic && !again.complete && dest.length() >= 100_000L
            if (resume) {
                postProgress(0.1f, "Reprise du téléchargement…")
            } else {
                if (dest.exists() && !again.reusable(dest, current.sha256)) dest.delete()
                postProgress(0.1f, "Téléchargement depuis le serveur…")
            }
            val code = streamApk(current.apkUrl, dest, resume)
            if (cancelDownload) throw Cancelled()
            if (code != 200 && code != 206) {
                throw IllegalStateException("Échec du téléchargement OTA (HTTP $code)")
            }
        }
        val ready = probe(dest)
        if (!ready.reusable(dest, current.sha256)) {
            dest.delete()
            throw IllegalStateException(
                if (ready.zipMagic) {
                    "APK téléchargée invalide ou incomplète. Réessayez."
                } else {
                    "Fichier téléchargé n’est pas une APK (réseau / cache)."
                },
            )
        }
        if (cancelDownload) throw Cancelled()
        postProgress(0.92f, "Ouverture de l’installateur Android…")
        main.post {
            if (activity.isFinishing || cancelDownload) return@post
            installApk(dest)
            val still = offer
            if (still != null) {
                showCard(
                    title = "Nouvelle version disponible",
                    versions = "${localVersionName()} → ${still.version}",
                    notes = userNotes(still.notes, still.version),
                    busy = false,
                    progress = 0f,
                    message = null,
                    error = null,
                    primary = "Installer maintenant",
                )
            }
        }
    }

    private fun streamApk(apkUrl: String, dest: File, resume: Boolean): Int {
        val connection = (URL(apkUrl).openConnection() as HttpURLConnection).also { conn = it }
        connection.connectTimeout = 12_000
        connection.readTimeout = 90_000
        connection.instanceFollowRedirects = true
        connection.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*")
        val existing = if (resume && dest.exists()) dest.length() else 0L
        if (existing >= 100_000L) {
            connection.setRequestProperty("Range", "bytes=$existing-")
        }
        connection.connect()
        val code = connection.responseCode
        val type = connection.contentType?.lowercase().orEmpty()
        if (type.contains("text/html") || type.contains("application/json")) {
            connection.disconnect()
            dest.delete()
            throw IllegalStateException("Fichier téléchargé n’est pas une APK (réseau / cache).")
        }
        if (code != 200 && code != 206) {
            connection.disconnect()
            return code
        }
        val append = code == 206 && dest.exists()
        if (!append && dest.exists()) dest.delete()
        val totalHeader = connection.getHeaderField("Content-Range")
        val total = totalHeader?.substringAfter("/", "")?.toLongOrNull()
            ?: connection.contentLengthLong.let { len ->
                if (len > 0L && append) existing + len else len
            }
        connection.inputStream.use { input ->
            FileOutputStream(dest, append).use { output ->
                val buf = ByteArray(64 * 1024)
                var written = if (append) existing else 0L
                while (true) {
                    if (cancelDownload) {
                        connection.disconnect()
                        throw Cancelled()
                    }
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    written += n
                    val pct = if (total > 0L) written.toFloat() / total.toFloat() else 0f
                    val label = if (total > 0L) {
                        "Téléchargement… ${kotlin.math.round(pct * 100f).toInt()} %"
                    } else {
                        "Téléchargement en cours…"
                    }
                    postProgress(0.1f + pct.coerceIn(0f, 1f) * 0.75f, label)
                }
            }
        }
        connection.disconnect()
        conn = null
        return code
    }

    private fun postProgress(progress: Float, message: String) {
        val current = offer ?: return
        main.post {
            if (cancelDownload || activity.isFinishing) return@post
            showCard(
                title = "Nouvelle version disponible",
                versions = "${localVersionName()} → ${current.version}",
                notes = userNotes(current.notes, current.version),
                busy = true,
                progress = progress,
                message = message,
                error = null,
                primary = null,
            )
        }
    }

    private fun later() {
        cancelDownload = true
        runCatching { conn?.disconnect() }
        val version = offer?.version ?: localVersionName()
        prefs.edit()
            .putLong(SNOOZE_UNTIL, System.currentTimeMillis() + SNOOZE_MS)
            .putString(SNOOZE_VERSION, version)
            .apply()
        dismissCard()
    }

    private fun openSite() {
        cancelDownload = true
        runCatching { conn?.disconnect() }
        runCatching {
            activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(INSTALL_URL)))
        }
        dismissCard()
    }

    private fun askInstallPermission(ready: File?) {
        val last = prefs.getLong(PERM_ASKED_AT, 0L)
        if (System.currentTimeMillis() - last < PERM_ASK_COOLDOWN_MS) return
        prefs.edit()
            .putLong(PERM_ASKED_AT, System.currentTimeMillis())
            .putBoolean(PENDING_AFTER_PERM, ready != null && ready.isFile)
            .putString(PENDING_FILE, ready?.absolutePath)
            .apply()
        runCatching {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"),
                ),
            )
        }
    }

    private fun installApk(file: File) {
        if (!hasInstallPermission()) {
            askInstallPermission(file)
            return
        }
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            file,
        )
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            putExtra(Intent.EXTRA_NOT_UNKNOWN_SOURCE, true)
            putExtra(Intent.EXTRA_RETURN_RESULT, false)
        }
        val ok = runCatching { activity.startActivity(intent) }.isSuccess
        if (!ok) {
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, "application/vnd.android.package-archive")
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            runCatching { activity.startActivity(view) }
                .onFailure {
                    Toast.makeText(activity, "Installation impossible.", Toast.LENGTH_LONG).show()
                }
        }
    }

    private fun showCard(
        title: String,
        versions: String,
        notes: String,
        busy: Boolean,
        progress: Float,
        message: String?,
        error: String?,
        primary: String?,
    ) {
        if (activity.isFinishing) return
        val ui = card ?: buildCard().also { card = it }
        val palette = phonePalette()
        ui.title.text = title
        ui.title.setTextColor(palette.text)
        ui.versions.text = versions
        ui.versions.setTextColor(palette.secondary)
        ui.notes.text = notes
        ui.notes.setTextColor(palette.text)
        ui.safe.setTextColor(palette.secondary)
        ui.cardBg.setColor(palette.card)
        ui.cardBg.setStroke(dp(1), palette.border)
        ui.progressBlock.visibility = if (busy) View.VISIBLE else View.GONE
        ui.spinner.indeterminateTintList = ColorStateList.valueOf(palette.accent)
        ui.progressText.text = message ?: "Préparation…"
        ui.progressText.setTextColor(palette.text)
        ui.bar.progressTintList = ColorStateList.valueOf(palette.accent)
        ui.bar.progressBackgroundTintList = ColorStateList.valueOf(palette.border)
        ui.bar.progress = (progress.coerceIn(0f, 1f) * 100).toInt()
        if (error.isNullOrBlank()) {
            ui.error.visibility = View.GONE
        } else {
            ui.error.visibility = View.VISIBLE
            ui.error.text = error
        }
        ui.later.text = if (busy) "Annuler et continuer" else "Continuer sans installer"
        ui.later.setTextColor(palette.secondary)
        ui.site.setTextColor(palette.text)
        if (primary.isNullOrBlank()) {
            ui.primary.visibility = View.GONE
        } else {
            ui.primary.visibility = View.VISIBLE
            ui.primary.text = primary
            ui.primaryBg.setColor(palette.accent)
        }
        if (!ui.dialog.isShowing) ui.dialog.show()
        ui.dialog.window?.setLayout(
            ViewGroup.LayoutParams.MATCH_PARENT,
            ViewGroup.LayoutParams.MATCH_PARENT,
        )
    }

    private fun buildCard(): UpdateCard {
        val palette = phonePalette()
        val root = FrameLayout(activity)
        root.setBackgroundColor(0x8C000000.toInt())
        val cardBg = GradientDrawable().apply {
            cornerRadius = dp(16).toFloat()
            setColor(palette.card)
            setStroke(dp(1), palette.border)
        }
        val column = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            background = cardBg
            setPadding(dp(20), dp(20), dp(20), dp(20))
        }
        val title = TextView(activity).apply {
            textSize = 20f
            setTypeface(typeface, Typeface.BOLD)
        }
        val versions = TextView(activity).apply {
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        val notes = TextView(activity).apply {
            textSize = 14f
            setLineSpacing(0f, 1.25f)
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        val safe = TextView(activity).apply {
            textSize = 13f
            setLineSpacing(0f, 1.25f)
            text = SAFE_TEXT
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        val progressBlock = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            visibility = View.GONE
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(12)
            layoutParams = lp
        }
        val spinner = ProgressBar(activity).apply {
            isIndeterminate = true
            val lp = LinearLayout.LayoutParams(dp(36), dp(36))
            lp.gravity = Gravity.CENTER_HORIZONTAL
            layoutParams = lp
        }
        val progressText = TextView(activity).apply {
            textSize = 13f
            gravity = Gravity.CENTER
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        val bar = ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
            max = 100
            val lp = LinearLayout.LayoutParams(MATCH, dp(8))
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        progressBlock.addView(spinner)
        progressBlock.addView(progressText)
        progressBlock.addView(bar)
        val error = TextView(activity).apply {
            textSize = 13f
            setTextColor(0xFFE94560.toInt())
            visibility = View.GONE
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        val actions = LinearLayout(activity).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.END
            val lp = LinearLayout.LayoutParams(MATCH, WRAP)
            lp.topMargin = dp(8)
            layoutParams = lp
        }
        val later = TextView(activity).apply {
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            gravity = Gravity.END
            setOnClickListener { later() }
        }
        val site = TextView(activity).apply {
            text = "Télécharger l’APK (site)"
            textSize = 14f
            setTypeface(typeface, Typeface.BOLD)
            setPadding(dp(14), dp(12), dp(14), dp(12))
            gravity = Gravity.END
            setOnClickListener { openSite() }
        }
        val primaryBg = GradientDrawable().apply {
            cornerRadius = dp(10).toFloat()
            setColor(palette.accent)
        }
        val primary = TextView(activity).apply {
            textSize = 14f
            setTextColor(Color.WHITE)
            setTypeface(typeface, Typeface.BOLD)
            background = primaryBg
            setPadding(dp(18), dp(12), dp(18), dp(12))
            gravity = Gravity.CENTER
            val lp = LinearLayout.LayoutParams(WRAP, WRAP)
            lp.topMargin = dp(4)
            lp.gravity = Gravity.END
            layoutParams = lp
            setOnClickListener { startInstall() }
        }
        actions.addView(later)
        actions.addView(site)
        actions.addView(primary)
        column.addView(title)
        column.addView(versions)
        column.addView(notes)
        column.addView(safe)
        column.addView(progressBlock)
        column.addView(error)
        column.addView(actions)
        val lp = FrameLayout.LayoutParams(MATCH, WRAP).apply {
            gravity = Gravity.CENTER
            leftMargin = dp(24)
            rightMargin = dp(24)
        }
        root.addView(column, lp)
        val dialog = Dialog(activity, android.R.style.Theme_Translucent_NoTitleBar).apply {
            setContentView(root)
            setCancelable(true)
            setCanceledOnTouchOutside(false)
            setOnCancelListener { later() }
            window?.setBackgroundDrawable(ColorDrawable(Color.TRANSPARENT))
            window?.setLayout(MATCH, MATCH)
            window?.clearFlags(WindowManager.LayoutParams.FLAG_DIM_BEHIND)
        }
        return UpdateCard(
            dialog, title, versions, notes, safe, cardBg, progressBlock,
            spinner, progressText, bar, error, later, site, primary, primaryBg,
        )
    }

    private fun dismissCard() {
        val ui = card ?: return
        card = null
        runCatching { if (ui.dialog.isShowing) ui.dialog.dismiss() }
    }

    private fun phonePalette(): Palette {
        val night = (activity.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        return if (night) {
            Palette(
                text = Color.parseColor("#f1f5f9"),
                secondary = Color.parseColor("#94a3b8"),
                card = Color.parseColor("#1a1a2e"),
                border = Color.parseColor("#2d2d44"),
                accent = Color.parseColor("#e94560"),
            )
        } else {
            Palette(
                text = Color.parseColor("#1a1a2e"),
                secondary = Color.parseColor("#6b7280"),
                card = Color.parseColor("#ffffff"),
                border = Color.parseColor("#e5e7eb"),
                accent = Color.parseColor("#e94560"),
            )
        }
    }

    private fun probe(file: File): ZipProbe {
        if (!file.isFile || file.length() < 4L) return ZipProbe(false, false, false, false)
        val size = file.length()
        val headLen = minOf(size, 65_536L).toInt()
        val head = ByteArray(headLen)
        file.inputStream().use { it.read(head) }
        val html = looksLikeHtml(head)
        val magic = !html && head.size >= 4 &&
            head[0] == 0x50.toByte() && head[1] == 0x4B.toByte() &&
            head[2] == 0x03.toByte() && head[3] == 0x04.toByte()
        val tailLen = minOf(size, 65_557L).toInt()
        val tail = ByteArray(tailLen)
        file.inputStream().use { input ->
            if (size > tailLen) input.skip(size - tailLen)
            input.read(tail)
        }
        val complete = magic && zipEnd(tail)
        val manifest = magic && (containsAscii(head, "AndroidManifest.xml") || containsAscii(tail, "AndroidManifest.xml"))
        return ZipProbe(magic, complete, manifest, html)
    }

    private fun ZipProbe.reusable(file: File, expectedSha: String?): Boolean {
        if (!zipMagic || !complete || !manifest || html) return false
        if (!file.isFile || file.length() < 1_000_000L) return false
        if (!expectedSha.isNullOrBlank()) {
            return sha256(file).equals(expectedSha, ignoreCase = true)
        }
        return file.length() >= 5_000_000L
    }

    private fun looksLikeHtml(head: ByteArray): Boolean {
        val start = head.dropWhile { it == 0xEF.toByte() || it == 0xBB.toByte() || it == 0xBF.toByte() || it <= 0x20 }
        if (start.isEmpty()) return false
        if (start[0] == '<'.code.toByte()) return true
        val text = head.decodeToString().lowercase()
        return text.contains("<!doctype") || text.contains("<html")
    }

    private fun zipEnd(tail: ByteArray): Boolean {
        if (tail.size < 22) return false
        val min = if (tail.size > 65557) tail.size - 65557 else 0
        var i = tail.size - 22
        while (i >= min) {
            if (tail[i] == 0x50.toByte() && tail[i + 1] == 0x4B.toByte() &&
                tail[i + 2] == 0x05.toByte() && tail[i + 3] == 0x06.toByte()
            ) {
                return true
            }
            i--
        }
        return false
    }

    private fun containsAscii(data: ByteArray, needle: String): Boolean {
        if (needle.isEmpty() || data.size < needle.length) return false
        val units = needle.map { it.code.toByte() }
        val last = data.size - units.size
        for (i in 0..last) {
            var ok = true
            for (j in units.indices) {
                if (data[i + j] != units[j]) {
                    ok = false
                    break
                }
            }
            if (ok) return true
        }
        return false
    }

    private fun cleanupOldCaches() {
        val dir = File(activity.cacheDir, "apk")
        if (!dir.isDirectory) return
        val local = localVersionCode()
        dir.listFiles()?.forEach { file ->
            val match = Regex("""vc(\d+)\.apk$""", RegexOption.IGNORE_CASE).find(file.name)
            val cached = match?.groupValues?.getOrNull(1)?.toLongOrNull() ?: 0L
            if (cached in 1..local) file.delete()
        }
    }

    private fun apkFile(version: String, versionCode: Long): File {
        val safe = version.replace(Regex("[^\\w.\\-]"), "")
        val vc = if (versionCode > 0L) versionCode else 0L
        return File(File(activity.cacheDir, "apk"), "hubera-maps-$safe-vc$vc.apk")
    }

    private fun snoozed(remote: String): Boolean {
        val until = prefs.getLong(SNOOZE_UNTIL, 0L)
        if (until <= System.currentTimeMillis()) return false
        val snoozedVer = prefs.getString(SNOOZE_VERSION, "") ?: ""
        return snoozedVer.isEmpty() || snoozedVer == remote
    }

    private fun hasInstallPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            activity.packageManager.canRequestPackageInstalls()
    }

    private fun fetchFeed(): JSONObject? {
        val ver = java.net.URLEncoder.encode(localVersionName(), Charsets.UTF_8.name())
        val pkg = java.net.URLEncoder.encode(activity.packageName, Charsets.UTF_8.name())
        val q = "clientVersion=$ver&clientVersionCode=${localVersionCode()}&clientPackage=$pkg"
        val urls = arrayOf(
            "https://maps.hubera.cloud/api/version?$q",
            "https://maps.hubera.cloud/updates.json?$q",
            "https://hubera.cloud/updates/maps.json?$q",
        )
        for (u in urls) {
            try {
                val connection = URL(u).openConnection() as HttpURLConnection
                connection.connectTimeout = 6000
                connection.readTimeout = 6000
                connection.setRequestProperty("Accept", "application/json")
                connection.inputStream.bufferedReader().use { reader ->
                    val raw = reader.readText()
                    val t = raw.trimStart().removePrefix("\uFEFF").trimStart()
                    if (!(t.startsWith("{") || t.startsWith("["))) return@use
                    val obj = JSONObject(t)
                    if (obj.optString("version").isNotBlank()) return obj
                }
            } catch (_: Throwable) {
                /* feed suivant */
            }
        }
        return null
    }

    private fun localVersionName(): String {
        return runCatching {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "0"
        }.getOrElse { "0" }
    }

    private fun localVersionCode(): Long {
        return runCatching {
            val info = activity.packageManager.getPackageInfo(activity.packageName, 0)
            if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else @Suppress("DEPRECATION") info.versionCode.toLong()
        }.getOrDefault(0L)
    }

    private fun isNewer(remote: String, local: String): Boolean {
        val a = remote.split('.').map { it.toIntOrNull() ?: 0 }
        val b = local.split('.').map { it.toIntOrNull() ?: 0 }
        val n = maxOf(a.size, b.size)
        for (i in 0 until n) {
            val x = a.getOrElse(i) { 0 }
            val y = b.getOrElse(i) { 0 }
            if (x != y) return x > y
        }
        return false
    }

    private fun userNotes(raw: String, version: String): String {
        val cleaned = raw
            .replace(Regex("\\s*forceUpdate[^.]*\\.?", RegexOption.IGNORE_CASE), "")
            .trim()
        if (cleaned.length < 12) {
            return "Hubera Maps — corrections et améliorations, version $version."
        }
        return cleaned
    }

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = input.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    private fun dp(value: Int): Int = (value * activity.resources.displayMetrics.density).toInt()

    private class Cancelled : RuntimeException()

    private data class Offer(
        val version: String,
        val versionCode: Long,
        val notes: String,
        val apkUrl: String,
        val sha256: String,
    )

    private data class Palette(
        val text: Int,
        val secondary: Int,
        val card: Int,
        val border: Int,
        val accent: Int,
    )

    private data class ZipProbe(
        val zipMagic: Boolean,
        val complete: Boolean,
        val manifest: Boolean,
        val html: Boolean,
    )

    private class UpdateCard(
        val dialog: Dialog,
        val title: TextView,
        val versions: TextView,
        val notes: TextView,
        val safe: TextView,
        val cardBg: GradientDrawable,
        val progressBlock: LinearLayout,
        val spinner: ProgressBar,
        val progressText: TextView,
        val bar: ProgressBar,
        val error: TextView,
        val later: TextView,
        val site: TextView,
        val primary: TextView,
        val primaryBg: GradientDrawable,
    )

    companion object {
        const val INSTALL_URL = "https://maps.hubera.cloud/install"
        private const val PREFS = "hubera_maps_update"
        private const val SNOOZE_UNTIL = "snooze_until"
        private const val SNOOZE_VERSION = "snooze_version"
        private const val PENDING_AFTER_PERM = "pending_after_perm"
        private const val PENDING_FILE = "pending_file"
        private const val PERM_ASKED_AT = "perm_asked_at"
        private const val PERM_ASK_COOLDOWN_MS = 90_000L
        private const val SNOOZE_MS = 6L * 60 * 60 * 1000
        private const val MATCH = ViewGroup.LayoutParams.MATCH_PARENT
        private const val WRAP = ViewGroup.LayoutParams.WRAP_CONTENT
        private const val SAFE_TEXT =
            "Mise à jour en un tap : vos trajets, lieux et connexion sont conservés. " +
                "Le fichier reste dans le cache de l’app (pas Téléchargements) : si vous annulez l’installateur Android, " +
                "« Réessayer » n’aura pas à tout retélécharger. Rappel dans 6 h si vous reportez (répétable)."
    }
}
