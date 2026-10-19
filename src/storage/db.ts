import { AppRisk, ChangeEvent, ImportedFinding, RiskLevel } from '../types';
import { INITIAL_INSTALLED_APPS, InstalledAppMock } from '../data/defaultApps';
import { RiskEngine } from '../engine/RiskEngine';

const STORAGE_KEYS = {
  SCANS: 'permguard_scan_results',
  SCAN_TIME: 'permguard_scan_time',
  FINDINGS: 'permguard_findings',
  USAGE_ACCESS: 'permguard_usage_access_granted',
  INSTALLED_APPS: 'permguard_installed_apps',
  CHANGE_EVENTS: 'permguard_change_events',
  PAIRING_TOKEN: 'permguard_pairing_token',
};

// Safe storage wrapper working in both browser and Node/unit-test environments
const memoryFallback = new Map<string, string>();
const safeStorage = {
  getItem(key: string): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(key);
    }
    return memoryFallback.get(key) ?? null;
  },
  setItem(key: string, value: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, value);
    } else {
      memoryFallback.set(key, value);
    }
  },
  removeItem(key: string): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(key);
    } else {
      memoryFallback.delete(key);
    }
  },
};

export const DatabaseHelper = {
  // ── Usage Access State ──
  getUsageAccessGranted(): boolean {
    const val = safeStorage.getItem(STORAGE_KEYS.USAGE_ACCESS);
    if (val === null) return true;
    return val === 'true';
  },

  setUsageAccessGranted(granted: boolean): void {
    safeStorage.setItem(STORAGE_KEYS.USAGE_ACCESS, String(granted));
  },

  // ── Pairing Token Management (Cryptographically Secure) ──
  getOrCreatePairingToken(): string {
    let token = safeStorage.getItem(STORAGE_KEYS.PAIRING_TOKEN);
    if (!token) {
      token = this.generateNewPairingToken();
    }
    return token;
  },

  generateNewPairingToken(): string {
    const array = new Uint8Array(24);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
      crypto.getRandomValues(array);
    } else {
      for (let i = 0; i < array.length; i++) {
        array[i] = Math.floor(Math.random() * 256);
      }
    }
    const token = 'pg_sec_' + Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
    safeStorage.setItem(STORAGE_KEYS.PAIRING_TOKEN, token);
    return token;
  },

  // ── Installed Apps Repository ──
  getInstalledApps(): InstalledAppMock[] {
    const raw = safeStorage.getItem(STORAGE_KEYS.INSTALLED_APPS);
    if (!raw) {
      safeStorage.setItem(STORAGE_KEYS.INSTALLED_APPS, JSON.stringify(INITIAL_INSTALLED_APPS));
      return INITIAL_INSTALLED_APPS;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return INITIAL_INSTALLED_APPS;
    }
  },

  saveInstalledApps(apps: InstalledAppMock[]): void {
    safeStorage.setItem(STORAGE_KEYS.INSTALLED_APPS, JSON.stringify(apps));
  },

  resetInstalledApps(): InstalledAppMock[] {
    safeStorage.setItem(STORAGE_KEYS.INSTALLED_APPS, JSON.stringify(INITIAL_INSTALLED_APPS));
    return INITIAL_INSTALLED_APPS;
  },

  // ── Scan Results & Safe Deterministic Reconciliation ──
  saveScanResults(results: AppRisk[], scanTime: string): void {
    const reconciled = results.map((r) => {
      const combinedScore = Math.max(0, Math.min(100, Math.round(r.combinedScore ?? 0)));
      const combinedRiskLevel = RiskEngine.classifyRiskScore(combinedScore);
      const permissionScore = Math.max(0, Math.min(40, Math.round(r.permissionScore ?? 0)));
      const permissionRiskLevel = RiskEngine.classifyPermissionScore(permissionScore);
      return {
        ...r,
        combinedScore,
        combinedRiskLevel,
        riskLevel: combinedRiskLevel,
        permissionScore,
        permissionRiskLevel,
      };
    });

    safeStorage.setItem(STORAGE_KEYS.SCANS, JSON.stringify(reconciled));
    safeStorage.setItem(STORAGE_KEYS.SCAN_TIME, scanTime);
  },

  loadLastScan(): { results: AppRisk[]; scanTime: string | null } {
    const rawScans = safeStorage.getItem(STORAGE_KEYS.SCANS);
    const scanTime = safeStorage.getItem(STORAGE_KEYS.SCAN_TIME);
    if (!rawScans) return { results: [], scanTime: null };
    try {
      const rawList: any[] = JSON.parse(rawScans);
      const results: AppRisk[] = rawList.map((r) => {
        const combinedScore = Math.max(0, Math.min(100, Math.round(r.combinedScore ?? 0)));
        const combinedRiskLevel = RiskEngine.classifyRiskScore(combinedScore);
        const permissionScore = Math.max(0, Math.min(40, Math.round(r.permissionScore ?? 0)));
        const permissionRiskLevel = RiskEngine.classifyPermissionScore(permissionScore);

        return {
          appName: r.appName || 'Unknown App',
          packageName: r.packageName || '',
          permissions: Array.isArray(r.permissions) ? r.permissions : [],
          foregroundMinutes: Number(r.foregroundMinutes) || 0,
          permissionScore,
          permissionRiskLevel,
          combinedScore,
          combinedRiskLevel,
          riskLevel: combinedRiskLevel,
          legacyRiskLevel: (r.legacyRiskLevel || r.riskLevel) as RiskLevel,
          isSystemApp: Boolean(r.isSystemApp),
          lastUsedTime: r.lastUsedTime || 'Unknown',
          dataUsage: r.dataUsage || null,
          scoreExplanations: Array.isArray(r.scoreExplanations) ? r.scoreExplanations : [],
          networkFindingsCount: Number(r.networkFindingsCount) || 0,
          lastChangedAt: r.lastChangedAt,
        };
      });
      return { results, scanTime };
    } catch {
      return { results: [], scanTime: null };
    }
  },

  clearScanHistory(): void {
    safeStorage.removeItem(STORAGE_KEYS.SCANS);
    safeStorage.removeItem(STORAGE_KEYS.SCAN_TIME);
  },

  // ── Network Findings ──
  saveFindings(newFindings: ImportedFinding[], batchId: string): number {
    if (newFindings.length === 0) return 0;
    const all = this.loadAllFindings();
    const existingKeys = new Set(all.map((f) => `${f.severity}|${f.host}|${f.path}|${f.issueType}`));

    const accepted: ImportedFinding[] = [];
    newFindings.forEach((f, idx) => {
      const key = `${f.severity}|${f.host}|${f.path}|${f.issueType}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        accepted.push({
          ...f,
          id: Date.now() + idx,
          importBatch: batchId,
        });
      }
    });

    if (accepted.length > 0) {
      const updated = [...accepted, ...all];
      safeStorage.setItem(STORAGE_KEYS.FINDINGS, JSON.stringify(updated));
    }
    return accepted.length;
  },

  loadAllFindings(): ImportedFinding[] {
    const raw = safeStorage.getItem(STORAGE_KEYS.FINDINGS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  findingsForPackage(packageName: string): ImportedFinding[] {
    return this.loadAllFindings().filter((f) => f.attributedPackage === packageName);
  },

  clearAllFindings(): void {
    safeStorage.removeItem(STORAGE_KEYS.FINDINGS);
  },

  // ── Change Events Management ──
  saveChangeEvents(newEvents: ChangeEvent[]): void {
    if (newEvents.length === 0) return;
    const current = this.loadChangeEvents();
    const combined = [...newEvents, ...current].slice(0, 100);
    safeStorage.setItem(STORAGE_KEYS.CHANGE_EVENTS, JSON.stringify(combined));
  },

  loadChangeEvents(): ChangeEvent[] {
    const raw = safeStorage.getItem(STORAGE_KEYS.CHANGE_EVENTS);
    if (!raw) return [];
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  },

  dismissChangeEvent(id: string): void {
    const events = this.loadChangeEvents().map((e) =>
      e.id === id ? { ...e, dismissed: true } : e
    );
    safeStorage.setItem(STORAGE_KEYS.CHANGE_EVENTS, JSON.stringify(events));
  },

  clearChangeEvents(): void {
    safeStorage.removeItem(STORAGE_KEYS.CHANGE_EVENTS);
  },
};
