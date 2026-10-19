import { InstalledAppMock } from '../data/defaultApps';

export interface RealScanResult {
  apps: InstalledAppMock[];
  usageAccessGranted: boolean;
  totalAudited: number;
  totalInstalled: number;
}

export const PermGuardScannerPlugin = {
  isNative(): boolean {
    if (typeof window === 'undefined') return false;
    const cap = (window as any).Capacitor;
    return Boolean(cap && cap.isNativePlatform && cap.isNativePlatform());
  },

  async checkUsageAccess(): Promise<boolean | null> {
    if (!this.isNative()) return null;
    try {
      const cap = (window as any).Capacitor;
      if (cap?.Plugins?.PermGuardScanner?.checkUsageAccess) {
        const res = await cap.Plugins.PermGuardScanner.checkUsageAccess();
        return Boolean(res.granted);
      }
    } catch (e) {
      console.warn('Native checkUsageAccess failed', e);
    }
    return null;
  },

  async openUsageSettings(): Promise<boolean> {
    if (!this.isNative()) return false;
    try {
      const cap = (window as any).Capacitor;
      if (cap?.Plugins?.PermGuardScanner?.openUsageSettings) {
        await cap.Plugins.PermGuardScanner.openUsageSettings();
        return true;
      }
    } catch (e) {
      console.warn('Native openUsageSettings failed', e);
    }
    return false;
  },

  async scanRealInstalledApps(): Promise<RealScanResult | null> {
    if (!this.isNative()) return null;
    try {
      const cap = (window as any).Capacitor;
      if (cap?.Plugins?.PermGuardScanner?.scanRealInstalledApps) {
        const result = await cap.Plugins.PermGuardScanner.scanRealInstalledApps();
        if (result && Array.isArray(result.apps)) {
          return {
            apps: result.apps,
            usageAccessGranted: Boolean(result.usageAccessGranted),
            totalAudited: result.totalAudited || result.apps.length,
            totalInstalled: result.totalInstalled || result.apps.length,
          };
        }
      }
    } catch (e) {
      console.warn('Native scanRealInstalledApps failed, falling back to mock apps', e);
    }
    return null;
  },
};
