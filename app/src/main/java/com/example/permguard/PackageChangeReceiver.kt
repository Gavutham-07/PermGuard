package com.example.permguard

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager

/**
 * BroadcastReceiver listening for package additions, updates, and removals.
 * Android explicitly supports ACTION_PACKAGE_ADDED, ACTION_PACKAGE_REMOVED,
 * and ACTION_PACKAGE_REPLACED in the manifest with android:scheme="package".
 *
 * When triggered, it schedules an immediate one-time WorkManager check
 * to update the risk audit without waiting for the 15-minute periodic window.
 */
class PackageChangeReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        if (action == Intent.ACTION_PACKAGE_ADDED ||
            action == Intent.ACTION_PACKAGE_REMOVED ||
            action == Intent.ACTION_PACKAGE_REPLACED
        ) {
            val packageName = intent.data?.schemeSpecificPart ?: "unknown"
            val workRequest = OneTimeWorkRequestBuilder<PermissionCheckWorker>().build()

            WorkManager.getInstance(context).enqueueUniqueWork(
                "permguard_package_change_scan",
                ExistingWorkPolicy.REPLACE,
                workRequest
            )
        }
    }
}
