package com.example.permguard

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.os.Build
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.text.SimpleDateFormat
import java.util.*

class PermissionCheckWorker(context: Context, params: WorkerParameters) :
    Worker(context, params) {

    private val sensitivePermissions = listOf(
        android.Manifest.permission.CAMERA,
        android.Manifest.permission.RECORD_AUDIO,
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
        android.Manifest.permission.READ_CONTACTS
    )

    // Minimum gap before re-notifying about the SAME app again
    private val RENOTIFY_INTERVAL_MS = 24L * 60 * 60 * 1000

    override fun doWork(): Result {
        val context = applicationContext
        val pm = context.packageManager
        val usageStatsManager =
            context.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager

        val dbHelper = DatabaseHelper(context)
        val previousHighRiskPackages = dbHelper.getPreviousHighRiskPackages()

        val prefs: SharedPreferences =
            context.getSharedPreferences("permguard_notify_prefs", Context.MODE_PRIVATE)

        val endTime = System.currentTimeMillis()
        val startTime = endTime - (7L * 24 * 60 * 60 * 1000)

        val usageStatsList = usageStatsManager.queryUsageStats(
            UsageStatsManager.INTERVAL_BEST, startTime, endTime
        )
        val foregroundTimeMap = usageStatsList
            .groupBy { it.packageName }
            .mapValues { (_, list) -> list.sumOf { it.totalTimeInForeground } }

        val lastUsedMap = mutableMapOf<String, Long>()
        val events = usageStatsManager.queryEvents(startTime, endTime)
        val event = UsageEvents.Event()
        while (events.hasNextEvent()) {
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

        val usageMap = (foregroundTimeMap.keys + lastUsedMap.keys).associateWith { pkg ->
            Pair(lastUsedMap[pkg] ?: 0L, foregroundTimeMap[pkg] ?: 0L)
        }

        val installedApps = pm.getInstalledPackages(PackageManager.GET_PERMISSIONS)
            .filter { pm.getLaunchIntentForPackage(it.packageName) != null }

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
                } else {
                    "Never used"
                }

                val isSystem = (appInfo.applicationInfo!!.flags and
                        ApplicationInfo.FLAG_SYSTEM) != 0

                val risk = when {
                    grantedPermissions.size >= 2 && foregroundMinutes < 5 -> "HIGH"
                    grantedPermissions.size >= 1 && foregroundMinutes < 15 -> "MEDIUM"
                    else -> "LOW"
                }

                riskList.add(
                    AppRisk(
                        appName = appName,
                        packageName = appInfo.packageName,
                        permissions = grantedPermissions.map { it.substringAfterLast(".") },
                        foregroundMinutes = foregroundMinutes,
                        riskLevel = risk,
                        isSystemApp = isSystem,
                        lastUsedTime = lastUsedTime
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
        dbHelper.saveScanResults(riskList, now)

        // Now includes HIGH and MEDIUM in the notification pipeline.
        // Dedup is based ONLY on the SharedPreferences "last notified" timestamp,
        // not on previousHighRiskPackages (which only tracks HIGH apps in the DB
        // and was causing MEDIUM apps to look "newly flagged" on every scan).
        val notifiableApps = riskList.filter { it.riskLevel == "HIGH" || it.riskLevel == "MEDIUM" }

        val appsToNotify = notifiableApps.filter { app ->
            val lastNotified = prefs.getLong("last_notified_${app.packageName}", 0L)
            // Never notified before (0L) OR enough time has passed since the last alert
            lastNotified == 0L || (endTime - lastNotified) >= RENOTIFY_INTERVAL_MS
        }

        if (appsToNotify.isNotEmpty()) {
            val editor = prefs.edit()
            appsToNotify.forEachIndexed { index, app ->
                sendAlertNotification(context, app, notificationId = 2000 + index)
                editor.putLong("last_notified_${app.packageName}", endTime)
            }
            editor.apply()
        }

        return Result.success()
    }

    private fun sendAlertNotification(context: Context, app: AppRisk, notificationId: Int) {
        val channelId = "permguard_alerts"
        val notificationManager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val soundUri = Settings.System.DEFAULT_NOTIFICATION_URI
            val audioAttributes = AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_NOTIFICATION)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build()

            val channel = NotificationChannel(
                channelId,
                "Permission Abuse Alerts",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "Alerts for apps silently misusing sensitive permissions"
                enableVibration(true)
                vibrationPattern = longArrayOf(0, 300, 200, 300)
                setSound(soundUri, audioAttributes)
            }
            notificationManager.createNotificationChannel(channel)
        }

        val intent = Intent(context, MainActivity::class.java).apply {
            flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
            putExtra("focus_package", app.packageName)
        }
        val pendingIntent = PendingIntent.getActivity(
            context, notificationId, intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )

        // Different wording depending on severity
        val title = if (app.riskLevel == "HIGH") {
            "\ud83d\udea8 ${app.appName} may be misusing your permissions"
        } else {
            "\u26a0 ${app.appName} shows unusual permission activity"
        }

        val message = "${app.appName} holds ${app.permissions.joinToString(", ")} access " +
                "but wasn't opened recently. Tap to view details."

        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.ic_dialog_alert)
            .setContentTitle(title)
            .setContentText(message)
            .setStyle(NotificationCompat.BigTextStyle().bigText(message))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setContentIntent(pendingIntent)
            .setAutoCancel(true)
            .setDefaults(NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE)
            .build()

        notificationManager.notify(notificationId, notification)
    }
}