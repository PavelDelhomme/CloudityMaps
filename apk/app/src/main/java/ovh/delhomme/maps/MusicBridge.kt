package ovh.delhomme.maps

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import org.json.JSONObject

/**
 * Commande Hubera Music depuis Maps (comme YouTube Music dans Google Maps).
 * Media3 session ; poll 4 s pour le dock (batterie). Next/prev : session + touche média.
 */
class MusicBridge(
    private val context: Context,
    private val web: () -> WebView?,
) {
    private val main = Handler(Looper.getMainLooper())
    private var controller: MediaController? = null
    private var connecting = false
    @Volatile
    private var cachedState: String = defaultState().toString()
    private var connectTries = 0
    private var watching = false
    private val tick = object : Runnable {
        override fun run() {
            if (!watching) return
            if (liveController() == null) connect()
            else {
                refreshCache()
                pushToWeb()
            }
            main.postDelayed(this, 4000)
        }
    }

    private fun liveController(): MediaController? {
        val c = controller ?: return null
        if (c.isConnected) return c
        runCatching { c.release() }
        controller = null
        connecting = false
        return null
    }

    private fun musicPkgsInstalled(): List<String> {
        val installed = MUSIC_PKGS.filter { pkg ->
            context.packageManager.getLaunchIntentForPackage(pkg) != null
        }
        return installed.ifEmpty { MUSIC_PKGS }
    }

    fun connect() {
        if (controller != null || connecting) return
        connecting = true
        tryConnect(musicPkgsInstalled(), 0)
    }

    private fun tryConnect(pkgs: List<String>, index: Int) {
        if (index >= pkgs.size) {
            connecting = false
            scheduleReconnect()
            return
        }
        val pkg = pkgs[index]
        try {
            val token = SessionToken(
                context,
                ComponentName(pkg, MUSIC_SERVICE),
            )
            val future = MediaController.Builder(context, token).buildAsync()
            future.addListener(
                {
                    val ok = runCatching {
                        val c = future.get()
                        controller = c
                        connectTries = 0
                        c.addListener(object : Player.Listener {
                            override fun onEvents(player: Player, events: Player.Events) {
                                refreshCache()
                                pushToWeb()
                            }
                        })
                        refreshCache()
                        pushToWeb()
                    }.isSuccess
                    if (!ok) {
                        controller = null
                        tryConnect(pkgs, index + 1)
                    } else {
                        connecting = false
                    }
                },
                { r -> main.post(r) },
            )
        } catch (_: Throwable) {
            tryConnect(pkgs, index + 1)
        }
    }

    fun startWatch() {
        if (watching) return
        watching = true
        connect()
        main.removeCallbacks(tick)
        main.post(tick)
    }

    fun stopWatch() {
        watching = false
        main.removeCallbacks(tick)
    }

    private fun scheduleReconnect() {
        if (connectTries > 40) connectTries = 0
        connectTries += 1
        main.postDelayed({
            connecting = false
            if (controller == null) connect()
        }, 1500)
    }

    fun release() {
        stopWatch()
        controller?.release()
        controller = null
    }

    @JavascriptInterface
    fun playPause() {
        main.post {
            liveController()
            connect()
            val c = liveController()
            if (c != null) {
                if (c.isPlaying) c.pause() else c.play()
            } else {
                sendKey(KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE)
            }
            main.postDelayed({
                refreshCache()
                pushToWeb()
            }, 250)
        }
    }

    @JavascriptInterface
    fun next() {
        main.post {
            liveController()
            connect()
            val c = liveController()
            if (c != null) {
                runCatching { c.seekToNextMediaItem() }
            }
            // Debounce côté Music (220 ms) : si le MediaController ne skip pas la file.
            sendKey(KeyEvent.KEYCODE_MEDIA_NEXT)
            main.postDelayed({
                refreshCache()
                pushToWeb()
            }, 400)
        }
    }

    @JavascriptInterface
    fun prev() {
        main.post {
            liveController()
            connect()
            val c = liveController()
            if (c != null) {
                runCatching { c.seekToPreviousMediaItem() }
            }
            sendKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            main.postDelayed({
                refreshCache()
                pushToWeb()
            }, 400)
        }
    }

    @JavascriptInterface
    fun openApp() {
        main.post {
            val pkg = MUSIC_PKGS.firstOrNull { p ->
                context.packageManager.getLaunchIntentForPackage(p) != null
            }
            val launch = pkg?.let { context.packageManager.getLaunchIntentForPackage(it) }
            if (launch != null) {
                launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(launch)
            } else {
                context.startActivity(
                    Intent(Intent.ACTION_VIEW).setData(android.net.Uri.parse("https://music.hubera.cloud/")),
                )
            }
        }
    }

    @JavascriptInterface
    fun stateJson(): String = cachedState

    fun pushToWeb() {
        val payload = cachedState
        web()?.post {
            web()?.evaluateJavascript(
                "window.__huberaMusicState && window.__huberaMusicState($payload)",
                null,
            )
        }
    }

    private fun refreshCache() {
        cachedState = stateObject().toString()
    }

    private fun stateObject(): JSONObject {
        val c = liveController()
        val meta = c?.mediaMetadata
        val title = meta?.title?.toString()?.trim().orEmpty()
        val artist = meta?.artist?.toString()?.trim().orEmpty()
        val playing = (c != null && (c.isPlaying || c.playWhenReady)) ||
            (c == null && (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).isMusicActive)
        val empty = title.isEmpty()
        return JSONObject()
            .put("connected", c != null)
            .put("playing", playing)
            .put("title", if (empty) "" else title)
            .put("artist", if (empty) "" else artist)
            .put("hasQueue", (c?.mediaItemCount ?: 0) > 0)
            .put("buffering", c?.playbackState == Player.STATE_BUFFERING)
    }

    private fun defaultState(): JSONObject = JSONObject()
        .put("connected", false)
        .put("playing", false)
        .put("title", "")
        .put("artist", "")
        .put("hasQueue", false)
        .put("buffering", false)

    private fun sendKey(code: Int) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }

    companion object {
        const val MUSIC_PKG = "cloud.hubera.music"
        const val MUSIC_PKG_LEGACY = "ovh.delhomme.ytmusic"
        val MUSIC_PKGS = listOf(MUSIC_PKG_LEGACY, MUSIC_PKG)
        const val MUSIC_SERVICE = "ovh.delhomme.ytmusic.player.PlaybackService"
    }
}
