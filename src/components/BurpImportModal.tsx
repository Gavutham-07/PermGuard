import React, { useState } from 'react';
import { BurpImporter } from '../engine/BurpImporter';
import { ImportedFinding, ImportResult } from '../types';
import { Upload, FileText, CheckCircle, AlertCircle, X } from 'lucide-react';

interface BurpImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  existingFindings: ImportedFinding[];
  onImportSuccess: (result: ImportResult) => void;
}

const SAMPLE_CSV = `# PermGuard Burp Suite Findings Import Sample (v1)
# Format: severity,host,path,issue_name,attribution
# - severity: HIGH, MEDIUM, LOW, or INFORMATION
# - attribution: optional Android package name (e.g. com.example.app)
severity,host,path,issue_name,attribution
HIGH,api.example.com,/v1/login,Cleartext HTTP Transmission,com.google.android.googlequicksearchbox
MEDIUM,cdn.example.com,/assets,Missing Cache-Control Header,
LOW,analytics.example.com,/collect,Verbose Server Banner,
HIGH,telemetry.tracker.io,/device/report,Hardcoded API Secret in Query Params,com.flashlight.bright.torch
MEDIUM,api.batterybooster.org,/sync,Unencrypted Sensitive Endpoint,com.example.stealthtracker`;

export const BurpImportModal: React.FC<BurpImportModalProps> = ({
  isOpen,
  onClose,
  existingFindings,
  onImportSuccess,
}) => {
  const [activeTab, setActiveTab] = useState<'upload' | 'sample' | 'paste'>('upload');
  const [pastedText, setPastedText] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleProcessText = (content: string, filename: string = 'imported-file') => {
    setError(null);
    const sizeBytes = new Blob([content]).size;
    const result = BurpImporter.parse(content, sizeBytes, existingFindings);

    if (result.findings.length === 0 && result.parseErrors.length > 0) {
      setError(result.parseErrors.join('; '));
      return;
    }

    onImportSuccess(result);
    onClose();
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > BurpImporter.MAX_FILE_BYTES) {
      setError(
        `File too large (${Math.round(file.size / 1024)} KB). Maximum is ${Math.round(
          BurpImporter.MAX_FILE_BYTES / 1024
        )} KB.`
      );
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      handleProcessText(text, file.name);
    };
    reader.onerror = () => {
      setError('Failed to read file');
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="bg-[#1A237E] text-white p-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold">Import Burp Suite Findings</h2>
            <p className="text-xs text-[#C5CAE9]">Supports XML report &amp; PermGuard CSV</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-gray-200 bg-gray-50 text-xs font-medium">
          <button
            onClick={() => setActiveTab('upload')}
            className={`flex-1 py-2.5 px-3 text-center border-b-2 transition-colors ${
              activeTab === 'upload'
                ? 'border-[#1A237E] text-[#1A237E] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Upload File
          </button>
          <button
            onClick={() => setActiveTab('sample')}
            className={`flex-1 py-2.5 px-3 text-center border-b-2 transition-colors ${
              activeTab === 'sample'
                ? 'border-[#1A237E] text-[#1A237E] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Load Sample CSV
          </button>
          <button
            onClick={() => setActiveTab('paste')}
            className={`flex-1 py-2.5 px-3 text-center border-b-2 transition-colors ${
              activeTab === 'paste'
                ? 'border-[#1A237E] text-[#1A237E] font-bold bg-white'
                : 'border-transparent text-gray-500 hover:text-gray-800'
            }`}
          >
            Paste Text
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 text-xs p-2.5 rounded-lg flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="space-y-3">
              <label className="border-2 border-dashed border-gray-300 hover:border-indigo-500 rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors bg-gray-50/50 hover:bg-indigo-50/20">
                <Upload className="w-8 h-8 text-indigo-700 mb-2" />
                <span className="text-sm font-semibold text-gray-800">
                  Select XML or CSV file
                </span>
                <span className="text-xs text-gray-500 mt-1">
                  Burp Suite Issues XML or PermGuard CSV (Max 2 MiB)
                </span>
                <input
                  type="file"
                  accept=".xml,.csv,text/xml,text/csv,text/plain"
                  onChange={handleFileUpload}
                  className="hidden"
                />
              </label>

              <div className="text-[11px] text-gray-500 space-y-1 bg-gray-50 p-2.5 rounded-lg border border-gray-100">
                <div className="font-semibold text-gray-700">Supported Formats:</div>
                <div>&bull; <strong>Burp Pro XML:</strong> Target &rarr; Report issues &rarr; XML format</div>
                <div>&bull; <strong>PermGuard CSV:</strong> severity, host, path, issue_name, attribution</div>
                <div className="text-emerald-700 font-medium pt-1">
                  &check; Sensitive tokens, session cookies, and API keys are automatically redacted.
                </div>
              </div>
            </div>
          )}

          {activeTab === 'sample' && (
            <div className="space-y-3">
              <p className="text-xs text-gray-600">
                Import bundled sample findings including verified vulnerability reports attributed to installed packages (e.g. Google app cleartext transmission and flashlight secret leaks).
              </p>

              <div className="bg-gray-900 text-emerald-400 p-3 rounded-lg font-mono text-[11px] overflow-x-auto whitespace-pre leading-relaxed border border-gray-800">
                {SAMPLE_CSV}
              </div>

              <button
                onClick={() => handleProcessText(SAMPLE_CSV, 'sample_burp_findings.csv')}
                className="w-full py-2.5 px-4 bg-[#1A237E] hover:bg-[#283593] text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <CheckCircle className="w-4 h-4" />
                <span>Import This Sample Dataset</span>
              </button>
            </div>
          )}

          {activeTab === 'paste' && (
            <div className="space-y-3">
              <textarea
                value={pastedText}
                onChange={(e) => setPastedText(e.target.value)}
                placeholder="Paste Burp Suite XML issues export or CSV rows here..."
                rows={7}
                className="w-full p-2.5 text-xs font-mono border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#1A237E]"
              />

              <button
                disabled={!pastedText.trim()}
                onClick={() => handleProcessText(pastedText, 'pasted-findings.txt')}
                className="w-full py-2.5 px-4 bg-[#1A237E] hover:bg-[#283593] disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
              >
                <FileText className="w-4 h-4" />
                <span>Parse &amp; Import Pasted Content</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
