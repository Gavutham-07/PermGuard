import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppRisk, ChangeEvent, ImportedFinding, ImportResult } from './types';
import { DatabaseHelper } from './storage/db';
import { PermissionScanner } from './engine/PermissionScanner';
import { ChangeDetector } from './engine/ChangeDetector';
import { DashboardScreen } from './components/DashboardScreen';
import { AppDetailScreen } from './components/AppDetailScreen';
import { FindingsScreen } from './components/FindingsScreen';
import { BurpImportModal } from './components/BurpImportModal';
import { GrantAccessModal } from './components/GrantAccessModal';
import { AppManagerModal } from './components/AppManagerModal';
import { BurpBridgeModal } from './components/BurpBridgeModal';
import { NotificationFeedModal } from './components/NotificationFeedModal';
import { InstalledAppMock } from './data/defaultApps';
import { PermGuardScannerPlugin } from './native/PermGuardScannerPlugin';

export function App() {
  const [riskList, setRiskList] = useState<AppRisk[]>([]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [lastScanTime, setLastScanTime] = useState<string | null>(null);
  const [focusedPackage, setFocusedPackage] = useState<string | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [showFindingsScreen, setShowFindingsScreen] = useState(false);
  const [importStatusMessage, setImportStatusMessage] = useState<string | null>(null);
  const [storedFindings, setStoredFindings] = useState<ImportedFinding[]>([]);
  const [usageAccessGranted, setUsageAccessGranted] = useState(true);

  // Persistent Change Events
  const [changeEvents, setChangeEvents] = useState<ChangeEvent[]>([]);
  const previousSnapshotRef = useRef<AppRisk[] | null>(null);

  // Continuous 5s Monitoring State & Toast
  const [isAutoMonitoring, setIsAutoMonitoring] = useState(true); // Default to ON for active live experience
  const [monitorInterval, setMonitorInterval] = useState(5); // Default 5 seconds
  const [liveToast, setLiveToast] = useState<{ message: string; type: 'info' | 'warning' | 'alert' } | null>(null);

  // Modals
  const [showBurpModal, setShowBurpModal] = useState(false);
  const [showGrantAccessModal, setShowGrantAccessModal] = useState(false);
  const [showAppManagerModal, setShowAppManagerModal] = useState(false);
  const [showBurpBridgeModal, setShowBurpBridgeModal] = useState(false);
  const [showNotificationsModal, setShowNotificationsModal] = useState(false);
  const [installedApps, setInstalledApps] = useState<InstalledAppMock[]>([]);

  // Load initial database data on mount
  useEffect(() => {
    const isGranted = DatabaseHelper.getUsageAccessGranted();
    setUsageAccessGranted(isGranted);

    const apps = DatabaseHelper.getInstalledApps();
    setInstalledApps(apps);

    const { results, scanTime } = DatabaseHelper.loadLastScan();
    const findings = DatabaseHelper.loadAllFindings();
    setStoredFindings(findings);

    const events = DatabaseHelper.loadChangeEvents();
    setChangeEvents(events);

    if (results.length > 0) {
      setRiskList(results);
      previousSnapshotRef.current = results;
      setLastScanTime(scanTime);
      setHasAnalyzed(true);
    } else {
      // Run automatic initial baseline scan
      runAnalysis('Initial scan', true);
    }

    // Sync any findings from local bridge server
    syncServerBridgeFindings();
  }, []);


  // ── Continuous 5-Second Incremental Polling Loop ──
  useEffect(() => {
    if (!isAutoMonitoring) return;

    const intervalId = setInterval(() => {
      // Perform fast differential scan
      const { updatedList, changedApps } = PermissionScanner.performIncrementalScan(riskList);

      if (changedApps.length > 0) {
        // Detect persistent change events for the delta
        if (previousSnapshotRef.current) {
          const detected = ChangeDetector.detectChanges(updatedList, previousSnapshotRef.current);
          if (detected.length > 0) {
            DatabaseHelper.saveChangeEvents(detected);
            setChangeEvents(DatabaseHelper.loadChangeEvents());
          }
        }

        // Show live toast for the first changed app
        const first = changedApps[0];
        const dir = first.delta > 0 ? `+${first.delta}` : `${first.delta}`;
        setLiveToast({
          message: `${first.app.appName}: score shifted from ${first.oldScore} to ${first.newScore} pts (${dir} pts &bull; ${first.app.combinedRiskLevel})`,
          type: Math.abs(first.delta) >= 5 ? 'alert' : 'info',
        });

        previousSnapshotRef.current = updatedList;
        setRiskList(updatedList);
        setLastScanTime(`Auto-Monitored (${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })})`);
      }
    }, monitorInterval * 1000);

    return () => clearInterval(intervalId);
  }, [isAutoMonitoring, monitorInterval, riskList]);

  // Auto-dismiss live toast after 5s
  useEffect(() => {
    if (liveToast) {
      const timer = setTimeout(() => setLiveToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [liveToast]);

  const syncServerBridgeFindings = async () => {
    try {
      const token = DatabaseHelper.getOrCreatePairingToken();
      const res = await fetch('/api/burp/events', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (Array.isArray(data.findings) && data.findings.length > 0) {
          const batchId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
          DatabaseHelper.saveFindings(data.findings, batchId);
          setStoredFindings(DatabaseHelper.loadAllFindings());
        }
      }
    } catch {
      // Bridge sync is best-effort
    }
  };

  const runAnalysis = useCallback(
    async (reason: string = 'Manual scan', isBaseline: boolean = false) => {
      if (isScanning) return;
      setIsScanning(true);
      try {
        const result = await PermissionScanner.performScan(reason);
        if (result) {
          const currentList = result.riskList;

          // Detect meaningful changes against previous snapshot
          if (!isBaseline && previousSnapshotRef.current) {
            const detected = ChangeDetector.detectChanges(currentList, previousSnapshotRef.current);
            if (detected.length > 0) {
              DatabaseHelper.saveChangeEvents(detected);
              setChangeEvents(DatabaseHelper.loadChangeEvents());
            }
          }

          previousSnapshotRef.current = currentList;
          setRiskList(currentList);
          setLastScanTime(result.formattedScanTime);
          setHasAnalyzed(true);
        }
      } finally {
        setIsScanning(false);
      }
    },
    [isScanning]
  );

  // Listen for return from native Android Settings
  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible') {
        const isGranted = await PermGuardScannerPlugin.checkUsageAccess();
        if (isGranted !== null && isGranted !== usageAccessGranted) {
          DatabaseHelper.setUsageAccessGranted(isGranted);
          setUsageAccessGranted(isGranted);
          runAnalysis('Returned from Android Settings');
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [usageAccessGranted, runAnalysis]);

  const handleOpenGrantAccess = async () => {
    if (PermGuardScannerPlugin.isNative()) {
      const opened = await PermGuardScannerPlugin.openUsageSettings();
      if (opened) return;
    }
    setShowGrantAccessModal(true);
  };

  const handleGrantAccessReturn = (didChange: boolean) => {
    setShowGrantAccessModal(false);
    if (didChange) {
      runAnalysis('Returned from Settings');
    }
  };

  const handleToggleUsageAccess = (granted: boolean) => {
    DatabaseHelper.setUsageAccessGranted(granted);
    setUsageAccessGranted(granted);
  };

  const handleImportSuccess = (result: ImportResult) => {
    if (result.findings.length > 0) {
      const batchId = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
      DatabaseHelper.saveFindings(result.findings, batchId);
      const updatedFindings = DatabaseHelper.loadAllFindings();
      setStoredFindings(updatedFindings);
    }

    const parts: string[] = [];
    parts.push(`Imported ${result.findings.length} finding(s)`);
    if (result.duplicatesSkipped > 0) {
      parts.push(`${result.duplicatesSkipped} duplicate(s) skipped`);
    }
    if (result.parseErrors.length > 0) {
      parts.push(`Errors: ${result.parseErrors.join('; ')}`);
    }

    setImportStatusMessage(parts.join(', '));
    runAnalysis('Findings imported');
  };

  const handleBridgeEventIngested = (finding: ImportedFinding, isDuplicate: boolean) => {
    if (!isDuplicate) {
      const batchId = 'bridge_' + Date.now();
      DatabaseHelper.saveFindings([finding], batchId);
      setStoredFindings(DatabaseHelper.loadAllFindings());
      setImportStatusMessage(`Bridge finding ingested: ${finding.issueType} (${finding.severity})`);
      runAnalysis('Bridge event ingested');
    } else {
      setImportStatusMessage(`Duplicate bridge event ignored: ${finding.issueType}`);
    }
  };

  const handleClearFindings = () => {
    DatabaseHelper.clearAllFindings();
    setStoredFindings([]);
    setImportStatusMessage('All findings cleared.');
    runAnalysis('Findings cleared');
  };

  const handleSaveApps = (updatedApps: InstalledAppMock[]) => {
    DatabaseHelper.saveInstalledApps(updatedApps);
    setInstalledApps(updatedApps);
    runAnalysis('App inventory updated');
  };

  const handleResetApps = () => {
    const res = DatabaseHelper.resetInstalledApps();
    setInstalledApps(res);
    runAnalysis('App inventory reset');
  };

  const handleDismissChangeEvent = (id: string) => {
    DatabaseHelper.dismissChangeEvent(id);
    setChangeEvents(DatabaseHelper.loadChangeEvents());
  };

  const handleClearAllChangeEvents = () => {
    DatabaseHelper.clearChangeEvents();
    setChangeEvents([]);
  };

  const focusedApp = focusedPackage ? riskList.find((a) => a.packageName === focusedPackage) : null;
  const focusedFindingsCount = focusedPackage
    ? storedFindings.filter((f) => f.attributedPackage === focusedPackage).length
    : 0;

  const unreadNotificationsCount = changeEvents.filter((e) => !e.dismissed).length;

  return (
    <div className="min-h-screen bg-[#E5E5E7] flex flex-col items-center">
      <div className="w-full max-w-md min-h-screen flex flex-col bg-[#F5F5F7] shadow-2xl">
        {focusedApp ? (
          <AppDetailScreen
            app={focusedApp}
            findingsCount={focusedFindingsCount}
            onBack={() => setFocusedPackage(null)}
          />
        ) : showFindingsScreen ? (
          <FindingsScreen
            findings={storedFindings}
            onBack={() => setShowFindingsScreen(false)}
            onClearFindings={handleClearFindings}
          />
        ) : (
          <DashboardScreen
            riskList={riskList}
            hasAnalyzed={hasAnalyzed}
            lastScanTime={lastScanTime}
            isScanning={isScanning}
            findingsCount={storedFindings.length}
            unreadNotificationsCount={unreadNotificationsCount}
            importStatusMessage={importStatusMessage}
            usageAccessGranted={usageAccessGranted}
            isAutoMonitoring={isAutoMonitoring}
            monitorInterval={monitorInterval}
            onToggleAutoMonitoring={() => setIsAutoMonitoring(!isAutoMonitoring)}
            onChangeMonitorInterval={(val) => setMonitorInterval(val)}
            liveToast={liveToast}
            onDismissToast={() => setLiveToast(null)}
            onStartClick={() => runAnalysis('Manual scan')}
            onGrantAccessClick={handleOpenGrantAccess}
            onAppClick={(app) => setFocusedPackage(app.packageName)}
            onImportBurpClick={() => setShowBurpModal(true)}
            onShowFindings={() => setShowFindingsScreen(true)}
            onOpenAppManager={() => setShowAppManagerModal(true)}
            onOpenBurpBridge={() => setShowBurpBridgeModal(true)}
            onOpenNotifications={() => setShowNotificationsModal(true)}
          />
        )}
      </div>

      {/* Modals */}
      <BurpBridgeModal
        isOpen={showBurpBridgeModal}
        onClose={() => setShowBurpBridgeModal(false)}
        onEventIngested={handleBridgeEventIngested}
      />

      <NotificationFeedModal
        isOpen={showNotificationsModal}
        onClose={() => setShowNotificationsModal(false)}
        events={changeEvents}
        onDismissEvent={handleDismissChangeEvent}
        onClearAll={handleClearAllChangeEvents}
      />

      <BurpImportModal
        isOpen={showBurpModal}
        onClose={() => setShowBurpModal(false)}
        existingFindings={storedFindings}
        onImportSuccess={handleImportSuccess}
      />

      <GrantAccessModal
        isOpen={showGrantAccessModal}
        onClose={handleGrantAccessReturn}
        isGranted={usageAccessGranted}
        onToggleAccess={handleToggleUsageAccess}
      />

      <AppManagerModal
        isOpen={showAppManagerModal}
        onClose={() => setShowAppManagerModal(false)}
        apps={installedApps}
        onSaveApps={handleSaveApps}
        onResetApps={handleResetApps}
      />
    </div>
  );
}

export default App;
