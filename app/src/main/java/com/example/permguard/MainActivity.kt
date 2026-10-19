package com.example.permguard

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.animateContentSize
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import java.text.SimpleDateFormat
import java.util.*
import java.util.concurrent.TimeUnit

/**
 * Core data model for a scanned app.
 * Fields are nullable where data may be genuinely unavailable.
 */
data class AppRisk(
    val appName: String,
    val packageName: String,
    val permissions: List<String>,
    val foregroundMinutes: Long,
    val riskLevel: String,
    val isSystemApp: Boolean,
    val lastUsedTime: String = "Unknown",
    val dataUsage: DataUsageInfo? = null,
    val permissionScore: Int = 0,
    val combinedScore: Int = 0,
    val scoreExplanations: List<String> = emptyList(),
    val networkFindingsCount: Int = 0
)

class MainActivity : ComponentActivity() {

    private val riskList = mutableStateListOf<AppRisk>()
    private var hasAnalyzed by mutableStateOf(false)
    private var lastScanTime by mutableStateOf<String?>(null)
    private var focusedPackage by mutableStateOf<String?>(null)
    private var isScanning by mutableStateOf(false)
    private var showFindingsScreen by mutableStateOf(false)
    private var importStatusMessage by mutableStateOf<String?>(null)

    private lateinit var dbHelper: DatabaseHelper
    private val storedFindings = mutableStateListOf<BurpImporter.ImportedFinding>()

    // ── Permission launcher ───────────────────────────────────────────────────
    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { }

    // ── File picker launcher for Burp import ─────────────────────────────────
    private val burpFilePicker = registerForActivityResult(
        ActivityResultContracts.GetContent()
    ) { uri: Uri? ->
        if (uri != null) handleBurpFileSelected(uri)
    }

    // ── Settings return flag ──────────────────────────────────────────────────
    private var isReturningFromSettings = false

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
        storedFindings.addAll(dbHelper.loadAllFindings())

