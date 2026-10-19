package com.example.permguard

import android.Manifest
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

data class AppRisk(
    val appName: String,
    val packageName: String,
    val permissions: List<String>,
    val foregroundMinutes: Long,
    val riskLevel: String,
    val isSystemApp: Boolean,
    val lastUsedTime: String = "Unknown",
    val dataUsage: DataUsageInfo? = null
)

class MainActivity : ComponentActivity() {

    private val riskList = mutableStateListOf<AppRisk>()
    private var hasAnalyzed by mutableStateOf(false)
    private var lastScanTime by mutableStateOf<String?>(null)
    private var focusedPackage by mutableStateOf<String?>(null)

    private lateinit var dbHelper: DatabaseHelper

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    private val sensitivePermissions = listOf(
        Manifest.permission.CAMERA,
        Manifest.permission.RECORD_AUDIO,
        Manifest.permission.ACCESS_FINE_LOCATION,
        Manifest.permission.ACCESS_COARSE_LOCATION,
        Manifest.permission.READ_CONTACTS
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        dbHelper = DatabaseHelper(this)

        askNotificationPermission()
        scheduleBackgroundMonitoring()

        focusedPackage = intent.getStringExtra("focus_package")

        val (savedResults, savedTime) = dbHelper.loadLastScan()
        if (savedResults.isNotEmpty()) {
            riskList.addAll(savedResults)
            lastScanTime = savedTime
            hasAnalyzed = true
        }

        setContent {
            MaterialTheme {
                if (focusedPackage != null) {
                    val focusedApp = riskList.find { it.packageName == focusedPackage }
                    if (focusedApp != null) {
                        AppDetailScreen(
                            app = focusedApp,
                            onBack = { focusedPackage = null }
                        )
                    } else {
                        MainScreen(
                            riskList = riskList,
                            hasAnalyzed = hasAnalyzed,
                            lastScanTime = lastScanTime,
                            onStartClick = { runAnalysis() },
                            onGrantAccessClick = { openUsageAccessSettings() },
                            onAppClick = { app -> focusedPackage = app.packageName }
                        )
                    }
                } else {
                    MainScreen(
                        riskList = riskList,
                        hasAnalyzed = hasAnalyzed,
                        lastScanTime = lastScanTime,
                        onStartClick = { runAnalysis() },
                        onGrantAccessClick = { openUsageAccessSettings() },
                        onAppClick = { app -> focusedPackage = app.packageName }
                    )
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        focusedPackage = intent.getStringExtra("focus_package")
    }

    private var isReturningFromSettings = false

    override fun onResume() {
        super.onResume()
        if (isReturningFromSettings) {
            isReturningFromSettings = false
            // User just returned from settings: trigger safe immediate recheck
            runAnalysis("Returned from Settings")
        } else {
            val (savedResults, savedTime) = dbHelper.loadLastScan()
            if (savedResults.isNotEmpty()) {
                riskList.clear()
                riskList.addAll(savedResults)
                lastScanTime = savedTime
                hasAnalyzed = true
            }
        }
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.POST_NOTIFICATIONS
                ) != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    private fun scheduleBackgroundMonitoring() {
        val workRequest = PeriodicWorkRequestBuilder<PermissionCheckWorker>(
            15, TimeUnit.MINUTES
        ).build()

        WorkManager.getInstance(this).enqueueUniquePeriodicWork(
            "permguard_periodic_check",
            androidx.work.ExistingPeriodicWorkPolicy.KEEP,
            workRequest
        )
    }

    private fun openUsageAccessSettings() {
        isReturningFromSettings = true
        startActivity(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
    }

    private fun runAnalysis(reason: String = "Manual scan") {
        val scanResult = PermissionScanner.performScan(this, reason)
        if (scanResult != null) {
            riskList.clear()
            riskList.addAll(scanResult.riskList)
            lastScanTime = scanResult.formattedScanTime
            hasAnalyzed = true
        }
    }
}

fun riskColor(level: String): Color = when (level) {
    "HIGH" -> Color(0xFFE53935)
    "MEDIUM" -> Color(0xFFFB8C00)
    else -> Color(0xFF43A047)
}

@Composable
fun MainScreen(
    riskList: List<AppRisk>,
    hasAnalyzed: Boolean,
    lastScanTime: String?,
    onStartClick: () -> Unit,
    onGrantAccessClick: () -> Unit,
    onAppClick: (AppRisk) -> Unit
) {
    val highCount = riskList.count { it.riskLevel == "HIGH" }
    val mediumCount = riskList.count { it.riskLevel == "MEDIUM" }
    val lowCount = riskList.count { it.riskLevel == "LOW" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F7))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF1A237E))
                .statusBarsPadding()
                .padding(20.dp)
        ) {
            Text(
                text = "Silent App Permission",
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Abuse Detector",
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Monitors apps in the background every 15 minutes",
                color = Color(0xFFC5CAE9),
                fontSize = 13.sp
            )
        }

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            OutlinedButton(
                onClick = onGrantAccessClick,
                modifier = Modifier.weight(1f)
            ) {
                Text("Grant Access")
            }
            Button(
                onClick = onStartClick,
                modifier = Modifier.weight(1f),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF1A237E))
            ) {
                Text("Analyze Apps")
            }
        }

        if (lastScanTime != null) {
            Text(
                text = "Last scanned: $lastScanTime",
                fontSize = 12.sp,
                color = Color.Gray,
                modifier = Modifier.padding(horizontal = 16.dp)
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        if (hasAnalyzed) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                SummaryCard("HIGH", highCount, Color(0xFFE53935), Modifier.weight(1f))
                SummaryCard("MEDIUM", mediumCount, Color(0xFFFB8C00), Modifier.weight(1f))
                SummaryCard("LOW", lowCount, Color(0xFF43A047), Modifier.weight(1f))
            }
            Spacer(modifier = Modifier.height(12.dp))
        }

        LazyColumn(
            modifier = Modifier
                .fillMaxSize()
                .padding(horizontal = 16.dp)
        ) {
            items(riskList) { app ->
                AppRiskCard(app, onClick = { onAppClick(app) })
                Spacer(modifier = Modifier.height(10.dp))
            }
            item { Spacer(modifier = Modifier.height(16.dp)) }
        }
    }
}

