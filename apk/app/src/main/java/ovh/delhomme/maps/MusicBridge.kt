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
 * Media3 session exportée par PlaybackService ; repli touches média système.
 * MediaController n'accepte que le thread principal — l'état est mis en cache pour JS.
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

    fun connect() {
        if (controller != null || connecting) return
        connecting = true
        try {
            val token = SessionToken(
                context,
                ComponentName(MUSIC_PKG, MUSIC_SERVICE),
            )
            val future = MediaController.Builder(context, token).buildAsync()
            future.addListener(
                {
                    connecting = false
                    runCatching {
                        val c = future.get()
                        controller = c
                        c.addListener(object : Player.Listener {
                            override fun onEvents(player: Player, events: Player.Events) {
                                refreshCache()
                                pushToWeb()
                            }
                        })
                        refreshCache()
                        pushToWeb()
                    }
                },
                { r -> main.post(r) },
            )
        } catch (_: Throwable) {
            connecting = false
        }
    }

    fun release() {
        controller?.release()
        controller = null
    }

    @JavascriptInterface
    fun playPause() {
        main.post {
            connect()
            val c = controller
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
            connect()
            val c = controller
            if (c != null) c.seekToNextMediaItem() else sendKey(KeyEvent.KEYCODE_MEDIA_NEXT)
            main.postDelayed({
                refreshCache()
                pushToWeb()
            }, 250)
        }
    }

    @JavascriptInterface
    fun prev() {
        main.post {
            connect()
            val c = controller
            if (c != null) c.seekToPreviousMediaItem() else sendKey(KeyEvent.KEYCODE_MEDIA_PREVIOUS)
            main.postDelayed({
                refreshCache()
                pushToWeb()
            }, 250)
        }
    }

    @JavascriptInterface
    fun openApp() {
        main.post {
            val launch = context.packageManager.getLaunchIntentForPackage(MUSIC_PKG)
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
        val c = controller
        val meta = c?.mediaMetadata
        val title = meta?.title?.toString()?.trim().orEmpty()
        val artist = meta?.artist?.toString()?.trim().orEmpty()
        val playing = c?.isPlaying == true ||
            (c == null && (context.getSystemService(Context.AUDIO_SERVICE) as AudioManager).isMusicActive)
        return JSONObject()
            .put("connected", c != null)
            .put("playing", playing)
            .put("title", if (title.isNotEmpty()) title else "Hubera Music")
            .put("artist", artist)
            .put("hasQueue", (c?.mediaItemCount ?: 0) > 0)
    }

    private fun defaultState(): JSONObject = JSONObject()
        .put("connected", false)
        .put("playing", false)
        .put("title", "Hubera Music")
        .put("artist", "Lecture depuis Maps")
        .put("hasQueue", false)

    private fun sendKey(code: Int) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_DOWN, code))
        am.dispatchMediaKeyEvent(KeyEvent(KeyEvent.ACTION_UP, code))
    }

    companion object {
        const val MUSIC_PKG = "ovh.delhomme.ytmusic"
        const val MUSIC_SERVICE = "ovh.delhomme.ytmusic.player.PlaybackService"
    }
}
