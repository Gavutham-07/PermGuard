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
        val prefs: SharedPreferences =
            context.getSharedPreferences("permguard_notify_prefs", Context.MODE_PRIVATE)
        val endTime = System.currentTimeMillis()

        val scanResult = PermissionScanner.performScan(context, "Background check")
            ?: return Result.retry() // Another scan in progress, retry later

        val riskList = scanResult.riskList

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