@Composable
fun AppDetailScreen(app: AppRisk, onBack: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F7))
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF1A237E))
                .statusBarsPadding()
                .padding(20.dp)
        ) {
            TextButton(onClick = onBack) {
                Text("← Back to Dashboard", color = Color.White)
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = app.appName,
                color = Color.White,
                fontSize = 24.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                text = "Suspicious permission activity detected",
                color = Color(0xFFC5CAE9),
                fontSize = 13.sp
            )
        }

        Column(modifier = Modifier.padding(16.dp)) {
            Card(
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = Color.White),
                elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
                shape = RoundedCornerShape(12.dp)
            ) {
                Column(modifier = Modifier.padding(18.dp)) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.SpaceBetween,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Text("Risk Level", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(riskColor(app.riskLevel))
                                .padding(horizontal = 12.dp, vertical = 5.dp)
                        ) {
                            Text("⚠ ${app.riskLevel}", color = Color.White, fontWeight = FontWeight.Bold)
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))
                    DetailRow("Package Name", app.packageName)
                    DetailRow("App Type", if (app.isSystemApp) "System Service" else "User App")
                    DetailRow("Permissions Misused", app.permissions.joinToString(", "))
                    DetailRow("Last Used", app.lastUsedTime)
                    DetailRow("Foreground Usage (7 days)", "${app.foregroundMinutes} minutes")

                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Why is this flagged?",
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = "This app holds sensitive permissions (${app.permissions.joinToString(", ")}) " +
                                "but was barely opened on screen recently. This pattern suggests it may be " +
                                "accessing these permissions silently, without your active awareness.",
                        fontSize = 13.sp,
                        color = Color(0xFF555555)
                    )
                }
            }
        }
    }
}

@Composable
fun DetailRow(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 6.dp)) {
        Text(text = label, fontSize = 12.sp, color = Color.Gray)
        Text(text = value, fontSize = 15.sp, fontWeight = FontWeight.Medium)
    }
}

@Composable
fun SummaryCard(label: String, count: Int, color: Color, modifier: Modifier = Modifier) {
    Card(
        modifier = modifier,
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(
            modifier = Modifier
                .padding(vertical = 12.dp)
                .fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(text = "$count", color = color, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(text = label, color = Color.Gray, fontSize = 11.sp)
        }
    }
}

@Composable
fun AppRiskCard(app: AppRisk, onClick: () -> Unit = {}) {
    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() },
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(14.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    text = app.appName,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    modifier = Modifier.weight(1f)
                )
                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .background(riskColor(app.riskLevel))
                        .padding(horizontal = 10.dp, vertical = 4.dp)
                ) {
                    val prefix = if (app.riskLevel == "HIGH") "⚠ " else ""
                    Text(
                        text = "$prefix${app.riskLevel}",
                        color = Color.White,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }

            Spacer(modifier = Modifier.height(6.dp))

            Text(
                text = "${app.packageName}  •  ${if (app.isSystemApp) "System Service" else "User App"}",
                fontSize = 11.sp,
                color = Color.Gray
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Permissions: ${app.permissions.joinToString(", ")}",
                fontSize = 13.sp
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = "Foreground usage (7 days): ${app.foregroundMinutes} min",
                fontSize = 13.sp,
                color = Color(0xFF555555)
            )

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = "Last used: ${app.lastUsedTime}",
                fontSize = 13.sp,
                color = Color(0xFF555555)
            )
        }
    }
}
