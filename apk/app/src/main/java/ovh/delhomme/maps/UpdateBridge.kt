package ovh.delhomme.maps

import android.app.Activity
import android.webkit.JavascriptInterface

class UpdateBridge(private val activity: Activity) {
    @JavascriptInterface
    fun check() {
        InAppUpdate(activity).check()
    }

    @JavascriptInterface
    fun version(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun versionCode(): Int = BuildConfig.VERSION_CODE
}
