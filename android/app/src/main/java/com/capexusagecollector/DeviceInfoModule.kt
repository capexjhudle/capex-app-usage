package com.capexusagecollector

import android.provider.Settings
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.Promise

class DeviceInfoModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName(): String {
        return "DeviceInfoModule"
    }

    /**
     * Kunin ang ANDROID_ID - unique identifier na naka-tali sa
     * device + user profile + signing key ng app (mula Android 8+).
     *
     * - Hindi nagbabago kapag nag-uninstall tapos nag-reinstall ulit
     *   ng parehong app (parehong signing key/keystore).
     * - Nagbabago kapag nag-factory reset ang device.
     * - Nagbabago rin kung magpalit ng signing key (hal. debug -> release
     *   na ibang keystore), kaya siguraduhing consistent ang build config.
     */
    @ReactMethod
    fun getUniqueId(promise: Promise) {
        try {
            val androidId = Settings.Secure.getString(
                reactApplicationContext.contentResolver,
                Settings.Secure.ANDROID_ID
            )

            if (androidId.isNullOrEmpty()) {
                promise.reject("DEVICE_ID_ERROR", "Hindi makuha ang ANDROID_ID")
                return
            }

            promise.resolve(androidId)
        } catch (e: Exception) {
            promise.reject("DEVICE_ID_ERROR", e.message, e)
        }
    }
}