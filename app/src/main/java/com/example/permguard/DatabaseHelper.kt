package com.example.permguard

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

class DatabaseHelper(context: Context) :
    SQLiteOpenHelper(context, DB_NAME, null, DB_VERSION) {

    companion object {
        private const val DB_NAME = "permguard.db"
        private const val DB_VERSION = 2
        private const val TABLE_NAME = "scan_results"
        private const val COL_ID = "id"
        private const val COL_APP_NAME = "app_name"
        private const val COL_PACKAGE_NAME = "package_name"
        private const val COL_PERMISSIONS = "permissions"
        private const val COL_FOREGROUND_MIN = "foreground_minutes"
        private const val COL_RISK_LEVEL = "risk_level"
        private const val COL_IS_SYSTEM = "is_system_app"
        private const val COL_SCAN_TIME = "scan_time"
        private const val COL_LAST_USED = "last_used_time"
    }

    override fun onCreate(db: SQLiteDatabase) {
        val createTable = """
            CREATE TABLE $TABLE_NAME (
                $COL_ID INTEGER PRIMARY KEY AUTOINCREMENT,
                $COL_APP_NAME TEXT,
                $COL_PACKAGE_NAME TEXT,
                $COL_PERMISSIONS TEXT,
                $COL_FOREGROUND_MIN INTEGER,
                $COL_RISK_LEVEL TEXT,
                $COL_IS_SYSTEM INTEGER,
                $COL_SCAN_TIME TEXT,
                $COL_LAST_USED TEXT
            )
        """.trimIndent()
        db.execSQL(createTable)
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
        db.execSQL("DROP TABLE IF EXISTS $TABLE_NAME")
        onCreate(db)
    }

    fun saveScanResults(results: List<AppRisk>, scanTime: String) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            db.delete(TABLE_NAME, null, null)
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
                }
                db.insert(TABLE_NAME, null, values)
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun loadLastScan(): Pair<List<AppRisk>, String?> {
        val db = readableDatabase
        val results = mutableListOf<AppRisk>()
        var scanTime: String? = null

        val cursor = db.query(TABLE_NAME, null, null, null, null, null, null)
        cursor.use {
            while (it.moveToNext()) {
                val appName = it.getString(it.getColumnIndexOrThrow(COL_APP_NAME))
                val packageName = it.getString(it.getColumnIndexOrThrow(COL_PACKAGE_NAME))
                val permissionsStr = it.getString(it.getColumnIndexOrThrow(COL_PERMISSIONS))
                val foregroundMin = it.getLong(it.getColumnIndexOrThrow(COL_FOREGROUND_MIN))
                val riskLevel = it.getString(it.getColumnIndexOrThrow(COL_RISK_LEVEL))
                val isSystem = it.getInt(it.getColumnIndexOrThrow(COL_IS_SYSTEM)) == 1
                val lastUsed = it.getString(it.getColumnIndexOrThrow(COL_LAST_USED)) ?: "Unknown"
                scanTime = it.getString(it.getColumnIndexOrThrow(COL_SCAN_TIME))

                results.add(
                    AppRisk(
                        appName = appName,
                        packageName = packageName,
                        permissions = permissionsStr.split(",").filter { p -> p.isNotBlank() },
                        foregroundMinutes = foregroundMin,
                        riskLevel = riskLevel,
                        isSystemApp = isSystem,
                        lastUsedTime = lastUsed
                    )
                )
            }
        }
        return Pair(results, scanTime)
    }

    // Returns just the set of package names that were HIGH risk in the last saved scan
    fun getPreviousHighRiskPackages(): Set<String> {
        val (results, _) = loadLastScan()
        return results.filter { it.riskLevel == "HIGH" }.map { it.packageName }.toSet()
    }
}
