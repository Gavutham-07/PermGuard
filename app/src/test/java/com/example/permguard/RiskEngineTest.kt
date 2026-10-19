package com.example.permguard



import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Test

class RiskEngineTest {

    private fun makeAppRisk(
        grantedPermissions: List<String> = listOf(),
        foregroundMinutes: Long = 0,
        isSystemApp: Boolean = false,
        lastUsedTime: String = "Unknown"
    ): AppRisk {
        return AppRisk(
            appName = "TestApp",
            packageName = "com.example.test",
            permissions = grantedPermissions,
            foregroundMinutes = foregroundMinutes,
            riskLevel = "LOW",
            isSystemApp = isSystemApp,
            lastUsedTime = lastUsedTime
        )
    }

    @Test
    fun `permission evidence scoring works`() {
        // 2 sensitive permissions out of 5 -> 2 * 8 = 16 points
        val appRisk = makeAppRisk(grantedPermissions = listOf(
            Manifest.permission.CAMERA,
            Manifest.permission.RECORD_AUDIO
        ))
        val result = RiskEngine.computeCombinedRisk(
            appRisk = appRisk,
            usageAccessGranted = false,
            dataUsage = null,
            networkFindings = emptyList()
        )
        // Permission points only
        assertEquals(16, result.totalScore)
        assertEquals(CombinedRiskResult.RiskLevel.LOW, result.level)
        assertEquals(listOf(Evidence.PERMISSIONS), result.evidenceCoverage)
    }

    @Test
    fun `usage evidence adds points when access granted`() {
        val appRisk = makeAppRisk(foregroundMinutes = 3)
        val result = RiskEngine.computeCombinedRisk(
            appRisk = appRisk,
            usageAccessGranted = true,
            dataUsage = null,
            networkFindings = emptyList()
        )
        // No permission points, usage points = full USAGE_WEIGHT (15)
        assertEquals(15, result.totalScore)
        assertEquals(CombinedRiskResult.RiskLevel.LOW, result.level)
        assertEquals(listOf(Evidence.USAGE), result.evidenceCoverage)
    }

    @Test
    fun `data usage evidence contributes correctly`() {
        val appRisk = makeAppRisk()
        val dataInfo = DataUsageInfo(mobileBytes = 150L * 1024 * 1024, wifiBytes = 0)
        val result = RiskEngine.computeCombinedRisk(
            appRisk = appRisk,
            usageAccessGranted = false,
            dataUsage = dataInfo,
            networkFindings = emptyList()
        )
        // Data usage >=100MiB => full DATA_WEIGHT (20)
        assertEquals(20, result.totalScore)
        assertEquals(CombinedRiskResult.RiskLevel.LOW, result.level)
        assertEquals(listOf(Evidence.DATA_USAGE), result.evidenceCoverage)
    }

    @Test
    fun `network findings are capped at weight limit`() {
        val appRisk = makeAppRisk()
        val findings = listOf(
            NetworkFinding(NetworkFinding.Severity.HIGH), // 15 pts
            NetworkFinding(NetworkFinding.Severity.MEDIUM), // 8 pts
            NetworkFinding(NetworkFinding.Severity.LOW) // 3 pts
        )
        val result = RiskEngine.computeCombinedRisk(
            appRisk = appRisk,
            usageAccessGranted = false,
            dataUsage = null,
            networkFindings = findings
        )
        // Sum = 26, capped to NETWORK_WEIGHT (25)
        assertEquals(25, result.totalScore)
        assertEquals(RiskEngine.CombinedRiskResult.RiskLevel.LOW, result.level)
        assertEquals(listOf(Evidence.NETWORK), result.evidenceCoverage)
    }

    @Test
    fun `combined evidence produces correct level thresholds`() {
        // Create a scenario that should be HIGH (>60)
        val appRisk = makeAppRisk(
            grantedPermissions = listOf(
                Manifest.permission.CAMERA,
                Manifest.permission.RECORD_AUDIO,
                Manifest.permission.ACCESS_FINE_LOCATION
            ),
            foregroundMinutes = 2
        )
        val dataInfo = DataUsageInfo(mobileBytes = 120L * 1024 * 1024, wifiBytes = 0)
        val findings = listOf(NetworkFinding(NetworkFinding.Severity.HIGH))
        val result = RiskEngine.computeCombinedRisk(
            appRisk = appRisk,
            usageAccessGranted = true,
            dataUsage = dataInfo,
            networkFindings = findings
        )
        // Permission points: 3 * 8 = 24
        // Usage points: <5 min => 15
        // Data points: >=100MiB => 20
        // Network points: 15 (capped to 25)
        // Total = 24+15+20+15 = 74 => HIGH
        assertEquals(74, result.totalScore)
        assertEquals(CombinedRiskResult.RiskLevel.HIGH, result.level)
        // All evidence types should be present
        assertEquals(
            setOf(
                RiskEngine.CombinedRiskResult.Evidence.PERMISSIONS,
                RiskEngine.CombinedRiskResult.Evidence.USAGE,
                RiskEngine.CombinedRiskResult.Evidence.DATA_USAGE,
                RiskEngine.CombinedRiskResult.Evidence.NETWORK
            ),
            result.evidenceCoverage.toSet()
        )
    }
}
