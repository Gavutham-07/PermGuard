package com.example.permguard

import android.Manifest
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Process
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Unified scanner for sensitive permissions and application usage statistics.
 * Centralizes risk calculation, eliminates code duplication between MainActivity
 * and PermissionCheckWorker, and provides thread-safe concurrency control.
 */
object PermissionScanner {

    private val isScanInProgress = AtomicBoolean(false)

    val sensitivePermissions = listOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.READ_CONTACTS
    )

    fun isScanning(): Boolean = isScanInProgress.get()

    /**
     * Checks whether the user has explicitly granted Usage Access permission
     * via Settings -> Usage Access.
     */
    fun isUsageAccessGranted(context: Context): Boolean {
        val appOps = context.getSystemService(Context.APP_OPS_SERVICE) as? AppOpsManager ?: return false
        val mode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            appOps.unsafeCheckOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        } else {
            @Suppress("DEPRECATION")
            appOps.checkOpNoThrow(
                AppOpsManager.OPSTR_GET_USAGE_STATS,
                Process.myUid(),
                context.packageName
            )
        }
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /**
     * Preserved original HIGH / MEDIUM / LOW rule-based risk evaluation.
     *
     * - HIGH: >= 2 sensitive permissions AND < 5 minutes foreground usage in 7 days.
     * - MEDIUM: >= 1 sensitive permission AND < 15 minutes foreground usage in 7 days.
     * - LOW: All other cases.
     *
     * This score is kept separately from the CombinedRiskResult score.
     */
    fun calculateRisk(grantedCount: Int, foregroundMinutes: Long): String {
        return when {
            grantedCount >= 2 && foregroundMinutes < 5 -> "HIGH"
            grantedCount >= 1 && foregroundMinutes < 15 -> "MEDIUM"
            else -> "LOW"
        }
    }

    data class ScanResult(
        val riskList: List<AppRisk>,
        val formattedScanTime: String,
        val scanReason: String,
        val usageAccessGranted: Boolean
    )

    /**
     * Performs a full scan of installed applications, queries usage stats,
     * calculates risk scores, integrates data usage and network findings,
     * and updates the local SQLite database.
     *
     * Returns null if a scan is already running (duplicate scan prevention).
     */
    fun performScan(context: Context, scanReason: String = "Manual"): ScanResult? {
        if (!isScanInProgress.compareAndSet(false, true)) {
            return null
        }

        try {
            val pm = context.packageManager
            val usageStatsManager = context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
            val usageGranted = isUsageAccessGranted(context)

            val endTime = System.currentTimeMillis()
            val startTime = endTime - (7L * 24 * 60 * 60 * 1000)

            val foregroundTimeMap = if (usageGranted) {
                val usageStatsList = usageStatsManager.queryUsageStats(
                    UsageStatsManager.INTERVAL_BEST, startTime, endTime
                ) ?: emptyList()
                usageStatsList
                    .groupBy { it.packageName }
                    .mapValues { (_, list) -> list.sumOf { it.totalTimeInForeground } }
            } else {
                emptyMap()
            }

            val lastUsedMap = mutableMapOf<String, Long>()
            if (usageGranted) {
                val events = usageStatsManager.queryEvents(startTime, endTime)
                val event = UsageEvents.Event()
                while (events != null && events.hasNextEvent()) {
                    events.getNextEvent(event)
                    if (event.eventType == UsageEvents.Event.MOVE_TO_FOREGROUND ||
                        event.eventType == UsageEvents.Event.ACTIVITY_RESUMED
                    ) {
                        val current = lastUsedMap[event.packageName] ?: 0L
                        if (event.timeStamp > current) {
                            lastUsedMap[event.packageName] = event.timeStamp
                        }
                    }
                }
            }

            val usageMap = (foregroundTimeMap.keys + lastUsedMap.keys).associateWith { pkg ->
                Pair(lastUsedMap[pkg] ?: 0L, foregroundTimeMap[pkg] ?: 0L)
            }

            val installedApps = pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
                .filter { pm.getLaunchIntentForPackage(it.packageName) != null }

            // Load existing Burp findings for per-app scoring
            val dbHelper = DatabaseHelper(context)
            val allFindings = dbHelper.loadAllFindings()

            val riskList = mutableListOf<AppRisk>()
            val dateFormat = SimpleDateFormat("dd MMM, hh:mm a", Locale.getDefault())

            for (appInfo in installedApps) {
                val grantedPermissions = appInfo.requestedPermissions?.filterIndexed { index, perm ->
                    perm in sensitivePermissions &&
                            (appInfo.requestedPermissionsFlags?.get(index)?.and(
                                android.content.pm.PackageInfo.REQUESTED_PERMISSION_GRANTED
                            ) != 0)
                } ?: emptyList()

                if (grantedPermissions.isNotEmpty()) {
                    val appName = pm.getApplicationLabel(appInfo.applicationInfo!!).toString()
                    val stats = usageMap[appInfo.packageName]
                    val foregroundTimeMs = stats?.second ?: 0L
                    val foregroundMinutes = foregroundTimeMs / 60000
                    val lastUsedTime = if (stats != null && stats.first > 0) {
                        dateFormat.format(Date(stats.first))
                    } else if (!usageGranted) {
                        "Usage access missing"
                    } else {
                        "Never used"
                    }

                    val isSystem = (appInfo.applicationInfo!!.flags and
                            ApplicationInfo.FLAG_SYSTEM) != 0

                    val risk = calculateRisk(grantedPermissions.size, foregroundMinutes)

                    // Collect data usage (best-effort; null = unavailable, not zero)
                    val uid = appInfo.applicationInfo!!.uid
                    val dataUsage = DataUsageCollector.collect(context, appInfo.packageName, uid)

                    // Find any Burp findings attributed to this package
                    val packageFindings = allFindings
                        .filter { it.attributedPackage == appInfo.packageName }
                        .map { NetworkFinding(it.severity) }

                    // Compute combined risk score
                    val combinedResult = RiskEngine.computeCombinedRisk(
                        appRisk = AppRisk(
                            appName = appName,
                            packageName = appInfo.packageName,
                            permissions = grantedPermissions.map { it.substringAfterLast(".") },
                            foregroundMinutes = foregroundMinutes,
                            riskLevel = risk,
                            isSystemApp = isSystem,
                            lastUsedTime = lastUsedTime
                        ),
                        usageAccessGranted = usageGranted,
                        dataUsage = dataUsage,
                        networkFindings = packageFindings
                    )

                    riskList.add(
                        AppRisk(
                            appName = appName,
                            packageName = appInfo.packageName,
                            permissions = grantedPermissions.map { it.substringAfterLast(".") },
                            foregroundMinutes = foregroundMinutes,
                            riskLevel = risk,
                            isSystemApp = isSystem,
                            lastUsedTime = lastUsedTime,
                            dataUsage = dataUsage,
                            permissionScore = combinedResult.totalScore, // reuse field for permission evidence
                            combinedScore = combinedResult.totalScore,
                            scoreExplanations = combinedResult.explanations,
                            networkFindingsCount = packageFindings.size
                        )
                    )
                }
            }

            riskList.sortWith(
                compareBy<AppRisk> { it.isSystemApp }
                    .thenByDescending {
                        when (it.riskLevel) {
                            "HIGH" -> 2
                            "MEDIUM" -> 1
                            else -> 0
                        }
                    }
            )

            val now = SimpleDateFormat("dd MMM yyyy, hh:mm a", Locale.getDefault()).format(Date())
            val formattedScanTime = "$now ($scanReason)"
            dbHelper.saveScanResults(riskList, formattedScanTime)

            return ScanResult(
                riskList = riskList,
                formattedScanTime = formattedScanTime,
                scanReason = scanReason,
                usageAccessGranted = usageGranted
            )
        } finally {
            isScanInProgress.set(false)
        }
    }
}