        setContent {
            MaterialTheme {
                PermGuardApp(
                    riskList = riskList,
                    hasAnalyzed = hasAnalyzed,
                    lastScanTime = lastScanTime,
                    isScanning = isScanning,
                    focusedPackage = focusedPackage,
                    showFindingsScreen = showFindingsScreen,
                    storedFindings = storedFindings,
                    importStatusMessage = importStatusMessage,
                    onStartClick = { runAnalysis() },
                    onGrantAccessClick = { openUsageAccessSettings() },
                    onAppClick = { app -> focusedPackage = app.packageName },
                    onBack = {
                        if (focusedPackage != null) focusedPackage = null
                        else showFindingsScreen = false
                    },
                    onImportBurpClick = { burpFilePicker.launch("*/*") },
                    onShowFindings = { showFindingsScreen = true },
                    onClearFindings = {
                        dbHelper.clearAllFindings()
                        storedFindings.clear()
                        importStatusMessage = "All findings cleared."
                    }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        focusedPackage = intent.getStringExtra("focus_package")
    }

    override fun onResume() {
        super.onResume()
        if (isReturningFromSettings) {
            isReturningFromSettings = false
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

    // ── Actions ───────────────────────────────────────────────────────────────

    private fun runAnalysis(reason: String = "Manual scan") {
        if (isScanning) return
        isScanning = true
        Thread {
            val result = PermissionScanner.performScan(this, reason)
            runOnUiThread {
                if (result != null) {
                    riskList.clear()
                    riskList.addAll(result.riskList)
                    lastScanTime = result.formattedScanTime
                    hasAnalyzed = true
                }
                isScanning = false
            }
        }.start()
    }

    private fun openUsageAccessSettings() {
        isReturningFromSettings = true
        startActivity(Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS))
    }

    private fun handleBurpFileSelected(uri: Uri) {
        Thread {
            val result = runCatching {
                val sizeBytes = contentResolver.openFileDescriptor(uri, "r")?.use { it.statSize } ?: 0L
                val stream = contentResolver.openInputStream(uri)
                    ?: throw IllegalStateException("Cannot open file")
                BurpImporter.parse(stream, sizeBytes, existingFindings = storedFindings.toList())
            }

            runOnUiThread {
                result.onSuccess { importResult ->
                    if (importResult.findings.isNotEmpty()) {
                        val batchId = SimpleDateFormat("yyyyMMdd_HHmmss", Locale.US).format(Date())
                        dbHelper.saveFindings(importResult.findings, batchId)
                        storedFindings.clear()
                        storedFindings.addAll(dbHelper.loadAllFindings())
                    }
                    val msg = buildString {
                        append("Imported ${importResult.findings.size} finding(s)")
                        if (importResult.duplicatesSkipped > 0)
                            append(", ${importResult.duplicatesSkipped} duplicate(s) skipped")
                        if (importResult.parseErrors.isNotEmpty())
                            append(". Errors: ${importResult.parseErrors.joinToString("; ")}")
                    }
                    importStatusMessage = msg
                }.onFailure { e ->
                    importStatusMessage = "Import failed: ${e.message}"
                }
            }
        }.start()
    }

    private fun askNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(
                    this, Manifest.permission.POST_NOTIFICATIONS
                ) != android.content.pm.PackageManager.PERMISSION_GRANTED
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
            ExistingPeriodicWorkPolicy.KEEP,
            workRequest
        )
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Composable UI
// ─────────────────────────────────────────────────────────────────────────────

fun riskColor(level: String): Color = when (level) {
    "HIGH" -> Color(0xFFE53935)
    "MEDIUM" -> Color(0xFFFB8C00)
    else -> Color(0xFF43A047)
}

fun formatBytes(bytes: Long?): String {
    if (bytes == null) return "Unavailable"
    return when {
        bytes >= 1024 * 1024 -> "%.1f MiB".format(bytes / (1024.0 * 1024.0))
        bytes >= 1024 -> "%.1f KiB".format(bytes / 1024.0)
        else -> "$bytes B"
    }
}

@Composable
fun PermGuardApp(
    riskList: List<AppRisk>,
    hasAnalyzed: Boolean,
    lastScanTime: String?,
    isScanning: Boolean,
    focusedPackage: String?,
    showFindingsScreen: Boolean,
    storedFindings: List<BurpImporter.ImportedFinding>,
    importStatusMessage: String?,
    onStartClick: () -> Unit,
    onGrantAccessClick: () -> Unit,
    onAppClick: (AppRisk) -> Unit,
    onBack: () -> Unit,
    onImportBurpClick: () -> Unit,
    onShowFindings: () -> Unit,
    onClearFindings: () -> Unit
) {
    when {
        focusedPackage != null -> {
            val app = riskList.find { it.packageName == focusedPackage }
            if (app != null) {
                AppDetailScreen(
                    app = app,
                    findingsCount = storedFindings.count { it.attributedPackage == focusedPackage },
                    onBack = onBack
                )
            } else {
                DashboardScreen(
                    riskList = riskList,
                    hasAnalyzed = hasAnalyzed,
                    lastScanTime = lastScanTime,
                    isScanning = isScanning,
                    findingsCount = storedFindings.size,
                    importStatusMessage = importStatusMessage,
                    onStartClick = onStartClick,
                    onGrantAccessClick = onGrantAccessClick,
                    onAppClick = onAppClick,
                    onImportBurpClick = onImportBurpClick,
                    onShowFindings = onShowFindings
                )
            }
        }
        showFindingsScreen -> {
            FindingsScreen(
                findings = storedFindings,
                onBack = onBack,
                onClearFindings = onClearFindings
            )
        }
        else -> {
            DashboardScreen(
                riskList = riskList,
                hasAnalyzed = hasAnalyzed,
                lastScanTime = lastScanTime,
                isScanning = isScanning,
                findingsCount = storedFindings.size,
                importStatusMessage = importStatusMessage,
                onStartClick = onStartClick,
                onGrantAccessClick = onGrantAccessClick,
                onAppClick = onAppClick,
                onImportBurpClick = onImportBurpClick,
                onShowFindings = onShowFindings
            )
        }
    }
}

@Composable
fun DashboardScreen(
    riskList: List<AppRisk>,
    hasAnalyzed: Boolean,
    lastScanTime: String?,
    isScanning: Boolean,
    findingsCount: Int,
    importStatusMessage: String?,
    onStartClick: () -> Unit,
    onGrantAccessClick: () -> Unit,
    onAppClick: (AppRisk) -> Unit,
    onImportBurpClick: () -> Unit,
    onShowFindings: () -> Unit
) {
    val highCount = riskList.count { it.riskLevel == "HIGH" }
    val mediumCount = riskList.count { it.riskLevel == "MEDIUM" }
    val lowCount = riskList.count { it.riskLevel == "LOW" }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(Color(0xFFF5F5F7))
    ) {
        // Header
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .background(Color(0xFF1A237E))
                .statusBarsPadding()
                .padding(16.dp)
        ) {
            Text(
                "PermGuard",
                color = Color.White,
                fontSize = 22.sp,
                fontWeight = FontWeight.Bold
            )
            Text(
                "Silent Permission Abuse Detector",
                color = Color(0xFFC5CAE9),
                fontSize = 12.sp
            )
            Spacer(Modifier.height(8.dp))
            // Action buttons
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onGrantAccessClick,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                ) { Text("Grant Access", fontSize = 12.sp) }
                Button(
                    onClick = onStartClick,
                    modifier = Modifier.weight(1f),
                    enabled = !isScanning,
                    colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF3949AB))
                ) {
                    if (isScanning) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            color = Color.White,
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Analyze Apps", fontSize = 12.sp)
                    }
                }
            }
            Spacer(Modifier.height(4.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(
                    onClick = onImportBurpClick,
                    modifier = Modifier.weight(1f),
                    colors = ButtonDefaults.outlinedButtonColors(contentColor = Color.White)
                ) { Text("Import Burp", fontSize = 12.sp) }
                if (findingsCount > 0) {
                    OutlinedButton(
                        onClick = onShowFindings,
                        modifier = Modifier.weight(1f),
                        colors = ButtonDefaults.outlinedButtonColors(contentColor = Color(0xFFFFCC02))
                    ) { Text("Findings ($findingsCount)", fontSize = 12.sp) }
                } else {
                    Spacer(Modifier.weight(1f))
                }
            }
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(horizontal = 12.dp),
            contentPadding = PaddingValues(bottom = 16.dp)
        ) {
            // Status row
            item {
                Spacer(Modifier.height(8.dp))
                if (lastScanTime != null) {
                    Text("Last scanned: $lastScanTime", fontSize = 11.sp, color = Color.Gray)
                }
                if (importStatusMessage != null) {
                    Spacer(Modifier.height(4.dp))
                    Card(
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFE8F5E9)),
                        shape = RoundedCornerShape(8.dp)
                    ) {
                        Text(
                            importStatusMessage,
                            modifier = Modifier.padding(10.dp),
                            fontSize = 12.sp,
                            color = Color(0xFF2E7D32)
                        )
                    }
                }
                Spacer(Modifier.height(8.dp))
            }

            // Summary cards
            if (hasAnalyzed) {
                item {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        SummaryCard("HIGH", highCount, Color(0xFFE53935), Modifier.weight(1f))
                        SummaryCard("MEDIUM", mediumCount, Color(0xFFFB8C00), Modifier.weight(1f))
                        SummaryCard("LOW", lowCount, Color(0xFF43A047), Modifier.weight(1f))
                    }
                    Spacer(Modifier.height(10.dp))
                }
            }

            if (!hasAnalyzed && !isScanning) {
                item {
                    Card(
                        modifier = Modifier.fillMaxWidth(),
                        colors = CardDefaults.cardColors(containerColor = Color(0xFFFFF8E1))
                    ) {
                        Text(
                            "Tap 'Analyze Apps' to scan installed applications.\n\n" +
                                    "Tip: tap 'Grant Access' first so usage-time data is also shown.",
                            modifier = Modifier.padding(16.dp),
                            fontSize = 13.sp
                        )
                    }
                    Spacer(Modifier.height(8.dp))
                }
            }

            if (isScanning) {
                item {
                    Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            CircularProgressIndicator()
                            Spacer(Modifier.height(8.dp))
                            Text("Scanning…", color = Color.Gray)
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                }
            }

            items(riskList) { app ->
                AppRiskCard(app, onClick = { onAppClick(app) })
                Spacer(Modifier.height(8.dp))
            }
        }
    }
}

