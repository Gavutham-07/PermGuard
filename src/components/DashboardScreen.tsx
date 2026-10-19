import React, { useState, useMemo } from 'react';
import { AppRisk, RiskLevel } from '../types';
import { formatBytes, getRiskColorClass } from '../utils/formatters';
import {
  Shield,
  RefreshCw,
  AlertTriangle,
  Database,
  SlidersHorizontal,
  Search,
  ArrowUpDown,
  Bell,
  Wifi,
  X,
  Radio,
  Play,
  Pause,
  Clock,
} from 'lucide-react';

export type SortOption =
  | 'NAME_ASC'
  | 'NAME_DESC'
  | 'SCORE_DESC'
  | 'SCORE_ASC'
  | 'LAST_CHANGED';

interface DashboardScreenProps {
  riskList: AppRisk[];
  hasAnalyzed: boolean;
  lastScanTime: string | null;
  isScanning: boolean;
  findingsCount: number;
  unreadNotificationsCount: number;
  importStatusMessage: string | null;
  usageAccessGranted: boolean;

  // Continuous monitoring props
  isAutoMonitoring: boolean;
  monitorInterval: number;
  onToggleAutoMonitoring: () => void;
  onChangeMonitorInterval: (interval: number) => void;
  liveToast: { message: string; type: 'info' | 'warning' | 'alert' } | null;
  onDismissToast: () => void;

  onStartClick: () => void;
  onGrantAccessClick: () => void;
  onAppClick: (app: AppRisk) => void;
  onImportBurpClick: () => void;
  onShowFindings: () => void;
  onOpenAppManager: () => void;
  onOpenBurpBridge: () => void;
  onOpenNotifications: () => void;
}

