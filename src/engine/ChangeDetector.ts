import { AppRisk, ChangeEvent, ChangeEventType } from '../types';

export const ChangeDetector = {
  SCORE_CHANGE_THRESHOLD: 5,

  /**
   * Compares the current scan list against a previous snapshot.
   * If previousSnapshot is empty or null, treats this as baseline creation (no spurious alerts).
   */
  detectChanges(currentApps: AppRisk[], previousSnapshot: AppRisk[] | null): ChangeEvent[] {
    if (!previousSnapshot || previousSnapshot.length === 0) {
      // Baseline establishment: do not notify
      return [];
    }

    const previousMap = new Map<string, AppRisk>();
    for (const app of previousSnapshot) {
      previousMap.set(app.packageName, app);
    }

    const events: ChangeEvent[] = [];
    const nowIso = new Date().toISOString();

    for (const current of currentApps) {
      const prev = previousMap.get(current.packageName);
      if (!prev) {
        // App newly audited or newly installed
        events.push({
          id: `new_app_${current.packageName}_${Date.now()}`,
          timestamp: nowIso,
          packageName: current.packageName,
          appName: current.appName,
          type: 'PERMISSION_CHANGED',
          description: `New package audited with ${current.permissions.length} sensitive permission(s).`,
          newScore: current.combinedScore,
          newCategory: current.combinedRiskLevel,
        });
        continue;
      }

      // 1. Actual Permission Set Changes
      const currentPermsSorted = [...current.permissions].sort().join(',');
      const prevPermsSorted = [...prev.permissions].sort().join(',');

      if (currentPermsSorted !== prevPermsSorted) {
        const added = current.permissions.filter((p) => !prev.permissions.includes(p));
        const removed = prev.permissions.filter((p) => !current.permissions.includes(p));

        const diffParts: string[] = [];
        if (added.length > 0) diffParts.push(`Granted: ${added.join(', ')}`);
        if (removed.length > 0) diffParts.push(`Revoked: ${removed.join(', ')}`);

        events.push({
          id: `perm_${current.packageName}_${Date.now()}`,
          timestamp: nowIso,
          packageName: current.packageName,
          appName: current.appName,
          type: 'PERMISSION_CHANGED',
          description: `Permission set modified: ${diffParts.join('; ')}`,
          oldScore: prev.combinedScore,
          newScore: current.combinedScore,
          oldCategory: prev.combinedRiskLevel,
          newCategory: current.combinedRiskLevel,
        });
      }

      // 2. Newly Ingested Network Findings
      if (current.networkFindingsCount > prev.networkFindingsCount) {
        const delta = current.networkFindingsCount - prev.networkFindingsCount;
        events.push({
          id: `finding_${current.packageName}_${Date.now()}`,
          timestamp: nowIso,
          packageName: current.packageName,
          appName: current.appName,
          type: 'NEW_FINDING',
          description: `${delta} new validated vulnerability finding(s) attributed to ${current.appName}.`,
          oldScore: prev.combinedScore,
          newScore: current.combinedScore,
          oldCategory: prev.combinedRiskLevel,
          newCategory: current.combinedRiskLevel,
        });
      }

      // 3. Category Transition
      if (current.combinedRiskLevel !== prev.combinedRiskLevel) {
        events.push({
          id: `cat_${current.packageName}_${Date.now()}`,
          timestamp: nowIso,
          packageName: current.packageName,
          appName: current.appName,
          type: 'CATEGORY_TRANSITION',
          description: `Risk category shifted from ${prev.combinedRiskLevel} to ${current.combinedRiskLevel} (${prev.combinedScore} → ${current.combinedScore} pts).`,
          oldScore: prev.combinedScore,
          newScore: current.combinedScore,
          oldCategory: prev.combinedRiskLevel,
          newCategory: current.combinedRiskLevel,
        });
      }
      // 4. Meaningful Score Delta (>= 5 pts) without Category Transition
      else if (Math.abs(current.combinedScore - prev.combinedScore) >= this.SCORE_CHANGE_THRESHOLD) {
        const delta = current.combinedScore - prev.combinedScore;
        const dir = delta > 0 ? `+${delta}` : `${delta}`;
        events.push({
          id: `score_${current.packageName}_${Date.now()}`,
          timestamp: nowIso,
          packageName: current.packageName,
          appName: current.appName,
          type: 'SCORE_DELTA',
          description: `Combined risk score shifted by ${dir} pts (${prev.combinedScore} → ${current.combinedScore} pts).`,
          oldScore: prev.combinedScore,
          newScore: current.combinedScore,
          oldCategory: prev.combinedRiskLevel,
          newCategory: current.combinedRiskLevel,
        });
      }
    }

    return events;
  },
};