@Composable
fun AppDetailScreen(
    app: AppRisk,
    findingsCount: Int,
    onBack: () -> Unit
) {
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
                .padding(16.dp)
        ) {
            TextButton(onClick = onBack) {
                Text("← Back", color = Color.White)
            }
            Text(app.appName, color = Color.White, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(app.packageName, color = Color(0xFFC5CAE9), fontSize = 11.sp)
        }

        LazyColumn(
            modifier = Modifier.fillMaxSize().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item {
                // Risk badge card
                DetailCard {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text("Permission Risk", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text(app.riskLevel, color = riskColor(app.riskLevel), fontWeight = FontWeight.Bold, fontSize = 22.sp)
                        }
                        Column(horizontalAlignment = Alignment.End) {
                            Text("Combined Score", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                            Text("${app.combinedScore}/100",
                                color = riskColor(if (app.combinedScore >= 60) "HIGH" else if (app.combinedScore >= 30) "MEDIUM" else "LOW"),
                                fontWeight = FontWeight.Bold, fontSize = 22.sp)
                        }
                    }
                    if (app.networkFindingsCount > 0) {
                        Spacer(Modifier.height(8.dp))
                        Text(
                            "⚠ $findingsCount Burp finding(s) attributed to this app",
                            color = Color(0xFFE65100), fontSize = 12.sp
                        )
                    }
                }
            }

            item {
                // Evidence section
                DetailCard {
                    Text("Evidence & Score Explanations", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Spacer(Modifier.height(8.dp))
                    app.scoreExplanations.forEach { line ->
                        Row(modifier = Modifier.padding(vertical = 2.dp)) {
                            Text("• ", color = Color.Gray)
                            Text(line, fontSize = 13.sp, color = Color(0xFF333333))
                        }
                    }
                    if (app.scoreExplanations.isEmpty()) {
                        Text("No explanations available.", fontSize = 13.sp, color = Color.Gray)
                    }
                    Spacer(Modifier.height(6.dp))
                    Text(
                        "⚠ This score is a heuristic indicator only. A high score does not prove malicious behaviour.",
                        fontSize = 11.sp, color = Color(0xFF795548)
                    )
                }
            }

            item {
                // App info
                DetailCard {
                    Text("App Information", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Spacer(Modifier.height(8.dp))
                    InfoRow("Type", if (app.isSystemApp) "System Service" else "User App")
                    InfoRow("Sensitive Permissions", app.permissions.joinToString(", ").ifEmpty { "None" })
                    InfoRow("Last Used", app.lastUsedTime)
                    InfoRow("Foreground (7 days)", "${app.foregroundMinutes} min")
                }
            }

            item {
                // Data usage
                DetailCard {
                    Text("Network Data Usage (7 days)", fontWeight = FontWeight.Bold, fontSize = 14.sp)
                    Spacer(Modifier.height(8.dp))
                    val du = app.dataUsage
                    if (du == null || !du.available) {
                        Text(
                            "Unavailable — NetworkStatsManager requires PACKAGE_USAGE_STATS to be granted, " +
                                    "and mobile data may additionally require READ_PHONE_STATE. " +
                                    "On emulators, mobile stats are not reported.",
                            fontSize = 12.sp, color = Color.Gray
                        )
                    } else {
                        InfoRow("Mobile data", formatBytes(du.mobileBytes))
                        InfoRow("Wi-Fi data", formatBytes(du.wifiBytes))
                        InfoRow("Total", formatBytes((du.mobileBytes ?: 0) + (du.wifiBytes ?: 0)))
                        Text(
                            "Note: these are byte totals, not real-time traffic.",
                            fontSize = 11.sp, color = Color.Gray
                        )
                    }
                }
            }

            item { Spacer(Modifier.height(16.dp)) }
        }
    }
}

@Composable
fun FindingsScreen(
    findings: List<BurpImporter.ImportedFinding>,
    onBack: () -> Unit,
    onClearFindings: () -> Unit
) {
    var showConfirmClear by remember { mutableStateOf(false) }

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
                .padding(16.dp)
        ) {
            TextButton(onClick = onBack) { Text("← Back", color = Color.White) }
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text("Imported Findings", color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.Bold)
                if (findings.isNotEmpty()) {
                    TextButton(onClick = { showConfirmClear = true }) {
                        Text("Clear All", color = Color(0xFFEF9A9A))
                    }
                }
            }
        }

        if (showConfirmClear) {
            AlertDialog(
                onDismissRequest = { showConfirmClear = false },
                title = { Text("Clear all findings?") },
                text = { Text("This will permanently delete all imported Burp findings. This action cannot be undone.") },
                confirmButton = {
                    TextButton(onClick = { showConfirmClear = false; onClearFindings() }) {
                        Text("Clear", color = Color(0xFFE53935))
                    }
                },
                dismissButton = {
                    TextButton(onClick = { showConfirmClear = false }) { Text("Cancel") }
                }
            )
        }

        if (findings.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text("No findings imported yet.", color = Color.Gray)
                    Spacer(Modifier.height(8.dp))
                    Text(
                        "Use 'Import Burp' on the dashboard to import a Burp XML or PermGuard CSV file.",
                        fontSize = 12.sp, color = Color.Gray
                    )
                }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize().padding(horizontal = 12.dp),
                contentPadding = PaddingValues(vertical = 8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(findings) { finding ->
                    FindingCard(finding)
                }
            }
        }
    }
}

