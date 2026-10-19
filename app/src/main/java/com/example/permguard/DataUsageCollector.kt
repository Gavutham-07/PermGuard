package com.example.permguard

import android.Manifest
import android.app.usage.NetworkStats
import android.app.usage.NetworkStats.Bucket
import android.app.usage.NetworkStatsManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.RemoteException
import android.util.Log

/**
 * Collects per‑app network data usage (mobile and Wi‑Fi) using the Android `NetworkStatsManager`.
 *
 * The collector respects the actual capabilities of the platform:
 * • Querying **other apps'** usage requires the special `PACKAGE_USAGE_STATS` permission which the user must enable manually in Settings.
 * • Querying **mobile** bytes also requires the dangerous `READ_PHONE_STATE` permission.
 * • On many devices (especially emulators) the OS may not provide mobile statistics, in which case `mobileBytes` is `null`.
 *
 * All failures are caught and reported as `null` – the caller should treat `null` as *unavailable* and never as zero.
 */
object DataUsageCollector {
    private const val TAG = "DataUsageCollector"

    /**
     * Returns a [DataUsageInfo] for the given app **if** the platform permits the query.
     *
     * @param context Android context.
     * @param packageName package name of the target application.
     * @param uid UID of the target application (obtained via PackageManager).
     * @return `null` when the data cannot be retrieved (missing permission, API not supported, etc.).
     */
    fun collect(context: Context, packageName: String, uid: Int): DataUsageInfo? {
        val networkStatsManager = try {
            context.getSystemService(Context.NETWORK_STATS_SERVICE) as NetworkStatsManager
        } catch (e: Exception) {
            Log.w(TAG, "NetworkStatsManager unavailable: ${e.message}")
            return null
        }

        // Time window: last 7 days (consistent with usage stats window).
        val endTime = System.currentTimeMillis()
        val startTime = endTime - (7L * 24 * 60 * 60 * 1000)

        var wifiBytes: Long? = null
        var mobileBytes: Long? = null

        // Query Wi‑Fi first – does not require READ_PHONE_STATE.
        wifiBytes = queryForUid(networkStatsManager, uid, ConnectivityManager.TYPE_WIFI, null, startTime, endTime)

        // Query mobile – may require READ_PHONE_STATE; handle potential SecurityException.
        mobileBytes = try {
            queryForUid(networkStatsManager, uid, ConnectivityManager.TYPE_MOBILE, null, startTime, endTime)
        } catch (se: SecurityException) {
            Log.w(TAG, "Missing READ_PHONE_STATE permission for mobile data usage: ${se.message}")
            null
        }

        // If both are null the whole operation failed – treat as unavailable.
        if (wifiBytes == null && mobileBytes == null) {
            return null
        }
        return DataUsageInfo(mobileBytes = mobileBytes, wifiBytes = wifiBytes)
    }

    private fun queryForUid(
        manager: NetworkStatsManager,
        uid: Int,
        transportType: Int,
        subscriberId: String?,
        start: Long,
        end: Long
    ): Long? {
        var total = 0L
        var bucket: Bucket? = null
        try {
            val iterator = manager.queryDetailsForUid(transportType, subscriberId, start, end, uid)
            bucket = Bucket()
            while (iterator.hasNextBucket()) {
                iterator.getNextBucket(bucket)
                total += bucket.rxBytes + bucket.txBytes
            }
            iterator.close()
            return total
        } catch (e: RemoteException) {
            Log.w(TAG, "RemoteException while querying network stats: ${e.message}")
            return null
        } catch (e: Exception) {
            Log.w(TAG, "Unexpected error querying network stats: ${e.message}")
            return null
        }
    }
}
