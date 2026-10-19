import React from 'react';
import { AppRisk } from '../types';
import { formatBytes, getRiskColorClass, getRiskHexColor } from '../utils/formatters';
import { ArrowLeft, AlertCircle, Shield, Network, Activity, Cpu } from 'lucide-react';

interface AppDetailScreenProps {
  app: AppRisk;
  findingsCount: number;
  onBack: () => void;
}

export const AppDetailScreen: React.FC<AppDetailScreenProps> = ({ app, findingsCount, onBack }) => {
  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7] max-w-md mx-auto shadow-xl border-x border-gray-200">
      {/* Top App Header */}
      <header className="bg-[#1A237E] text-white pt-3 pb-4 px-4 shadow-md sticky top-0 z-10">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-white hover:text-[#C5CAE9] text-sm font-medium py-1 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="mt-2">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">{app.appName}</h1>
          <p className="text-[11px] text-[#C5CAE9] truncate mt-0.5 font-mono">{app.packageName}</p>
        </div>
      </header>

      {/* Detail Content */}
      <main className="flex-1 p-3 space-y-3 pb-8">
        {/* Card 1: Explicit Score Separation */}
        <div className="bg-white rounded-xl p-4 shadow-xs border border-gray-100 space-y-3">
          <div className="grid grid-cols-2 gap-3 pb-3 border-b border-gray-100">
            {/* Permission-Only Risk */}
            <div>
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                Permission Score (0–40)
              </div>
              <div className="flex items-baseline gap-1 mt-0.5">
                <span className="text-[22px] font-bold text-gray-900 tabular-nums">
                  {app.permissionScore}
                </span>
                <span className="text-xs text-gray-400">/40 pts</span>
              </div>
              <div className="mt-1">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${getRiskColorClass(
                    app.permissionRiskLevel
                  )}`}
                >
                  {app.permissionRiskLevel} PERM RISK
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Threshold: Low &le;15, Med 16–31, High &ge;32
              </p>
            </div>

            {/* Authoritative Combined Risk */}
            <div className="text-right">
              <div className="text-[11px] font-bold text-indigo-900 uppercase tracking-wider">
                Combined Score (0–100)
              </div>
              <div className="flex items-baseline justify-end gap-1 mt-0.5">
                <span
                  className="text-[24px] font-bold tabular-nums"
                  style={{ color: getRiskHexColor(app.combinedRiskLevel) }}
                >
                  {app.combinedScore}
                </span>
                <span className="text-xs text-gray-400">/100 pts</span>
              </div>
              <div className="mt-1 flex justify-end">
                <span
                  className={`text-[10px] font-bold px-2 py-0.5 rounded ${getRiskColorClass(
                    app.combinedRiskLevel
                  )}`}
                >
                  {app.combinedRiskLevel} RISK
                </span>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Threshold: Low &le;29, Med 30–59, High &ge;60
              </p>
            </div>
          </div>

          {app.networkFindingsCount > 0 && (
            <div className="flex items-center gap-1.5 text-[12px] text-[#E65100] font-medium bg-amber-50 p-2 rounded-lg">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>
                &empty; {findingsCount} Burp vulnerability finding(s) attributed to this package
              </span>
            </div>
          )}
        </div>

        {/* Card 2: 4-Bucket Evidence & Score Explanations */}
        <div className="bg-white rounded-xl p-4 shadow-xs border border-gray-100">
          <h2 className="text-[14px] font-bold text-gray-900 mb-2.5">
            4-Bucket Evidence Justification
          </h2>

          <div className="space-y-2 text-[12px]">
            {app.scoreExplanations.map((line, idx) => {
              const isPoints = line.includes('pts');
              const isUnavailable = line.includes('unavailable') || line.includes('not granted');
              return (
                <div
                  key={idx}
                  className={`p-2 rounded-lg border flex items-start gap-2 ${
                    isUnavailable
                      ? 'bg-gray-50 border-gray-200 text-gray-500 italic'
                      : isPoints
                      ? 'bg-blue-50/40 border-blue-100 text-gray-800'
                      : 'bg-gray-50 border-gray-100 text-gray-700'
                  }`}
                >
                  <span className="font-bold text-indigo-700 select-none">&bull;</span>
                  <span className="flex-1">{line}</span>
                  {isUnavailable && (
                    <span className="text-[10px] font-semibold text-gray-400 shrink-0">
                      Unavailable (No points)
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div className="mt-3.5 pt-3 border-t border-gray-100 flex items-start gap-1.5 text-[11px] text-[#795548] bg-amber-50/50 p-2.5 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              <strong>Heuristic Notice:</strong> This score is a heuristic risk indicator only. A high score flags dormant permission retention or unencrypted transmissions, not confirmed malicious intent.
            </span>
          </div>
        </div>

        {/* Card 3: App Information */}
        <div className="bg-white rounded-xl p-4 shadow-xs border border-gray-100">
          <h2 className="text-[14px] font-bold text-gray-900 mb-2">App Information</h2>
          <div className="divide-y divide-gray-100 text-xs">
            <div className="py-2">
              <div className="text-[11px] text-gray-500">Package Type</div>
              <div className="text-[13px] font-medium text-gray-800">
                {app.isSystemApp ? 'System Service (Pre-installed in OS partition)' : 'User Application'}
              </div>
            </div>
            <div className="py-2">
              <div className="text-[11px] text-gray-500">Sensitive Permissions Granted</div>
              <div className="text-[13px] font-medium text-gray-800">
                {app.permissions.join(', ') || 'None'}
              </div>
            </div>
            <div className="py-2">
              <div className="text-[11px] text-gray-500">Last Used Timestamp</div>
              <div className="text-[13px] font-medium text-gray-800">{app.lastUsedTime}</div>
            </div>
            <div className="py-2">
              <div className="text-[11px] text-gray-500">Foreground Active Time (Last 7 days)</div>
              <div className="text-[13px] font-medium text-gray-800">
                {app.foregroundMinutes} min{' '}
                <span className="text-[11px] text-gray-500 font-normal">
                  ({app.foregroundMinutes < 5 ? 'Suspicious dormant usage with sensitive access' : 'Active user app'})
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Card 4: Network Data Usage */}
        <div className="bg-white rounded-xl p-4 shadow-xs border border-gray-100">
          <h2 className="text-[14px] font-bold text-gray-900 mb-2">
            Network Data Usage (7 days)
          </h2>
          {app.dataUsage && app.dataUsage.available ? (
            <div className="divide-y divide-gray-100 text-xs">
              <div className="py-2">
                <div className="text-[11px] text-gray-500">Mobile data</div>
                <div className="text-[13px] font-medium text-gray-800">
                  {formatBytes(app.dataUsage.mobileBytes)}
                </div>
              </div>
              <div className="py-2">
                <div className="text-[11px] text-gray-500">Wi-Fi data</div>
                <div className="text-[13px] font-medium text-gray-800">
                  {formatBytes(app.dataUsage.wifiBytes)}
                </div>
              </div>
              <div className="py-2">
                <div className="text-[11px] text-gray-500">Total Consumption</div>
                <div className="text-[13px] font-medium text-gray-800">
                  {formatBytes(
                    (app.dataUsage.mobileBytes ?? 0) + (app.dataUsage.wifiBytes ?? 0)
                  )}
                </div>
              </div>
              <div className="pt-2 text-[11px] text-gray-400">
                Note: Evaluated across 7-day volume totals, distinguishing zero bytes from unavailable counters.
              </div>
            </div>
          ) : (
            <p className="text-[12px] text-gray-500 leading-relaxed">
              Unavailable &mdash; Network stats require PACKAGE_USAGE_STATS permission to be granted. On emulators or restricted environments, data consumption is preserved as unavailable.
            </p>
          )}
        </div>
      </main>
    </div>
  );
};