@Composable
fun FindingCard(finding: BurpImporter.ImportedFinding) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(10.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    finding.issueType,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 14.sp,
                    modifier = Modifier.weight(1f),
                    maxLines = 2,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.width(8.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(riskColor(finding.severity.name))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Text(finding.severity.name, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
            }
            Spacer(Modifier.height(4.dp))
            Text("${finding.host}${finding.path}", fontSize = 12.sp, color = Color.Gray, maxLines = 2)
            Spacer(Modifier.height(2.dp))
            val attribution = finding.attributedPackage
            Text(
                if (attribution != null) "App: $attribution" else "Attribution: unattributed",
                fontSize = 11.sp,
                color = if (attribution != null) Color(0xFF1565C0) else Color(0xFF9E9E9E)
            )
            Text("Imported: ${finding.importedAt}", fontSize = 10.sp, color = Color.LightGray)
        }
    }
}

@Composable
fun DetailCard(content: @Composable ColumnScope.() -> Unit) {
    Card(
        modifier = Modifier.fillMaxWidth(),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(modifier = Modifier.padding(16.dp), content = content)
    }
}

@Composable
fun InfoRow(label: String, value: String) {
    Column(modifier = Modifier.padding(vertical = 4.dp)) {
        Text(label, fontSize = 11.sp, color = Color.Gray)
        Text(value, fontSize = 14.sp, fontWeight = FontWeight.Medium)
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
            modifier = Modifier.padding(vertical = 12.dp).fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text("$count", color = color, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text(label, color = Color.Gray, fontSize = 11.sp)
        }
    }
}

