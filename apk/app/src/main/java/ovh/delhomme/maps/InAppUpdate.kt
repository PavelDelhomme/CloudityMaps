package ovh.delhomme.maps

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.widget.LinearLayout
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

/**
 * MAJ APK dans Maps : dialogue natif, téléchargement, FileProvider.
 * Jamais de redirect Chrome /install. Après sources inconnues, relance auto.
 */
class InAppUpdate(private val activity: Activity) {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)

    fun check() {
        Thread {
            runCatching { checkInner() }
        }.start()
    }

    private fun checkInner() {
        val local = runCatching {
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "0"
        }.getOrElse { "0" }
        val feed = fetchFeed() ?: return
        val localPkg = activity.packageName
        val slot = sequenceOf(
            feed.optJSONObject("canonical"),
            feed.optJSONObject("legacy"),
        ).firstOrNull { it != null && it.optString("package") == localPkg }
        if (slot != null) {
            val cv = slot.optString("version")
            if (cv.isBlank() || !isNewer(cv, local)) return
            val notes = slot.optString("notes").ifBlank {
                feed.optString("notes").ifBlank { "Nouvelle version Hubera Maps." }
            }
            val apkUrl = slot.optString("apk_url").ifBlank { slot.optString("apk") }
            val sha = slot.optString("sha256")
            if (apkUrl.isBlank()) return
            main.post { showDialog(cv, notes, apkUrl, sha) }
            return
        }
        val remotePkg = feed.optString("package")
        if (remotePkg.isNotBlank() && remotePkg != localPkg) return
        val remote = feed.optString("version")
        if (remote.isBlank() || !isNewer(remote, local)) return
        if (snoozed(remote, local)) return
        val notes = feed.optString("notes").ifBlank { "Nouvelle version Hubera Maps." }
        val apkUrl = feed.optString("apk").ifBlank {
            feed.optString("apk_url").ifBlank { APK_URL }
        }
        val sha = feed.optString("sha256")
        main.post { showDialog(remote, notes, apkUrl, sha) }
    }

    /** Après Settings « sources inconnues » : installer l’APK déjà téléchargée, sans Chrome. */
    fun retryPending() {
        if (!prefs.getBoolean(PENDING_AFTER_PERM, false)) return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            return
        }
        prefs.edit().putBoolean(PENDING_AFTER_PERM, false).apply()
        val dest = File(File(activity.cacheDir, "apk"), "hubera-maps.apk")
        if (dest.isFile && dest.length() > 10_000L) {
            main.post { installApk(dest) }
        } else {
            check()
        }
    }

    private fun snoozed(remote: String, local: String): Boolean {
        if (local in BAD_LOCAL) return false
        val until = prefs.getLong(SNOOZE_UNTIL, 0L)
        if (until <= System.currentTimeMillis()) return false
        val snoozedVer = prefs.getString(SNOOZE_VERSION, "") ?: ""
        if (snoozedVer.isNotEmpty() && snoozedVer != remote) return false
        return true
    }

    private fun showDialog(version: String, notes: String, apkUrl: String, sha: String) {
        if (activity.isFinishing) return
        AlertDialog.Builder(activity)
            .setTitle("Mise à jour $version")
            .setMessage("$notes\n\nVous pouvez continuer sans installer. La mise à jour n’est pas obligatoire.")
            .setCancelable(true)
            .setPositiveButton("Installer") { _, _ ->
                Thread { downloadAndInstall(apkUrl, sha, version, notes) }.start()
            }
            .setNegativeButton("Continuer") { _, _ ->
                prefs.edit()
                    .putLong(SNOOZE_UNTIL, System.currentTimeMillis() + SNOOZE_MS)
                    .putString(SNOOZE_VERSION, version)
                    .apply()
            }
            .setNeutralButton("Site web") { _, _ ->
                prefs.edit()
                    .putLong(SNOOZE_UNTIL, System.currentTimeMillis() + SNOOZE_MS)
                    .putString(SNOOZE_VERSION, version)
                    .apply()
                runCatching {
                    activity.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse(INSTALL_URL)),
                    )
                }
            }
            .show()
    }

    private fun hasInstallPermission(): Boolean {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            activity.packageManager.canRequestPackageInstalls()
    }

    /** Permission « sources inconnues » AVANT le téléchargement. Pas de boucle Settings. */
    private fun ensureInstallPermission(): Boolean {
        if (hasInstallPermission()) return true
        val last = prefs.getLong(PERM_ASKED_AT, 0L)
        if (System.currentTimeMillis() - last < PERM_ASK_COOLDOWN_MS) {
            main.post {
                Toast.makeText(
                    activity,
                    "Autorise l’installation pour Maps dans Réglages, puis réessaie.",
                    Toast.LENGTH_LONG,
                ).show()
            }
            return false
        }
        prefs.edit()
            .putLong(PERM_ASKED_AT, System.currentTimeMillis())
            .putBoolean(PENDING_AFTER_PERM, true)
            .apply()
        runCatching {
            activity.startActivity(
                Intent(
                    Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                    Uri.parse("package:${activity.packageName}"),
                ),
            )
        }
        main.post {
            Toast.makeText(
                activity,
                "Autorise l’installation — Maps télécharge ensuite tout seul.",
                Toast.LENGTH_LONG,
            ).show()
        }
        return false
    }

    private fun downloadAndInstall(
        apkUrl: String,
        expectedSha: String,
        version: String,
        notes: String,
    ) {
        if (!ensureInstallPermission()) return
        val progressDlg = java.util.concurrent.atomic.AtomicReference<AlertDialog?>(null)
        main.post {
            if (activity.isFinishing) return@post
            val density = activity.resources.displayMetrics.density
            val pad = (20 * density).toInt()
            val wrap = LinearLayout(activity).apply {
                orientation = LinearLayout.VERTICAL
                setPadding(pad, pad / 2, pad, pad)
                addView(
                    TextView(activity).apply {
                        text = notes.ifBlank { "Nouveautés de la $version." }
                        textSize = 15f
                    },
                )
                addView(
                    ProgressBar(activity, null, android.R.attr.progressBarStyleHorizontal).apply {
                        isIndeterminate = true
                        val lp = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT,
                        )
                        lp.topMargin = (12 * density).toInt()
                        layoutParams = lp
                    },
                )
            }
            progressDlg.set(
                AlertDialog.Builder(activity)
                    .setTitle("Téléchargement $version")
                    .setView(wrap)
                    .setCancelable(false)
                    .show(),
            )
        }
        val dir = File(activity.cacheDir, "apk").apply { mkdirs() }
        val dest = File(dir, "hubera-maps.apk")
        try {
            if (dest.exists()) dest.delete()
            val conn = URL(apkUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 12_000
            conn.readTimeout = 90_000
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*")
            conn.inputStream.use { ins ->
                dest.outputStream().use { outs -> ins.copyTo(outs) }
            }
            conn.disconnect()
            if (dest.length() < 10_000L) {
                dest.delete()
                main.post {
                    progressDlg.get()?.dismiss()
                    Toast.makeText(activity, "APK invalide (fichier trop petit).", Toast.LENGTH_LONG).show()
                }
                return
            }
            val magic = ByteArray(4)
            var zipOk = false
            dest.inputStream().use { ins ->
                val n = ins.read(magic)
                zipOk = n >= 2 && magic[0] == 0x50.toByte() && magic[1] == 0x4B.toByte()
            }
            if (!zipOk) {
                dest.delete()
                main.post {
                    progressDlg.get()?.dismiss()
                    Toast.makeText(activity, "APK invalide (pas un fichier Android).", Toast.LENGTH_LONG).show()
                }
                return
            }
            if (expectedSha.isNotBlank()) {
                val got = sha256(dest)
                if (!got.equals(expectedSha, ignoreCase = true)) {
                    dest.delete()
                    main.post {
                        progressDlg.get()?.dismiss()
                        Toast.makeText(activity, "APK corrompue (sha256).", Toast.LENGTH_LONG).show()
                    }
                    return
                }
            }
            main.post {
                progressDlg.get()?.dismiss()
                installApk(dest)
            }
        } catch (t: Throwable) {
            dest.delete()
            main.post {
                progressDlg.get()?.dismiss()
                Toast.makeText(
                    activity,
                    "Téléchargement impossible — ouverture du site d’install.",
                    Toast.LENGTH_LONG,
                ).show()
                runCatching {
                    activity.startActivity(
                        Intent(Intent.ACTION_VIEW, Uri.parse(INSTALL_URL)),
                    )
                }
            }
        }
    }

    private fun installApk(file: File) {
        if (!hasInstallPermission()) {
            prefs.edit().putBoolean(PENDING_AFTER_PERM, true).apply()
            if (!ensureInstallPermission()) return
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

    private fun fetchFeed(): JSONObject? {
        val urls = arrayOf(
            "https://maps.hubera.cloud/updates.json",
            "https://hubera.cloud/updates/maps.json",
        )
        for (u in urls) {
            try {
                val conn = URL(u).openConnection() as HttpURLConnection
                conn.connectTimeout = 6000
                conn.readTimeout = 6000
                conn.setRequestProperty("Accept", "application/json")
                conn.inputStream.bufferedReader().use { reader ->
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

    private fun sha256(file: File): String {
        val md = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { ins ->
            val buf = ByteArray(64 * 1024)
            while (true) {
                val n = ins.read(buf)
                if (n <= 0) break
                md.update(buf, 0, n)
            }
        }
        return md.digest().joinToString("") { "%02x".format(it) }
    }

    companion object {
        const val APK_URL = "https://maps.hubera.cloud/apk/hubera-maps.apk"
        const val INSTALL_URL = "https://maps.hubera.cloud/install"
        private const val PREFS = "hubera_maps_update"
        private const val SNOOZE_UNTIL = "snooze_until"
        private const val SNOOZE_VERSION = "snooze_version"
        private const val PENDING_AFTER_PERM = "pending_after_perm"
        private const val PERM_ASKED_AT = "perm_asked_at"
        private const val PERM_ASK_COOLDOWN_MS = 90_000L
        private const val SNOOZE_MS = 6L * 60 * 60 * 1000
        private val BAD_LOCAL = setOf("0.1.36", "0.1.37", "0.1.75")
    }
}
