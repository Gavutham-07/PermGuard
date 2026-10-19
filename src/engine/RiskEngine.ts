import { CombinedRiskResult, DataUsageInfo, EvidenceType, NetworkFinding, RiskLevel } from '../types';

export const SENSITIVE_PERMISSIONS = [
  'android.permission.CAMERA',
  'android.permission.RECORD_AUDIO',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.READ_CONTACTS',
];

export const SHORT_PERMISSIONS = [
  'CAMERA',
  'RECORD_AUDIO',
  'ACCESS_FINE_LOCATION',
  'ACCESS_COARSE_LOCATION',
  'READ_CONTACTS',
];

export const RiskEngine = {
  MAX_TOTAL: 100,
  PERMISSION_WEIGHT: 40,
  USAGE_WEIGHT: 15,
  DATA_WEIGHT: 20,
  NETWORK_WEIGHT: 25,

  sensitivePermissions: SHORT_PERMISSIONS,

  /**
   * One authoritative function for classifying 0–100 scores.
   * Documented provisional thresholds:
   * - 0–29: LOW
   * - 30–59: MEDIUM
   * - 60–100: HIGH
   *
   * Out-of-range scores are clamped to [0, 100].
   */
  classifyRiskScore(score: number): RiskLevel {
    const clamped = Math.max(0, Math.min(100, Math.round(score)));
    if (clamped >= 60) return 'HIGH';
    if (clamped >= 30) return 'MEDIUM';
    return 'LOW';
  },

  /**
   * Authoritative classification for permission-only score (0–40 pts).
   * Documented separate thresholds:
   * - 0–15: LOW (0 or 1 sensitive permission granted out of 5)
   * - 16–31: MEDIUM (2 or 3 sensitive permissions granted)
   * - 32–40: HIGH (4 or 5 sensitive permissions granted)
   */
  classifyPermissionScore(score: number): RiskLevel {
    const clamped = Math.max(0, Math.min(40, Math.round(score)));
    if (clamped >= 32) return 'HIGH';
    if (clamped >= 16) return 'MEDIUM';
    return 'LOW';
  },

  /**
   * Preserved legacy 2-rule check (retained for audit/migration diagnostics only).
   * MUST NEVER overwrite or determine combinedRiskLevel.
   */
  legacyCalculateRisk(grantedCount: number, foregroundMinutes: number): RiskLevel {
    if (grantedCount >= 2 && foregroundMinutes < 5) return 'HIGH';
    if (grantedCount >= 1 && foregroundMinutes < 15) return 'MEDIUM';
    return 'LOW';
  },

  /**
   * Compute a combined risk for a single app across 4 evidence buckets:
   * 1. Permissions (0–40 pts)
   * 2. Usage Pattern (0–15 pts)
   * 3. Data Consumption (0–20 pts)
   * 4. Network Findings (0–25 pts)
   */
  computeCombinedRisk(
    appRisk: { permissions: string[]; foregroundMinutes: number },
    usageAccessGranted: boolean,
    dataUsage: DataUsageInfo | null | undefined,
    networkFindings: NetworkFinding[]
  ): CombinedRiskResult & { permissionScore: number; permissionRiskLevel: RiskLevel } {
    let score = 0;
    const coverage: EvidenceType[] = [];
    const explanations: string[] = [];

    // ---- 1. Permission evidence (0–40 pts) ----
    const grantedCount = appRisk.permissions.length;
    let permPoints = 0;
    if (grantedCount > 0) {
      // 5 sensitive permissions = 8 pts each
      const perPermPoints = Math.floor(this.PERMISSION_WEIGHT / this.sensitivePermissions.length);
      permPoints = Math.min(grantedCount * perPermPoints, this.PERMISSION_WEIGHT);
      score += permPoints;
      coverage.push('PERMISSIONS');
      explanations.push(`${grantedCount} sensitive permission(s) granted → ${permPoints} pts`);
    } else {
      explanations.push('No sensitive permissions granted → 0 pts');
    }

    const permissionScore = permPoints;
    const permissionRiskLevel = this.classifyPermissionScore(permissionScore);

    // ---- 2. Usage-pattern evidence (0–15 pts) ----
    if (usageAccessGranted) {
      coverage.push('USAGE');
      let usagePoints = 0;
      if (appRisk.foregroundMinutes < 5) {
        usagePoints = this.USAGE_WEIGHT; // 15 pts (suspicious dormant retention)
      } else if (appRisk.foregroundMinutes < 15) {
        usagePoints = Math.floor((this.USAGE_WEIGHT * 2) / 3); // 10 pts (moderate)
      } else {
        usagePoints = Math.floor(this.USAGE_WEIGHT / 3); // 5 pts (low suspicion)
      }
      score += usagePoints;
      explanations.push(`Foreground ${appRisk.foregroundMinutes} min → ${usagePoints} pts`);
    } else {
      explanations.push('Usage Access not granted – usage evidence unavailable');
    }

    // ---- 3. Data-usage evidence (0–20 pts) ----
    if (dataUsage && dataUsage.available) {
      coverage.push('DATA_USAGE');
      const totalBytes = (dataUsage.mobileBytes ?? 0) + (dataUsage.wifiBytes ?? 0);
      let dataPoints = 0;
      if (totalBytes >= 100 * 1024 * 1024) {
        dataPoints = this.DATA_WEIGHT; // 20 pts (>=100 MiB)
      } else if (totalBytes >= 10 * 1024 * 1024) {
        dataPoints = Math.floor((this.DATA_WEIGHT * 2) / 3); // 13 pts (>=10 MiB)
      } else if (totalBytes > 0) {
        dataPoints = Math.floor(this.DATA_WEIGHT / 3); // 6 pts (> 0 B)
      } else {
        dataPoints = 0;
      }
      score += dataPoints;
      explanations.push(`Data usage ${Math.floor(totalBytes / 1024)} KB → ${dataPoints} pts`);
    } else {
      explanations.push('Data‑usage statistics unavailable (not counted as zero)');
    }

    // ---- 4. Network findings evidence (0–25 pts) ----
    if (networkFindings.length > 0) {
      coverage.push('NETWORK');
      let networkPoints = 0;
      for (const f of networkFindings) {
        const pts = f.severity === 'HIGH' ? 15 : f.severity === 'MEDIUM' ? 8 : 3;
        networkPoints += pts;
      }
      networkPoints = Math.min(networkPoints, this.NETWORK_WEIGHT);
      score += networkPoints;
      explanations.push(`${networkFindings.length} network finding(s) → ${networkPoints} pts`);
    } else {
      explanations.push('No network findings imported');
    }

    // Total clamped to 0–100
    const totalScore = Math.max(0, Math.min(score, this.MAX_TOTAL));

    // Authoritative combined level derived strictly from classifyRiskScore
    const level = this.classifyRiskScore(totalScore);

    return {
      totalScore,
      level,
      evidenceCoverage: coverage,
      explanations,
      permissionScore,
      permissionRiskLevel,
    };
  },
};
