package com.example.permguard

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/**
 * Unit tests verifying exact risk calculation boundaries, evaluation order,
 * and edge cases according to PermGuard's rule definitions.
 */
class RiskScoringTest {

    @Test
    fun testHighRiskBoundary_twoPermissions_under5Min() {
        // >= 2 permissions AND < 5 minutes -> HIGH
        val risk = PermissionScanner.calculateRisk(grantedCount = 2, foregroundMinutes = 4)
        assertEquals("HIGH", risk)
    }

    @Test
    fun testHighRiskBoundary_twoPermissions_exact5Min() {
        // Boundary case: exactly 5 minutes does NOT satisfy < 5,
        // so it falls through to >= 1 AND < 15 -> MEDIUM
        val risk = PermissionScanner.calculateRisk(grantedCount = 2, foregroundMinutes = 5)
        assertEquals("MEDIUM", risk)
    }

    @Test
    fun testMediumRiskBoundary_twoPermissions_under15Min() {
        // 2 permissions, 14 minutes -> MEDIUM
        val risk = PermissionScanner.calculateRisk(grantedCount = 2, foregroundMinutes = 14)
        assertEquals("MEDIUM", risk)
    }

    @Test
    fun testLowRiskBoundary_twoPermissions_15MinOrMore() {
        // 2 permissions, exactly 15 minutes -> LOW
        val risk = PermissionScanner.calculateRisk(grantedCount = 2, foregroundMinutes = 15)
        assertEquals("LOW", risk)
    }

    @Test
    fun testMediumRiskBoundary_onePermission_under15Min() {
        // 1 permission, 0 to 14 minutes -> MEDIUM
        val riskZero = PermissionScanner.calculateRisk(grantedCount = 1, foregroundMinutes = 0)
        val riskFourteen = PermissionScanner.calculateRisk(grantedCount = 1, foregroundMinutes = 14)
        assertEquals("MEDIUM", riskZero)
        assertEquals("MEDIUM", riskFourteen)
    }

    @Test
    fun testLowRiskBoundary_onePermission_15MinOrMore() {
        // 1 permission, 15 minutes or more -> LOW
        val riskFifteen = PermissionScanner.calculateRisk(grantedCount = 1, foregroundMinutes = 15)
        val riskSixty = PermissionScanner.calculateRisk(grantedCount = 1, foregroundMinutes = 60)
        assertEquals("LOW", riskFifteen)
        assertEquals("LOW", riskSixty)
    }

    @Test
    fun testLowRisk_zeroPermissions() {
        // 0 permissions -> LOW
        val risk = PermissionScanner.calculateRisk(grantedCount = 0, foregroundMinutes = 0)
        assertEquals("LOW", risk)
    }

    @Test
    fun testHighRisk_multiplePermissions_zeroMinutes() {
        // 5 permissions, 0 minutes (e.g. freshly installed app or zero foreground) -> HIGH
        val risk = PermissionScanner.calculateRisk(grantedCount = 5, foregroundMinutes = 0)
        assertEquals("HIGH", risk)
    }

    @Test
    fun testConcurrencyGuard_initialState() {
        // Concurrency guard should not be busy initially
        assertFalse(PermissionScanner.isScanning())
    }
}
