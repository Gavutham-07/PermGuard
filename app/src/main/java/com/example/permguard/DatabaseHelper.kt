package com.example.permguard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.util.Log

/**
 * SQLite database helper for PermGuard.
 *
 * Schema history
 * ──────────────
 * v1 – original: scan_results table
 * v2 – added last_used_time, scan_time columns
 * v3 – added mobile_bytes, wifi_bytes columns
 * v4 – added network_findings table; added combined_score, permission_score to scan_results
 *
 * Migrations NEVER drop the scan_results table; existing user data is preserved.
 */
class DatabaseHelper(context: Context) :
    SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val TAG = "DatabaseHelper"
        private const val DB_NAME = "permguard.db"
        private const val DB_VERSION = 4

        // ── scan_results table ──────────────────────────────────────────────
        private const val TABLE_SCANS = "scan_results"
        private const val COL_ID = "id"
        private const val COL_APP_NAME = "app_name"
        private const val COL_PACKAGE_NAME = "package_name"
        private const val COL_PERMISSIONS = "permissions"
        private const val COL_FOREGROUND_MIN = "foreground_minutes"
        private const val COL_RISK_LEVEL = "risk_level"
        private const val COL_IS_SYSTEM = "is_system_app"
        private const val COL_SCAN_TIME = "scan_time"
        private const val COL_LAST_USED = "last_used_time"
        private const val COL_MOBILE_BYTES = "mobile_bytes"
        private const val COL_WIFI_BYTES = "wifi_bytes"
        private const val COL_PERMISSION_SCORE = "permission_score"
        private const val COL_COMBINED_SCORE = "combined_score"
        private const val COL_SCORE_EXPLANATIONS = "score_explanations"

        // ── network_findings table ──────────────────────────────────────────
        private const val TABLE_FINDINGS = "network_findings"
        private const val FIND_ID = "id"
        private const val FIND_SEVERITY = "severity"
        private const val FIND_ISSUE_TYPE = "issue_type"
        private const val FIND_HOST = "host"
        private const val FIND_PATH = "path"
        private const val FIND_PACKAGE = "attributed_package"
        private const val FIND_IMPORTED_AT = "imported_at"
        private const val FIND_IMPORT_BATCH = "import_batch"
    }

    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(createScansTable())
        db.execSQL(createFindingsTable())
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        Log.i(TAG, "Upgrading database from v$oldVersion to v$newVersion")
        // Migrate forward step-by-step — never drop scan_results
        if (oldVersion < 2) {
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_LAST_USED TEXT")
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_SCAN_TIME TEXT")
        }
        if (oldVersion < 3) {
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_MOBILE_BYTES INTEGER")
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_WIFI_BYTES INTEGER")
        }
        if (oldVersion < 4) {
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_PERMISSION_SCORE INTEGER DEFAULT 0")
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_COMBINED_SCORE INTEGER DEFAULT 0")
            runSafe(db, "ALTER TABLE $TABLE_SCANS ADD COLUMN $COL_SCORE_EXPLANATIONS TEXT DEFAULT ''")
            db.execSQL(createFindingsTable())
        }
    }

    private fun runSafe(db: SQLiteDatabase, sql: String) {
        try {
            db.execSQL(sql)
        } catch (e: Exception) {
            Log.w(TAG, "Migration step skipped (column may already exist): $sql — ${e.message}")
        }
    }

    private fun createScansTable() = """
        CREATE TABLE IF NOT EXISTS $TABLE_SCANS (
            $COL_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            $COL_APP_NAME TEXT,
            $COL_PACKAGE_NAME TEXT,
            $COL_PERMISSIONS TEXT,
            $COL_FOREGROUND_MIN INTEGER,
            $COL_RISK_LEVEL TEXT,
            $COL_IS_SYSTEM INTEGER,
            $COL_SCAN_TIME TEXT,
            $COL_LAST_USED TEXT,
            $COL_MOBILE_BYTES INTEGER,
            $COL_WIFI_BYTES INTEGER,
            $COL_PERMISSION_SCORE INTEGER DEFAULT 0,
            $COL_COMBINED_SCORE INTEGER DEFAULT 0,
            $COL_SCORE_EXPLANATIONS TEXT DEFAULT ''
        )
    """.trimIndent()

    private fun createFindingsTable() = """
        CREATE TABLE IF NOT EXISTS $TABLE_FINDINGS (
            $FIND_ID INTEGER PRIMARY KEY AUTOINCREMENT,
            $FIND_SEVERITY TEXT,
            $FIND_ISSUE_TYPE TEXT,
            $FIND_HOST TEXT,
            $FIND_PATH TEXT,
            $FIND_PACKAGE TEXT,
            $FIND_IMPORTED_AT TEXT,
            $FIND_IMPORT_BATCH TEXT
        )
    """.trimIndent()

    // ── Scan results ──────────────────────────────────────────────────────────

    /**
     * Replaces the stored scan results with the latest scan.
     * Scores and explanations are saved alongside raw evidence.
     */
    fun saveScanResults(results: List<AppRisk>, scanTime: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete(TABLE_SCANS, null, null)
            for (app in results) {
                val values = ContentValues().apply {
                    put(COL_APP_NAME, app.appName)
                    put(COL_PACKAGE_NAME, app.packageName)
                    put(COL_PERMISSIONS, app.permissions.joinToString(","))
                    put(COL_FOREGROUND_MIN, app.foregroundMinutes)
                    put(COL_RISK_LEVEL, app.riskLevel)
                    put(COL_IS_SYSTEM, if (app.isSystemApp) 1 else 0)
                    put(COL_SCAN_TIME, scanTime)
                    put(COL_LAST_USED, app.lastUsedTime)
                    put(COL_MOBILE_BYTES, app.dataUsage?.mobileBytes)
                    put(COL_WIFI_BYTES, app.dataUsage?.wifiBytes)
                    put(COL_PERMISSION_SCORE, app.permissionScore)
                    put(COL_COMBINED_SCORE, app.combinedScore)
                    put(COL_SCORE_EXPLANATIONS, app.scoreExplanations.joinToString("|"))
                }
                db.insert(TABLE_SCANS, null, values)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    /** Loads the most recent scan snapshot from the database. */
    fun loadLastScan(): Pair<List<AppRisk>, String?> {
        val db = readableDatabase
        val results = mutableListOf<AppRisk>()
        var scanTime: String? = null

        val cursor = db.query(TABLE_SCANS, null, null, null, null, null, null)
        cursor.use {
            while (it.moveToNext()) {
                val permStr = it.getString(it.getColumnIndexOrThrow(COL_PERMISSIONS)) ?: ""
                val mobileBytes = it.getLong(it.getColumnIndexOrThrow(COL_MOBILE_BYTES))
                val wifiBytes = it.getLong(it.getColumnIndexOrThrow(COL_WIFI_BYTES))
                val explanations = (it.getString(it.getColumnIndexOrThrow(COL_SCORE_EXPLANATIONS)) ?: "")
                    .split("|").filter { s -> s.isNotBlank() }

                scanTime = it.getString(it.getColumnIndexOrThrow(COL_SCAN_TIME))
                results.add(
                    AppRisk(
                        appName = it.getString(it.getColumnIndexOrThrow(COL_APP_NAME)) ?: "",
                        packageName = it.getString(it.getColumnIndexOrThrow(COL_PACKAGE_NAME)) ?: "",
                        permissions = permStr.split(",").filter { p -> p.isNotBlank() },
                        foregroundMinutes = it.getLong(it.getColumnIndexOrThrow(COL_FOREGROUND_MIN)),
                        riskLevel = it.getString(it.getColumnIndexOrThrow(COL_RISK_LEVEL)) ?: "LOW",
                        isSystemApp = it.getInt(it.getColumnIndexOrThrow(COL_IS_SYSTEM)) == 1,
                        lastUsedTime = it.getString(it.getColumnIndexOrThrow(COL_LAST_USED)) ?: "Unknown",
                        dataUsage = DataUsageInfo(mobileBytes = mobileBytes, wifiBytes = wifiBytes),
                        permissionScore = it.getInt(it.getColumnIndexOrThrow(COL_PERMISSION_SCORE)),
                        combinedScore = it.getInt(it.getColumnIndexOrThrow(COL_COMBINED_SCORE)),
                        scoreExplanations = explanations
                    )
                )
            }
        }
        return Pair(results, scanTime)
    }

    /** Returns package names that were flagged HIGH in the last scan (for notification dedup). */
    fun getPreviousHighRiskPackages(): Set<String> {
        val (results, _) = loadLastScan()
        return results.filter { it.riskLevel == "HIGH" }.map { it.packageName }.toSet()
    }

    // ── Network findings ──────────────────────────────────────────────────────

    /** Persists a batch of newly imported findings. Returns the number actually stored. */
    fun saveFindings(findings: List<BurpImporter.ImportedFinding>, batchId: String): Int {
        if (findings.isEmpty()) return 0
        val db = writableDatabase
        var count = 0
        db.beginTransaction()
        try {
            for (f in findings) {
                val values = ContentValues().apply {
                    put(FIND_SEVERITY, f.severity.name)
                    put(FIND_ISSUE_TYPE, f.issueType)
                    put(FIND_HOST, f.host)
                    put(FIND_PATH, f.path)
                    put(FIND_PACKAGE, f.attributedPackage)
                    put(FIND_IMPORTED_AT, f.importedAt)
                    put(FIND_IMPORT_BATCH, batchId)
                }
                db.insert(TABLE_FINDINGS, null, values)
                count++
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
        return count
    }

    /** Loads all stored findings (used for risk calculation and UI display). */
    fun loadAllFindings(): List<BurpImporter.ImportedFinding> {
        val db = readableDatabase
        val results = mutableListOf<BurpImporter.ImportedFinding>()
        val cursor = db.query(TABLE_FINDINGS, null, null, null, null, null, "$FIND_IMPORTED_AT DESC")
        cursor.use {
            while (it.moveToNext()) {
                val sev = try {
                    NetworkFinding.Severity.valueOf(it.getString(it.getColumnIndexOrThrow(FIND_SEVERITY)) ?: "LOW")
                } catch (e: IllegalArgumentException) {
                    NetworkFinding.Severity.LOW
                }
                results.add(
                    BurpImporter.ImportedFinding(
                        severity = sev,
                        issueType = it.getString(it.getColumnIndexOrThrow(FIND_ISSUE_TYPE)) ?: "",
                        host = it.getString(it.getColumnIndexOrThrow(FIND_HOST)) ?: "",
                        path = it.getString(it.getColumnIndexOrThrow(FIND_PATH)) ?: "",
                        attributedPackage = it.getString(it.getColumnIndexOrThrow(FIND_PACKAGE)),
                        importedAt = it.getString(it.getColumnIndexOrThrow(FIND_IMPORTED_AT)) ?: ""
                    )
                )
            }
        }
        return results
    }

    /** Returns only the findings attributed to a specific package (for per-app scoring). */
    fun findingsForPackage(packageName: String): List<BurpImporter.ImportedFinding> =
        loadAllFindings().filter { it.attributedPackage == packageName }

    /** Deletes all network findings — user-initiated only, with UI confirmation. */
    fun clearAllFindings() {
        writableDatabase.delete(TABLE_FINDINGS, null, null)
    }

    /** Deletes all scan history. */
    fun clearScanHistory() {
        writableDatabase.delete(TABLE_SCANS, null, null)
    }
}