export const DashboardScreen: React.FC<DashboardScreenProps> = ({
  riskList,
  hasAnalyzed,
  lastScanTime,
  isScanning,
  findingsCount,
  unreadNotificationsCount,
  importStatusMessage,
  usageAccessGranted,
  isAutoMonitoring,
  monitorInterval,
  onToggleAutoMonitoring,
  onChangeMonitorInterval,
  liveToast,
  onDismissToast,
  onStartClick,
  onGrantAccessClick,
  onAppClick,
  onImportBurpClick,
  onShowFindings,
  onOpenAppManager,
  onOpenBurpBridge,
  onOpenNotifications,
}) => {
  // Search, Sort, Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('SCORE_DESC');
  const [selectedRiskFilter, setSelectedRiskFilter] = useState<'ALL' | RiskLevel>('ALL');

  // Summary counts based on authoritative combined risk level
  const highCount = riskList.filter((a) => a.combinedRiskLevel === 'HIGH').length;
  const mediumCount = riskList.filter((a) => a.combinedRiskLevel === 'MEDIUM').length;
  const lowCount = riskList.filter((a) => a.combinedRiskLevel === 'LOW').length;

  // Filtered & Sorted Apps with deterministic tie-breaking
  const filteredApps = useMemo(() => {
    let result = [...riskList];

    // 1. Search Query Filter
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(
        (app) =>
          app.appName.toLowerCase().includes(q) ||
          app.packageName.toLowerCase().includes(q)
      );
    }

    // 2. Risk Level Filter
    if (selectedRiskFilter !== 'ALL') {
      result = result.filter((app) => app.combinedRiskLevel === selectedRiskFilter);
    }

    // 3. Deterministic Sorting with secondary key
    result.sort((a, b) => {
      switch (sortOption) {
        case 'NAME_ASC': {
          const comp = a.appName.localeCompare(b.appName);
          return comp !== 0 ? comp : a.packageName.localeCompare(b.packageName);
        }
        case 'NAME_DESC': {
          const comp = b.appName.localeCompare(a.appName);
          return comp !== 0 ? comp : a.packageName.localeCompare(b.packageName);
        }
        case 'SCORE_ASC': {
          const delta = a.combinedScore - b.combinedScore;
          return delta !== 0 ? delta : a.packageName.localeCompare(b.packageName);
        }
        case 'LAST_CHANGED': {
          const aTime = a.lastChangedAt || a.lastUsedTime;
          const bTime = b.lastChangedAt || b.lastUsedTime;
          const comp = bTime.localeCompare(aTime);
          return comp !== 0 ? comp : b.combinedScore - a.combinedScore;
        }
        case 'SCORE_DESC':
        default: {
          const delta = b.combinedScore - a.combinedScore;
          return delta !== 0 ? delta : a.packageName.localeCompare(b.packageName);
        }
      }
    });

    return result;
  }, [riskList, searchQuery, sortOption, selectedRiskFilter]);

  const handleResetFilters = () => {
    setSearchQuery('');
    setSelectedRiskFilter('ALL');
    setSortOption('SCORE_DESC');
  };

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7] max-w-md mx-auto shadow-xl border-x border-gray-200 relative">
      {/* Live Toast Alert for Instant Notifications */}
      {liveToast && (
        <div className="fixed top-3 left-1/2 -translate-x-1/2 z-50 max-w-sm w-full px-4 animate-in fade-in slide-in-from-top-4 duration-200">
          <div
            className={`p-3 rounded-xl shadow-xl border flex items-start gap-2.5 ${
              liveToast.type === 'alert'
                ? 'bg-red-950 text-white border-red-500'
                : liveToast.type === 'warning'
                ? 'bg-amber-950 text-white border-amber-500'
                : 'bg-indigo-950 text-white border-indigo-500'
            }`}
          >
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse mt-0.5 shrink-0" />
            <div className="flex-1 text-xs">
              <div className="font-bold">Live Risk Score Change</div>
              <div className="text-[11px] opacity-90 mt-0.5">{liveToast.message}</div>
            </div>
            <button
              onClick={onDismissToast}
              className="text-white/60 hover:text-white p-0.5 rounded"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      )}

      {/* Top Header */}
      <header className="bg-[#1A237E] text-white pt-3.5 pb-4 px-4 shadow-md sticky top-0 z-10">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-6 h-6 text-[#C5CAE9]" />
            <div>
              <h1 className="text-[20px] font-bold tracking-tight leading-tight">PermGuard</h1>
              <p className="text-[11px] text-[#C5CAE9]">Silent Permission Abuse &amp; Risk Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Notification Change Feed Button */}
            <button
              onClick={onOpenNotifications}
              title="Change Detection Feed"
              className="relative p-2 rounded-lg bg-[#283593] hover:bg-[#303F9F] text-[#C5CAE9] transition-colors"
            >
              <Bell className="w-4 h-4" />
              {unreadNotificationsCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white font-bold text-[9px] w-4 h-4 rounded-full flex items-center justify-center animate-pulse">
                  {unreadNotificationsCount}
                </span>
              )}
            </button>

            {/* Burp Bridge Button */}
            <button
              onClick={onOpenBurpBridge}
              title="Burp Suite Real-Time Bridge"
              className="p-2 rounded-lg bg-[#283593] hover:bg-[#303F9F] text-[#C5CAE9] transition-colors flex items-center gap-1"
            >
              <Wifi className="w-4 h-4 text-emerald-400" />
              <span className="hidden sm:inline text-xs font-medium">Bridge</span>
            </button>

            {/* Packages Manager Button */}
            <button
              onClick={onOpenAppManager}
              title="Inspect Packages"
              className="p-2 rounded-lg bg-[#283593] hover:bg-[#303F9F] text-[#C5CAE9] transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Action Buttons Row */}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            onClick={onGrantAccessClick}
            className={`text-xs py-2 px-3 rounded font-medium border transition-colors flex items-center justify-center gap-1.5 ${
              usageAccessGranted
                ? 'border-emerald-400 text-emerald-200 bg-emerald-950/20'
                : 'border-white/80 text-white hover:bg-white/10'
            }`}
          >
            <span>{usageAccessGranted ? 'Usage Access: Granted' : 'Grant Access'}</span>
          </button>

          <button
            onClick={onStartClick}
            disabled={isScanning}
            className="text-xs py-2 px-3 rounded font-medium bg-[#3949AB] hover:bg-[#303F9F] text-white shadow-sm disabled:opacity-70 transition-all flex items-center justify-center gap-1.5"
          >
            {isScanning ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                <span>Scanning…</span>
              </>
            ) : (
              <span>Analyze Apps</span>
            )}
          </button>
        </div>

        {/* Continuous Monitoring Controls Strip */}
        <div className="mt-2.5 pt-2.5 border-t border-indigo-900/60 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <button
              onClick={onToggleAutoMonitoring}
              className={`px-2.5 py-1 rounded-md font-semibold text-[11px] flex items-center gap-1.5 transition-all ${
                isAutoMonitoring
                  ? 'bg-emerald-500 text-white shadow-xs'
                  : 'bg-white/10 text-white/80 hover:bg-white/20'
              }`}
            >
              {isAutoMonitoring ? (
                <>
                  <Pause className="w-3 h-3" />
                  <span>Monitoring: {monitorInterval}s</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3" />
                  <span>Start 5s Monitor</span>
                </>
              )}
            </button>

            {isAutoMonitoring && (
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
            )}
          </div>

          {/* Interval selector */}
          <div className="flex items-center gap-1 text-[11px] text-[#C5CAE9]">
            <Clock className="w-3 h-3" />
            <select
              value={monitorInterval}
              onChange={(e) => onChangeMonitorInterval(Number(e.target.value))}
              aria-label="Scan interval"
              className="bg-indigo-900/80 border border-indigo-700 text-white rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
            >
              <option value={3}>3s</option>
              <option value={5}>5s (Fast)</option>
              <option value={10}>10s</option>
              <option value={30}>30s</option>
            </select>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-3 space-y-2.5 pb-8">
        {/* Last Scan Time & Import Banner */}
        {lastScanTime && (
          <div className="text-[11px] text-gray-500 px-1 flex items-center justify-between">
            <span>Last scanned: {lastScanTime}</span>
            {isAutoMonitoring && (
              <span className="text-emerald-700 font-semibold flex items-center gap-1">
                &bull; Live Delta Updates Active
              </span>
            )}
          </div>
        )}

        {importStatusMessage && (
          <div className="bg-[#E8F5E9] border border-[#C8E6C9] rounded-lg p-2.5 text-[12px] text-[#2E7D32] shadow-xs">
            {importStatusMessage}
          </div>
        )}

        {/* Summary Risk Cards */}
        {hasAnalyzed && (
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => setSelectedRiskFilter(selectedRiskFilter === 'HIGH' ? 'ALL' : 'HIGH')}
              className={`rounded-xl p-2.5 text-center shadow-xs border transition-all ${
                selectedRiskFilter === 'HIGH'
                  ? 'bg-red-50 border-red-400 ring-2 ring-red-400'
                  : 'bg-white border-gray-100 hover:border-gray-300'
              }`}
            >
              <div className="text-[20px] font-bold text-[#E53935] leading-tight tabular-nums">{highCount}</div>
              <div className="text-[11px] text-gray-500 font-medium">HIGH (60+)</div>
            </button>
            <button
              onClick={() => setSelectedRiskFilter(selectedRiskFilter === 'MEDIUM' ? 'ALL' : 'MEDIUM')}
              className={`rounded-xl p-2.5 text-center shadow-xs border transition-all ${
                selectedRiskFilter === 'MEDIUM'
                  ? 'bg-amber-50 border-amber-400 ring-2 ring-amber-400'
                  : 'bg-white border-gray-100 hover:border-gray-300'
              }`}
            >
              <div className="text-[20px] font-bold text-[#FB8C00] leading-tight tabular-nums">{mediumCount}</div>
              <div className="text-[11px] text-gray-500 font-medium">MEDIUM (30-59)</div>
            </button>
            <button
              onClick={() => setSelectedRiskFilter(selectedRiskFilter === 'LOW' ? 'ALL' : 'LOW')}
              className={`rounded-xl p-2.5 text-center shadow-xs border transition-all ${
                selectedRiskFilter === 'LOW'
                  ? 'bg-emerald-50 border-emerald-400 ring-2 ring-emerald-400'
                  : 'bg-white border-gray-100 hover:border-gray-300'
              }`}
            >
              <div className="text-[20px] font-bold text-[#43A047] leading-tight tabular-nums">{lowCount}</div>
              <div className="text-[11px] text-gray-500 font-medium">LOW (0-29)</div>
            </button>
          </div>
        )}

        {/* Search, Sort, and Risk Filter Controls */}
        <div className="bg-white rounded-xl p-3 shadow-xs border border-gray-100 space-y-2.5">
          {/* Instant Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by app label or package..."
              className="w-full pl-9 pr-8 py-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1A237E] bg-gray-50/50"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-0.5"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Filter Tabs & Sort Dropdown */}
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-1 p-0.5 bg-gray-100 rounded-lg text-[11px] font-medium">
              {(['ALL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedRiskFilter(cat)}
                  className={`px-2.5 py-1 rounded-md transition-colors ${
                    selectedRiskFilter === cat
                      ? 'bg-white text-gray-900 font-bold shadow-xs'
                      : 'text-gray-500 hover:text-gray-900'
                  }`}
                >
                  {cat === 'ALL' ? 'All' : cat.charAt(0) + cat.slice(1).toLowerCase()}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-1">
              <ArrowUpDown className="w-3.5 h-3.5 text-gray-400" />
              <select
                value={sortOption}
                onChange={(e) => setSortOption(e.target.value as SortOption)}
                aria-label="Sort apps by"
                className="text-[11px] py-1 px-2 bg-gray-50 border border-gray-200 rounded-lg text-gray-700 font-medium focus:outline-none"
              >
                <option value="SCORE_DESC">Score (High &rarr; Low)</option>
                <option value="SCORE_ASC">Score (Low &rarr; High)</option>
                <option value="NAME_ASC">Name (A &rarr; Z)</option>
                <option value="NAME_DESC">Name (Z &rarr; A)</option>
                <option value="LAST_CHANGED">Last Changed</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-500 pt-1 border-t border-gray-100">
            <span>
              Showing <strong className="text-gray-800 tabular-nums">{filteredApps.length}</strong> of{' '}
              <strong className="text-gray-800 tabular-nums">{riskList.length}</strong> apps
            </span>
            {(searchQuery || selectedRiskFilter !== 'ALL') && (
              <button
                onClick={handleResetFilters}
                className="text-indigo-600 hover:text-indigo-800 font-medium hover:underline"
              >
                Reset filters
              </button>
            )}
          </div>
        </div>

        {/* Empty State */}
        {filteredApps.length === 0 && (
          <div className="bg-white rounded-xl p-8 text-center border border-gray-100 space-y-2">
            <Search className="w-8 h-8 text-gray-300 mx-auto" />
            <h3 className="font-bold text-gray-800 text-sm">No Applications Match Filter</h3>
            <p className="text-xs text-gray-500 max-w-xs mx-auto">
              No installed applications match &ldquo;{searchQuery || selectedRiskFilter}&rdquo;. Try clearing your query or adjusting the risk filter.
            </p>
            <button
              onClick={handleResetFilters}
              className="mt-2 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800 text-xs font-semibold rounded-lg transition-colors"
            >
              Show All Apps
            </button>
          </div>
        )}

        {/* App Risk Cards */}
        <div className="space-y-2">
          {filteredApps.map((app) => (
            <div
              key={app.packageName}
              onClick={() => onAppClick(app)}
              className={`bg-white rounded-xl p-3 shadow-xs border transition-all cursor-pointer select-none ${
                app.lastChangedAt && Date.now() - new Date(app.lastChangedAt).getTime() < 8000
                  ? 'border-indigo-500 ring-2 ring-indigo-400 bg-indigo-50/20'
                  : 'border-gray-100 hover:border-indigo-300 hover:shadow-md'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold text-[15px] text-gray-900 truncate flex-1">{app.appName}</h3>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded ${getRiskColorClass(
                      app.combinedRiskLevel
                    )}`}
                  >
                    {app.combinedRiskLevel}
                  </span>
                  <span className="text-[12px] text-gray-800 font-bold tabular-nums">
                    {app.combinedScore}pts
                  </span>
                </div>
              </div>

              <div className="text-[10px] text-gray-500 truncate mt-1">
                {app.packageName} &bull; {app.isSystemApp ? 'System Service' : 'User App'}
              </div>

              <div className="mt-2 text-[12px] text-gray-800 flex items-center justify-between">
                <span>
                  <span className="text-gray-500">Perms ({app.permissions.length}):</span>{' '}
                  {app.permissions.join(', ') || 'None'}
                </span>
                <span className="text-[11px] text-gray-500 font-medium shrink-0 ml-1">
                  Perm Score: <span className="text-gray-800 font-bold">{app.permissionScore}/40</span>
                </span>
              </div>

              <div className="text-[12px] text-[#555555] mt-0.5">
                Foreground (7d): {app.foregroundMinutes} min &bull; Last used: {app.lastUsedTime}
              </div>

              {app.dataUsage && app.dataUsage.available && (
                <div className="text-[12px] text-[#555555] mt-0.5">
                  Data: Mobile {formatBytes(app.dataUsage.mobileBytes)} / Wi-Fi {formatBytes(app.dataUsage.wifiBytes)}
                </div>
              )}

              {app.networkFindingsCount > 0 && (
                <div className="mt-1.5 flex items-center gap-1 text-[12px] text-[#E65100] font-medium">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  <span>{app.networkFindingsCount} Burp finding(s) attributed</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </main>
    </div>
  );
};
