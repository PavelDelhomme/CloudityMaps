package ovh.delhomme.maps

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.provider.Settings
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
 * Jamais de redirect Chrome /install.
 */
class InAppUpdate(private val activity: Activity) {
    private val main = Handler(Looper.getMainLooper())
    private val prefs = activity.getSharedPreferences(PREFS, Activity.MODE_PRIVATE)

    fun check() {
        Thread {
            if (snoozed()) return@Thread
            val local = runCatching {
                activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "0"
            }.getOrElse { "0" }
            val feed = fetchFeed() ?: return@Thread
            val remote = feed.optString("version")
            if (remote.isBlank() || !isNewer(remote, local)) return@Thread
            val notes = feed.optString("notes").ifBlank { "Nouvelle version Hubera Maps." }
            val apkUrl = feed.optString("apk").ifBlank {
                feed.optString("apk_url").ifBlank { APK_URL }
            }
            val sha = feed.optString("sha256")
            main.post { showDialog(remote, notes, apkUrl, sha) }
        }.start()
    }

    private fun snoozed(): Boolean {
        val until = prefs.getLong(SNOOZE_UNTIL, 0L)
        return until > System.currentTimeMillis()
    }

    private fun showDialog(version: String, notes: String, apkUrl: String, sha: String) {
        if (activity.isFinishing) return
        AlertDialog.Builder(activity)
            .setTitle("Mise à jour $version")
            .setMessage(notes)
            .setCancelable(true)
            .setPositiveButton("Installer") { _, _ ->
                Thread { downloadAndInstall(apkUrl, sha, version) }.start()
            }
            .setNegativeButton("Plus tard") { _, _ ->
                prefs.edit().putLong(SNOOZE_UNTIL, System.currentTimeMillis() + SNOOZE_MS).apply()
            }
            .show()
    }

    private fun downloadAndInstall(apkUrl: String, expectedSha: String, version: String) {
        main.post {
            Toast.makeText(activity, "Téléchargement de Maps $version…", Toast.LENGTH_SHORT).show()
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
            if (expectedSha.isNotBlank()) {
                val got = sha256(dest)
                if (!got.equals(expectedSha, ignoreCase = true)) {
                    dest.delete()
                    main.post {
                        Toast.makeText(activity, "APK corrompue (sha256).", Toast.LENGTH_LONG).show()
                    }
                    return
                }
            }
            main.post { installApk(dest) }
        } catch (t: Throwable) {
            dest.delete()
            main.post {
                Toast.makeText(activity, "Téléchargement impossible.", Toast.LENGTH_LONG).show()
            }
        }
    }

    private fun installApk(file: File) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O &&
            !activity.packageManager.canRequestPackageInstalls()
        ) {
            runCatching {
                activity.startActivity(
                    Intent(
                        Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                        Uri.parse("package:${activity.packageName}"),
                    ),
                )
            }
            Toast.makeText(
                activity,
                "Autorisez l’installation, puis rouvrez Maps.",
                Toast.LENGTH_LONG,
            ).show()
            return
        }
        val uri = FileProvider.getUriForFile(
            activity,
            "${activity.packageName}.fileprovider",
            file,
        )
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        runCatching { activity.startActivity(intent) }
            .onFailure {
                Toast.makeText(activity, "Installation impossible.", Toast.LENGTH_LONG).show()
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
                    val obj = JSONObject(reader.readText())
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
        private const val PREFS = "hubera_maps_update"
        private const val SNOOZE_UNTIL = "snooze_until"
        private const val SNOOZE_MS = 24L * 60 * 60 * 1000
    }
}
