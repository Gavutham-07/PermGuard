package com.example.permguard

import java.util.Locale

/**
 * Data class representing optional per‑app data‑usage information.
 * Fields are nullable because the required permission may be unavailable on the device.
 */
data class DataUsageInfo(
    val mobileBytes: Long?,
    val wifiBytes: Long?,
    val available: Boolean = (mobileBytes != null || wifiBytes != null)
)

/**
 * Minimal representation of a network finding imported from Burp (or other source).
 * Only the severity field is used for scoring in this phase.
 */
data class NetworkFinding(
    val severity: Severity
) {
    enum class Severity { LOW, MEDIUM, HIGH }
}

/**
 * Result of the unified risk calculation.
 */
data class CombinedRiskResult(
    val totalScore: Int,
    val level: RiskLevel,
    val evidenceCoverage: List<Evidence>,
    val explanations: List<String>
) {
    enum class RiskLevel { LOW, MEDIUM, HIGH }
    enum class Evidence { PERMISSIONS, USAGE, DATA_USAGE, NETWORK }
}

object RiskEngine {
    private const val MAX_TOTAL = 100
    private const val PERMISSION_WEIGHT = 40
    private const val USAGE_WEIGHT = 15
    private const val DATA_WEIGHT = 20
    private const val NETWORK_WEIGHT = 25

    private val sensitivePermissions = listOf(
        android.Manifest.permission.CAMERA,
        android.Manifest.permission.RECORD_AUDIO,
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
        android.Manifest.permission.READ_CONTACTS
    )

    /**
     * Compute a combined risk for a single app.
     *
     * @param appRisk the original permission‑only risk data (includes granted permissions list).
     * @param usageAccessGranted whether Usage Access permission is granted on the device.
     * @param dataUsage optional data‑usage information; if unavailable the evidence is omitted.
     * @param networkFindings list of validated network findings; may be empty.
     */
    fun computeCombinedRisk(
        appRisk: AppRisk,
        usageAccessGranted: Boolean,
        dataUsage: DataUsageInfo?,
        networkFindings: List<NetworkFinding>
    ): CombinedRiskResult {
        var score = 0
        val coverage = mutableListOf<CombinedRiskResult.Evidence>()
        val explanations = mutableListOf<String>()

        // ---- Permission evidence ----
        val grantedCount = appRisk.permissions.size
        if (grantedCount > 0) {
            // Each of the 5 possible sensitive permissions contributes equally to the 40‑point bucket.
            val perPermPoints = PERMISSION_WEIGHT / sensitivePermissions.size
            val permPoints = (grantedCount * perPermPoints).coerceAtMost(PERMISSION_WEIGHT)
            score += permPoints
            coverage.add(CombinedRiskResult.Evidence.PERMISSIONS)
            explanations.add("${grantedCount} sensitive permission(s) granted → $permPoints pts")
        }

        // ---- Usage‑pattern evidence ----
        if (usageAccessGranted) {
            coverage.add(CombinedRiskResult.Evidence.USAGE)
            val usagePoints = when {
                appRisk.foregroundMinutes < 5 -> USAGE_WEIGHT // suspicious little use
                appRisk.foregroundMinutes < 15 -> (USAGE_WEIGHT * 2) / 3 // moderate
                else -> USAGE_WEIGHT / 3 // low suspicion
            }
            score += usagePoints
            explanations.add("Foreground ${appRisk.foregroundMinutes} min → $usagePoints pts")
        } else {
            explanations.add("Usage Access not granted – no usage evidence")
        }

        // ---- Data‑usage evidence ----
        if (dataUsage != null && dataUsage.available) {
            coverage.add(CombinedRiskResult.Evidence.DATA_USAGE)
            val totalBytes = (dataUsage.mobileBytes ?: 0L) + (dataUsage.wifiBytes ?: 0L)
            val dataPoints = when {
                totalBytes >= 100L * 1024 * 1024 -> DATA_WEIGHT // >=100 MiB
                totalBytes >= 10L * 1024 * 1024 -> (DATA_WEIGHT * 2) / 3 // >=10 MiB
                totalBytes > 0L -> DATA_WEIGHT / 3
                else -> 0
            }
            score += dataPoints
            explanations.add("Data usage ${totalBytes / 1024} KB → $dataPoints pts")
        } else {
            explanations.add("Data‑usage statistics unavailable")
        }

        // ---- Network findings evidence ----
        if (networkFindings.isNotEmpty()) {
            coverage.add(CombinedRiskResult.Evidence.NETWORK)
            var networkPoints = 0
            for (f in networkFindings) {
                val pts = when (f.severity) {
                    NetworkFinding.Severity.HIGH -> 15
                    NetworkFinding.Severity.MEDIUM -> 8
                    NetworkFinding.Severity.LOW -> 3
                }
                networkPoints += pts
            }
            // Cap to the designated bucket weight.
            networkPoints = networkPoints.coerceAtMost(NETWORK_WEIGHT)
            score += networkPoints
            explanations.add("${networkFindings.size} network finding(s) → $networkPoints pts")
        } else {
            explanations.add("No network findings imported")
        }

        // Clamp total score to 0‑100.
        val totalScore = score.coerceIn(0, MAX_TOTAL)
        val level = when (totalScore) {
            in 0..29 -> CombinedRiskResult.RiskLevel.LOW
            in 30..59 -> CombinedRiskResult.RiskLevel.MEDIUM
            else -> CombinedRiskResult.RiskLevel.HIGH
        }
        return CombinedRiskResult(
            totalScore = totalScore,
            level = level,
            evidenceCoverage = coverage,
            explanations = explanations
        )
    }
}
