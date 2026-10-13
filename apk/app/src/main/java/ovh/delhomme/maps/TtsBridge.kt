package ovh.delhomme.maps

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import android.webkit.JavascriptInterface
import java.util.Locale

/**
 * Annonces de manœuvre type Google Maps (TTS système, pas speechSynthesis WebView).
 * Recrée le moteur au retour au premier plan : Android le coupe souvent en arrière-plan.
 */
class TtsBridge(context: Context) {
    private val appCtx = context.applicationContext
    private val main = Handler(Looper.getMainLooper())
    private var engine: TextToSpeech? = null
    private var focusReq: AudioFocusRequest? = null
    @Volatile
    private var ready = false
    @Volatile
    private var muted = false
    @Volatile
    private var pending: String? = null
    @Volatile
    private var booting = false

    init {
        boot()
    }

    private fun boot() {
        if (booting) return
        booting = true
        ready = false
        runCatching {
            engine?.stop()
            engine?.shutdown()
        }
        engine = runCatching {
            TextToSpeech(appCtx) { status ->
                ready = status == TextToSpeech.SUCCESS
                booting = false
                if (ready) {
                    runCatching { engine?.language = Locale.FRANCE }
                    runCatching {
                        engine?.setAudioAttributes(
                            AudioAttributes.Builder()
                                .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                                .build(),
                        )
                    }
                    engine?.setOnUtteranceProgressListener(
                        object : UtteranceProgressListener() {
                            override fun onStart(utteranceId: String?) = Unit
                            override fun onDone(utteranceId: String?) = Unit
                            @Deprecated("Deprecated in Java")
                            override fun onError(utteranceId: String?) {
                                main.post { boot() }
                            }
                        },
                    )
                    pending?.let { speakInternal(it) }
                } else {
                    main.postDelayed({ boot() }, 900)
                }
            }
        }.getOrNull()
        if (engine == null) booting = false
    }

    fun ensureReady() {
        main.post {
            if (engine == null || !ready) boot()
        }
    }

    @JavascriptInterface
    fun speak(text: String) {
        if (muted || text.isBlank()) return
        main.post { speakInternal(text) }
    }

    private fun speakInternal(text: String) {
        if (muted || text.isBlank()) return
        if (!ready || engine == null) {
            pending = text
            if (engine == null) boot()
            return
        }
        pending = null
        duckMusic()
        val r = engine?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "hubera-maps-nav")
        if (r == TextToSpeech.ERROR) {
            pending = text
            boot()
        }
    }

    private fun duckMusic() {
        val am = appCtx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        runCatching {
            if (Build.VERSION.SDK_INT >= 26) {
                val req = AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                            .build(),
                    )
                    .build()
                focusReq = req
                am.requestAudioFocus(req)
            } else {
                @Suppress("DEPRECATION")
                am.requestAudioFocus(
                    null,
                    AudioManager.STREAM_MUSIC,
                    AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK,
                )
            }
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
        val am = appCtx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager
        if (Build.VERSION.SDK_INT >= 26) {
            focusReq?.let { req -> runCatching { am?.abandonAudioFocusRequest(req) } }
        }
    }
}
