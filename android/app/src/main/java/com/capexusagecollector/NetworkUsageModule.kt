  package com.capexusagecollector

  import android.app.usage.NetworkStats
  import android.app.usage.NetworkStatsManager
  import android.content.Context
  import android.content.pm.PackageInfo
  import android.content.pm.PackageManager
  import android.net.ConnectivityManager
  import android.os.Build
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

              // getInstalledPackages (imbes na getInstalledApplications) para
              // kasama na ang versionName/versionCode ng bawat app.
              val installedPackages = packageManager.getInstalledPackages(0)

              // Mapa ng uid -> PackageInfo, para hindi na natin kailangang mag-loop
              // ulit sa installedPackages kada network type
              val uidToPackage = mutableMapOf<Int, PackageInfo>()
              for (pkg in installedPackages) {
                  val appInfo = pkg.applicationInfo ?: continue
                  uidToPackage[appInfo.uid] = pkg
              }

              // TYPE_MOBILE -> "data", TYPE_WIFI -> "wifi"
              val networkTypes = mapOf(
                  ConnectivityManager.TYPE_MOBILE to "data",
                  ConnectivityManager.TYPE_WIFI to "wifi"
              )

              // Ang query ay ONCE lang per network type (hindi na per-app)
              for ((networkType, typeLabel) in networkTypes) {
                  try {
                      val stats: NetworkStats = networkStatsManager.querySummary(
                          networkType,
                          null,
                          startTime.toLong(),
                          endTime.toLong()
                      )

                      // Mag-accumulate muna tayo ng totals per uid
                      val usageByUid = mutableMapOf<Int, Pair<Long, Long>>() // uid -> (rxBytes, txBytes)
                      val bucket = NetworkStats.Bucket()

                      while (stats.hasNextBucket()) {
                          stats.getNextBucket(bucket)
                          val existing = usageByUid[bucket.uid] ?: (0L to 0L)
                          usageByUid[bucket.uid] = (existing.first + bucket.rxBytes) to (existing.second + bucket.txBytes)
                      }
                      stats.close()

                      // Ngayon, i-match natin sa mga installed apps
                      for ((uid, totals) in usageByUid) {
                          val (rxBytes, txBytes) = totals
                          val pkg = uidToPackage[uid] ?: continue // skip kung walang katugmang app
                          val packageName = pkg.packageName

                          if (rxBytes > 0 || txBytes > 0) {
                              val entry: WritableMap = Arguments.createMap()
                              entry.putString("packageName", packageName)
                              entry.putString("versionName", pkg.versionName ?: "")
                              entry.putDouble("versionCode", versionCodeOf(pkg).toDouble())
                              entry.putInt("uid", uid)
                              entry.putDouble("rxBytes", rxBytes.toDouble())
                              entry.putDouble("txBytes", txBytes.toDouble())
                              entry.putDouble("timestamp", System.currentTimeMillis().toDouble())
                              entry.putString("type", typeLabel)
                              resultArray.pushMap(entry)
                          }
                      }
                  } catch (inner: Exception) {
                      android.util.Log.w(
                          "NetworkUsageModule",
                          "querySummary failed type=$typeLabel: ${inner.message}"
                      )
                  }
              }

              promise.resolve(resultArray)
          } catch (e: Exception) {
              promise.reject("USAGE_STATS_ERROR", e.message, e)
          }
      }

      /**
       * versionCode na compatible sa luma at bagong Android
       * (longVersionCode simula API 28).
       */
      private fun versionCodeOf(pkg: PackageInfo): Long {
          return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
              pkg.longVersionCode
          } else {
              @Suppress("DEPRECATION")
              pkg.versionCode.toLong()
          }
      }

      /**
       * Kunin ang version ng isang partikular na naka-install na app,
       * hal. "com.cis3mobileapp.app".
       *
       * Nire-resolve nito kahit hindi pa nag-uusage ang app, at nagbabalik
       * ng { installed: false } kung wala talaga sa device (o hindi nakikita
       * dahil sa package visibility ng Android 11+).
       */
      @ReactMethod
      fun getAppVersion(packageName: String, promise: Promise) {
          try {
              val packageManager = reactApplicationContext.packageManager
              val pkg = packageManager.getPackageInfo(packageName, 0)
              val appInfo = pkg.applicationInfo

              val result: WritableMap = Arguments.createMap()
              result.putBoolean("installed", true)
              result.putString("packageName", pkg.packageName)
              result.putString("versionName", pkg.versionName ?: "")
              result.putDouble("versionCode", versionCodeOf(pkg).toDouble())
              result.putString(
                  "appName",
                  if (appInfo != null) {
                      packageManager.getApplicationLabel(appInfo).toString()
                  } else {
                      packageName
                  }
              )
              promise.resolve(result)
          } catch (e: PackageManager.NameNotFoundException) {
              val result: WritableMap = Arguments.createMap()
              result.putBoolean("installed", false)
              result.putString("packageName", packageName)
              promise.resolve(result)
          } catch (e: Exception) {
              promise.reject("APP_VERSION_ERROR", e.message, e)
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