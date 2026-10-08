package ovh.delhomme.maps

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import java.util.Locale

/**
 * Annonces de manœuvre type Google Maps (TTS système, pas speechSynthesis WebView).
 */
class TtsBridge(context: Context) {
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    @Volatile
    private var ready = false
    @Volatile
    private var muted = false

    init {
        engine = runCatching {
            TextToSpeech(context.applicationContext) { status ->
                ready = status == TextToSpeech.SUCCESS
                if (ready) {
                    runCatching { engine?.language = Locale.FRANCE }
                }
            }
        }.getOrNull()
    }

    @JavascriptInterface
    fun speak(text: String) {
        if (muted || text.isBlank()) return
        main.post {
            if (!ready) return@post
            engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "hubera-maps-nav")
        }
    }

    @JavascriptInterface
    fun stop() {
        main.post { engine?.stop() }
    }

    @JavascriptInterface
    fun setMuted(value: Boolean) {
        muted = value
        if (value) main.post { engine?.stop() }
    }

    fun release() {
        ready = false
        engine?.stop()
        engine?.shutdown()
        engine = null
    }
}
