  package com.capexusagecollector

  import android.app.usage.NetworkStats
  import android.app.usage.NetworkStatsManager
  import android.content.Context
  import android.content.pm.PackageManager
  import android.net.ConnectivityManager
  import com.facebook.react.bridge.Arguments
  import com.facebook.react.bridge.ReactApplicationContext
  import com.facebook.react.bridge.ReactContextBaseJavaModule
  import com.facebook.react.bridge.ReactMethod
  import com.facebook.react.bridge.Promise
  import com.facebook.react.bridge.WritableArray
  import com.facebook.react.bridge.WritableMap

  class NetworkUsageModule(reactContext: ReactApplicationContext) :
      ReactContextBaseJavaModule(reactContext) {

      override fun getName(): String {
          return "NetworkUsageModule"
      }

      @ReactMethod
      fun getUsageStats(startTime: Double, endTime: Double, promise: Promise) {
          try {
              val context = reactApplicationContext
              val networkStatsManager =
                  context.getSystemService(Context.NETWORK_STATS_SERVICE) as NetworkStatsManager
              val packageManager = context.packageManager

              val resultArray: WritableArray = Arguments.createArray()
              val installedApps = packageManager.getInstalledApplications(PackageManager.GET_META_DATA)

              // TYPE_MOBILE -> "data", TYPE_WIFI -> "wifi"
              val networkTypes = mapOf(
                  ConnectivityManager.TYPE_MOBILE to "data",
                  ConnectivityManager.TYPE_WIFI to "wifi"
              )

              for (appInfo in installedApps) {
                  val uid = appInfo.uid

                  for ((networkType, typeLabel) in networkTypes) {
                      try {
                          val stats: NetworkStats = networkStatsManager.querySummary(
                              networkType,
                              null,
                              startTime.toLong(),
                              endTime.toLong()
                          )

                          var rxBytes = 0L
                          var txBytes = 0L
                          val bucket = NetworkStats.Bucket()
                          while (stats.hasNextBucket()) {
                              stats.getNextBucket(bucket)
                              if (bucket.uid == uid) {
                                  rxBytes += bucket.rxBytes
                                  txBytes += bucket.txBytes
                              }
                          }
                          stats.close()

                          if (rxBytes > 0 || txBytes > 0) {
                              val entry: WritableMap = Arguments.createMap()
                              entry.putString("packageName", appInfo.packageName)
                              entry.putInt("uid", uid)
                              entry.putDouble("rxBytes", rxBytes.toDouble())
                              entry.putDouble("txBytes", txBytes.toDouble())
                              entry.putDouble("timestamp", System.currentTimeMillis().toDouble())
                              entry.putString("type", typeLabel)
                              resultArray.pushMap(entry)
                          }
                      } catch (inner: Exception) {
                          android.util.Log.w(
                              "NetworkUsageModule",
                              "querySummary failed type=$typeLabel uid=$uid: ${inner.message}"
                          )
                      }
                  }
              }

              promise.resolve(resultArray)
          } catch (e: Exception) {
              promise.reject("USAGE_STATS_ERROR", e.message, e)
          }
      }

      @ReactMethod
      fun hasUsageAccessPermission(promise: Promise) {
          try {
              val context = reactApplicationContext
              val appOpsManager = context.getSystemService(Context.APP_OPS_SERVICE) as android.app.AppOpsManager
              val mode = appOpsManager.checkOpNoThrow(
                  android.app.AppOpsManager.OPSTR_GET_USAGE_STATS,
                  android.os.Process.myUid(),
                  context.packageName
              )
              promise.resolve(mode == android.app.AppOpsManager.MODE_ALLOWED)
          } catch (e: Exception) {
              promise.reject("PERMISSION_CHECK_ERROR", e.message, e)
          }
      }

      @ReactMethod
      fun openUsageAccessSettings() {
          val intent = android.content.Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS)
          intent.addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)
          reactApplicationContext.startActivity(intent)
      }
  }