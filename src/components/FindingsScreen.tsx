import React, { useState } from 'react';
import { ImportedFinding } from '../types';
import { getRiskColorClass } from '../utils/formatters';
import { ArrowLeft, Trash2, ShieldAlert } from 'lucide-react';

interface FindingsScreenProps {
  findings: ImportedFinding[];
  onBack: () => void;
  onClearFindings: () => void;
}

export const FindingsScreen: React.FC<FindingsScreenProps> = ({
  findings,
  onBack,
  onClearFindings,
}) => {
  const [showConfirmClear, setShowConfirmClear] = useState(false);

  return (
    <div className="flex flex-col min-h-screen bg-[#F5F5F7] max-w-md mx-auto shadow-xl border-x border-gray-200">
      {/* Top Header */}
      <header className="bg-[#1A237E] text-white pt-3 pb-4 px-4 shadow-md sticky top-0 z-10">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-white hover:text-[#C5CAE9] text-sm font-medium py-1 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back</span>
        </button>
        <div className="flex items-center justify-between mt-2">
          <h1 className="text-[20px] font-bold tracking-tight">Imported Findings</h1>
          {findings.length > 0 && (
            <button
              onClick={() => setShowConfirmClear(true)}
              className="text-xs text-[#EF9A9A] hover:text-red-300 font-medium px-2 py-1 rounded hover:bg-white/10 transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}
        </div>
      </header>

      {/* Confirmation Modal */}
      {showConfirmClear && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-5 max-w-sm w-full shadow-2xl space-y-3">
            <h3 className="text-base font-bold text-gray-900">Clear all findings?</h3>
            <p className="text-sm text-gray-600">
              This will permanently delete all imported Burp findings. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setShowConfirmClear(false)}
                className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setShowConfirmClear(false);
                  onClearFindings();
                }}
                className="px-3 py-1.5 text-sm font-bold text-white bg-[#E53935] hover:bg-red-700 rounded-lg transition-colors"
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      <main className="flex-1 p-3 space-y-2.5 pb-8">
        {findings.length === 0 ? (
          <div className="py-20 flex flex-col items-center justify-center text-center px-4 space-y-2">
            <ShieldAlert className="w-12 h-12 text-gray-300 stroke-[1.5]" />
            <p className="text-sm font-medium text-gray-600">No findings imported yet.</p>
            <p className="text-xs text-gray-400 max-w-xs">
              Use &lsquo;<strong>Import Burp</strong>&rsquo; on the dashboard to import a Burp XML export or a PermGuard CSV file.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {findings.map((finding, idx) => (
              <div
                key={finding.id ?? idx}
                className="bg-white rounded-xl p-3 shadow-xs border border-gray-100 space-y-1.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-[14px] text-gray-900 flex-1 leading-snug">
                    {finding.issueType}
                  </h3>
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded shrink-0 ${getRiskColorClass(
                      finding.severity
                    )}`}
                  >
                    {finding.severity}
                  </span>
                </div>

                <div className="text-[12px] text-gray-600 font-mono break-all">
                  {finding.host}
                  {finding.path}
                </div>

                <div className="flex items-center justify-between text-[11px] pt-0.5">
                  <span
                    className={
                      finding.attributedPackage
                        ? 'text-[#1565C0] font-medium'
                        : 'text-[#9E9E9E]'
                    }
                  >
                    {finding.attributedPackage
                      ? `App: ${finding.attributedPackage}`
                      : 'Attribution: unattributed'}
                  </span>
                  <span className="text-[10px] text-gray-400">
                    Imported: {finding.importedAt}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};