@Composable
fun AppRiskCard(app: AppRisk, onClick: () -> Unit = {}) {
    var expanded by remember { mutableStateOf(false) }

    Card(
        modifier = Modifier
            .fillMaxWidth()
            .clickable { onClick() }
            .animateContentSize(),
        colors = CardDefaults.cardColors(containerColor = Color.White),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp),
        shape = RoundedCornerShape(12.dp)
    ) {
        Column(modifier = Modifier.padding(12.dp)) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text(
                    app.appName,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    modifier = Modifier.weight(1f),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
                Spacer(Modifier.width(6.dp))
                Box(
                    Modifier
                        .clip(RoundedCornerShape(6.dp))
                        .background(riskColor(app.riskLevel))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Text(app.riskLevel, color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                }
                if (app.combinedScore > 0) {
                    Spacer(Modifier.width(4.dp))
                    Text("${app.combinedScore}pts", fontSize = 11.sp, color = Color.Gray)
                }
            }

            Spacer(Modifier.height(4.dp))
            Text(
                "${app.packageName}  •  ${if (app.isSystemApp) "System" else "User"}",
                fontSize = 10.sp,
                color = Color.Gray,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Spacer(Modifier.height(6.dp))
            Text("Permissions: ${app.permissions.joinToString(", ")}", fontSize = 12.sp)
            Text("Foreground (7d): ${app.foregroundMinutes} min  •  Last used: ${app.lastUsedTime}", fontSize = 12.sp, color = Color(0xFF555555))

            // Data usage inline
            val du = app.dataUsage
            if (du != null && du.available) {
                Text(
                    "Data: Mobile ${formatBytes(du.mobileBytes)} / Wi-Fi ${formatBytes(du.wifiBytes)}",
                    fontSize = 12.sp,
                    color = Color(0xFF555555)
                )
            }

            if (app.networkFindingsCount > 0) {
                Text("⚠ ${app.networkFindingsCount} Burp finding(s)", fontSize = 12.sp, color = Color(0xFFE65100))
            }
        }
    }
}
