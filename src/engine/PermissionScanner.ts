import { AppRisk, NetworkFinding, ScanResult } from '../types';
import { DatabaseHelper } from '../storage/db';
import { RiskEngine } from './RiskEngine';

let isScanInProgress = false;

export const PermissionScanner = {
  isScanning(): boolean {
    return isScanInProgress;
  },

  /**
   * Fast incremental scan that computes current risk scores and isolates
   * exactly which app(s) changed, updating changed apps in-place.
   */
  performIncrementalScan(currentList: AppRisk[]): {
    updatedList: AppRisk[];
    changedApps: { app: AppRisk; oldScore: number; newScore: number; delta: number }[];
  } {
    const usageGranted = DatabaseHelper.getUsageAccessGranted();
    const installedApps = DatabaseHelper.getInstalledApps();
    const allFindings = DatabaseHelper.loadAllFindings();

    const currentMap = new Map<string, AppRisk>();
    for (const a of currentList) {
      currentMap.set(a.packageName, a);
    }

    const updatedList: AppRisk[] = [];
    const changedApps: { app: AppRisk; oldScore: number; newScore: number; delta: number }[] = [];

    for (const app of installedApps) {
      const grantedPermissions = app.permissions.filter((p) =>
        RiskEngine.sensitivePermissions.includes(p)
      );

      if (grantedPermissions.length > 0) {
        const foregroundMinutes = usageGranted ? app.foregroundMinutes : 0;
        const lastUsedTime = usageGranted ? app.lastUsedTime : 'Usage access missing';

        const legacyRisk = RiskEngine.legacyCalculateRisk(
          grantedPermissions.length,
          foregroundMinutes
        );

        const dataUsage = usageGranted
          ? app.dataUsage
          : { mobileBytes: null, wifiBytes: null, available: false };

        const packageFindings: NetworkFinding[] = allFindings
          .filter((f) => f.attributedPackage === app.packageName)
          .map((f) => ({ severity: f.severity, confidence: f.confidence || 'HIGH' }));

        const combinedResult = RiskEngine.computeCombinedRisk(
          { permissions: grantedPermissions, foregroundMinutes },
          usageGranted,
          dataUsage,
          packageFindings
        );

        const newAppRisk: AppRisk = {
          appName: app.appName,
          packageName: app.packageName,
          permissions: grantedPermissions,
          foregroundMinutes,
          permissionScore: combinedResult.permissionScore,
          permissionRiskLevel: combinedResult.permissionRiskLevel,
          combinedScore: combinedResult.totalScore,
          combinedRiskLevel: combinedResult.level,
          riskLevel: combinedResult.level,
          legacyRiskLevel: legacyRisk,
          isSystemApp: app.isSystemApp,
          lastUsedTime,
          dataUsage,
          scoreExplanations: combinedResult.explanations,
          networkFindingsCount: packageFindings.length,
        };

        const existing = currentMap.get(app.packageName);
        if (existing) {
          const scoreDelta = newAppRisk.combinedScore - existing.combinedScore;
          const permsChanged =
            [...newAppRisk.permissions].sort().join(',') !== [...existing.permissions].sort().join(',');
          const findingsChanged = newAppRisk.networkFindingsCount !== existing.networkFindingsCount;

          if (scoreDelta !== 0 || permsChanged || findingsChanged) {
            newAppRisk.lastChangedAt = new Date().toISOString();
            changedApps.push({
              app: newAppRisk,
              oldScore: existing.combinedScore,
              newScore: newAppRisk.combinedScore,
              delta: scoreDelta,
            });
            updatedList.push(newAppRisk);
          } else {
            // Keep existing app instance unchanged
            updatedList.push(existing);
          }
        } else {
          // Newly added app
          changedApps.push({
            app: newAppRisk,
            oldScore: 0,
            newScore: newAppRisk.combinedScore,
            delta: newAppRisk.combinedScore,
          });
          updatedList.push(newAppRisk);
        }
      }
    }

    if (changedApps.length > 0) {
      DatabaseHelper.saveScanResults(
        updatedList,
        `Auto-Monitored (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`
      );
    }

    return { updatedList, changedApps };
  },

  performScan(scanReason: string = 'Manual scan'): Promise<ScanResult | null> {
    if (isScanInProgress) return Promise.resolve(null);
    isScanInProgress = true;

    return new Promise((resolve) => {
      setTimeout(() => {
        try {
          const usageGranted = DatabaseHelper.getUsageAccessGranted();
          const installedApps = DatabaseHelper.getInstalledApps();
          const allFindings = DatabaseHelper.loadAllFindings();

          const riskList: AppRisk[] = [];

          for (const app of installedApps) {
            const grantedPermissions = app.permissions.filter((p) =>
              RiskEngine.sensitivePermissions.includes(p)
            );

            if (grantedPermissions.length > 0) {
              const foregroundMinutes = usageGranted ? app.foregroundMinutes : 0;
              const lastUsedTime = usageGranted ? app.lastUsedTime : 'Usage access missing';

              const legacyRisk = RiskEngine.legacyCalculateRisk(
                grantedPermissions.length,
                foregroundMinutes
              );

              const dataUsage = usageGranted
                ? app.dataUsage
                : { mobileBytes: null, wifiBytes: null, available: false };

              const packageFindings: NetworkFinding[] = allFindings
                .filter((f) => f.attributedPackage === app.packageName)
                .map((f) => ({ severity: f.severity, confidence: f.confidence || 'HIGH' }));

              const combinedResult = RiskEngine.computeCombinedRisk(
                {
                  permissions: grantedPermissions,
                  foregroundMinutes,
                },
                usageGranted,
                dataUsage,
                packageFindings
              );

              riskList.push({
                appName: app.appName,
                packageName: app.packageName,
                permissions: grantedPermissions,
                foregroundMinutes,
                permissionScore: combinedResult.permissionScore,
                permissionRiskLevel: combinedResult.permissionRiskLevel,
                combinedScore: combinedResult.totalScore,
                combinedRiskLevel: combinedResult.level,
                riskLevel: combinedResult.level,
                legacyRiskLevel: legacyRisk,
                isSystemApp: app.isSystemApp,
                lastUsedTime,
                dataUsage,
                scoreExplanations: combinedResult.explanations,
                networkFindingsCount: packageFindings.length,
              });
            }
          }

          // Deterministic sorting with stable secondary key:
          riskList.sort((a, b) => {
            if (a.isSystemApp !== b.isSystemApp) {
              return a.isSystemApp ? 1 : -1;
            }
            if (b.combinedScore !== a.combinedScore) {
              return b.combinedScore - a.combinedScore;
            }
            return a.packageName.localeCompare(b.packageName);
          });

          const now = new Date();
          const formattedScanTime = `${now.toLocaleDateString('en-GB', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
          })}, ${now.toLocaleTimeString('en-US', {
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
          })} (${scanReason})`;

          DatabaseHelper.saveScanResults(riskList, formattedScanTime);

          resolve({
            riskList,
            formattedScanTime,
            scanReason,
            usageAccessGranted: usageGranted,
          });
        } finally {
          isScanInProgress = false;
        }
      }, 400);
    });
  },
};
