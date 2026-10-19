import React, { useState, useEffect } from 'react';
import { BurpEventPayload, ImportedFinding } from '../types';
import { BurpBridge } from '../engine/BurpBridge';
import { DatabaseHelper } from '../storage/db';
import { Wifi, Copy, Check, RefreshCw, Send, X, AlertTriangle, FileCode } from 'lucide-react';

interface BurpBridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onEventIngested: (finding: ImportedFinding, isDuplicate: boolean) => void;
}

export const BurpBridgeModal: React.FC<BurpBridgeModalProps> = ({
  isOpen,
  onClose,
  onEventIngested,
}) => {
  const [token, setToken] = useState<string>('');
  const [isCopied, setIsCopied] = useState(false);
  const [isRotating, setIsRotating] = useState(false);
  const [healthStatus, setHealthStatus] = useState<{ listening: boolean; eventsReceived: number; mode?: string } | null>(null);
  const [isHealthChecking, setIsHealthChecking] = useState(false);

  // Synthetic Test Generator state
  const [testIssue, setTestIssue] = useState('Synthetic Cleartext Transmission [TEST]');
  const [testSeverity, setTestSeverity] = useState<'HIGH' | 'MEDIUM' | 'LOW'>('HIGH');
  const [testHost, setTestHost] = useState('api.synthetic-target.local');
  const [testPath, setTestPath] = useState('/v1/telemetry/sync?token=secret123');
  const [testPackage, setTestPackage] = useState('com.google.android.googlequicksearchbox');
  const [testResult, setTestResult] = useState<{ status: number; message: string; duplicate?: boolean } | null>(null);
  const [isSendingTest, setIsSendingTest] = useState(false);

  const endpointUrl = typeof window !== 'undefined' && window.location.hostname !== 'localhost' && !window.location.protocol.startsWith('capacitor')
    ? `${window.location.protocol}//${window.location.hostname}:3000/api/burp/events`
    : 'http://127.0.0.1:3000/api/burp/events';

  const checkHealth = async () => {
    setIsHealthChecking(true);
    try {
      const res = await fetch('/api/burp/health');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        setHealthStatus({
          listening: data.listening,
          eventsReceived: data.eventsReceived,
          mode: 'Full-Stack Server (Port 3000)',
        });
        return;
      }
    } catch {
      // Standalone or Mobile APK WebView fallback
    }

    // In mobile APK / Standalone WebView, in-app engine is active
    const findings = DatabaseHelper.loadAllFindings();
    setHealthStatus({
      listening: true,
      eventsReceived: findings.length,
      mode: 'On-Device Mobile Engine',
    });
    setIsHealthChecking(false);
  };

  const fetchToken = async () => {
    try {
      const res = await fetch('/api/burp/token');
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.token) {
          setToken(data.token);
          return;
        }
      }
    } catch {
      // In mobile APK, fallback to persistent token
    }
    setToken(DatabaseHelper.getOrCreatePairingToken());
  };

  const rotateToken = async () => {
    setIsRotating(true);
    try {
      const res = await fetch('/api/burp/token/rotate', { method: 'POST' });
      const contentType = res.headers.get('content-type') || '';
      if (res.ok && contentType.includes('application/json')) {
        const data = await res.json();
        if (data.token) {
          setToken(data.token);
          setIsRotating(false);
          return;
        }
      }
    } catch {
      // In mobile APK fallback
    }
    const newToken = DatabaseHelper.generateNewPairingToken();
    setToken(newToken);
    setIsRotating(false);
  };

  useEffect(() => {
    if (isOpen) {
      checkHealth();
      fetchToken();
      setTestResult(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(token);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleSendSyntheticTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSendingTest(true);
    setTestResult(null);

    const activeToken = token || DatabaseHelper.getOrCreatePairingToken();

    const payload: BurpEventPayload = {
      issueType: testIssue.trim(),
      severity: testSeverity,
      host: testHost.trim(),
      path: testPath.trim(),
      attributedPackage: testPackage.trim() || undefined,
      confidence: testPackage.trim() ? 'HIGH' : 'UNKNOWN',
      synthetic: true,
    };

    let statusCode = 201;
    let resData: { success: boolean; message: string; finding?: ImportedFinding; duplicate?: boolean } | null = null;
    let handledByLocalEngine = false;

    try {
      const response = await fetch('/api/burp/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${activeToken}`,
        },
        body: JSON.stringify(payload),
      });

      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        resData = await response.json();
        statusCode = response.status;
      } else {
        // Returned HTML (e.g. mobile APK WebView fallback route)
        handledByLocalEngine = true;
      }
    } catch {
      handledByLocalEngine = true;
    }

    if (handledByLocalEngine) {
      // Process using local BurpBridge engine
      const existingFindings = DatabaseHelper.loadAllFindings();
      const localResult = BurpBridge.processIncomingEvent(
        payload,
        `Bearer ${activeToken}`,
        activeToken,
        existingFindings,
        'mobile_client'
      );
      statusCode = localResult.statusCode;
      resData = localResult.response;
    }

    if (resData) {
      setTestResult({
        status: statusCode,
        message: resData.message || (statusCode === 201 ? 'Event accepted' : 'Failed to ingest'),
        duplicate: resData.duplicate,
      });

      if ((statusCode === 200 || statusCode === 201) && resData.finding) {
        onEventIngested(resData.finding, Boolean(resData.duplicate));
      }
    }

    setIsSendingTest(false);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        {/* Header */}
        <div className="bg-[#1A237E] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wifi className="w-5 h-5 text-[#C5CAE9]" />
            <div>
              <h2 className="text-base font-bold">Burp Suite Real-Time Bridge</h2>
              <p className="text-xs text-[#C5CAE9]">Authenticated loopback listener &amp; Montoya API</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 space-y-4 overflow-y-auto flex-1 text-xs">
          {/* Bridge Status Card */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                <span className="font-bold text-gray-900 text-sm">
                  Bridge Active ({healthStatus?.mode || 'On-Device Mobile Engine'})
                </span>
              </div>
              <button
                onClick={checkHealth}
                disabled={isHealthChecking}
                className="text-gray-500 hover:text-gray-800 p-1 rounded hover:bg-gray-200 transition-colors"
                title="Refresh Status"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isHealthChecking ? 'animate-spin' : ''}`} />
              </button>
            </div>

            <div className="text-[11px] text-gray-600 font-mono bg-white p-2 rounded border border-gray-200 break-all select-all">
              Endpoint: POST {endpointUrl}
            </div>

            {/* Token Section */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-gray-700">Pairing Bearer Token:</span>
                <button
                  onClick={rotateToken}
                  disabled={isRotating}
                  className="text-[10px] text-indigo-700 hover:text-indigo-900 font-medium"
                >
                  {isRotating ? 'Rotating...' : 'Rotate Token'}
                </button>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  readOnly
                  value={token}
                  className="w-full font-mono text-[11px] p-2 bg-white border border-gray-300 rounded text-gray-800 select-all"
                />
                <button
                  onClick={handleCopy}
                  className="px-3 py-2 bg-[#1A237E] hover:bg-[#283593] text-white rounded font-medium flex items-center gap-1 shrink-0 transition-colors"
                >
                  {isCopied ? <Check className="w-3.5 h-3.5 text-emerald-300" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{isCopied ? 'Copied' : 'Copy'}</span>
                </button>
              </div>
              <p className="text-[10px] text-gray-400 mt-1">
                Keep secret. Pass in header: <code>Authorization: Bearer &lt;token&gt;</code>.
              </p>
            </div>
          </div>

          {/* Synthetic Event Generator */}
          <div className="bg-indigo-50/40 border border-indigo-100 rounded-xl p-3.5 space-y-3">
            <div className="flex items-center gap-1.5 text-indigo-950 font-bold text-sm">
              <Send className="w-4 h-4 text-indigo-700" />
              <span>Synthetic Event Generator</span>
            </div>
            <p className="text-[11px] text-gray-600">
              Dispatches a synthetic security finding through the identical pipeline (Bearer authentication, rate-limiting, secret redaction, deduplication, and risk scoring).
            </p>

            <form onSubmit={handleSendSyntheticTest} className="space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-700 font-medium mb-0.5">Issue Name</label>
                  <input
                    type="text"
                    required
                    value={testIssue}
                    onChange={(e) => setTestIssue(e.target.value)}
                    className="w-full p-1.5 border border-gray-300 rounded bg-white text-xs"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-700 font-medium mb-0.5">Severity</label>
                  <select
                    value={testSeverity}
                    onChange={(e) => setTestSeverity(e.target.value as any)}
                    className="w-full p-1.5 border border-gray-300 rounded bg-white text-xs"
                  >
                    <option value="HIGH">HIGH (15 pts)</option>
                    <option value="MEDIUM">MEDIUM (8 pts)</option>
                    <option value="LOW">LOW (3 pts)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] text-gray-700 font-medium mb-0.5">Target Host</label>
                  <input
                    type="text"
                    required
                    value={testHost}
                    onChange={(e) => setTestHost(e.target.value)}
                    className="w-full p-1.5 border border-gray-300 rounded bg-white text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-gray-700 font-medium mb-0.5">Attributed Package</label>
                  <input
                    type="text"
                    placeholder="e.g. com.example.app"
                    value={testPackage}
                    onChange={(e) => setTestPackage(e.target.value)}
                    className="w-full p-1.5 border border-gray-300 rounded bg-white text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] text-gray-700 font-medium mb-0.5">Endpoint Path</label>
                <input
                  type="text"
                  required
                  value={testPath}
                  onChange={(e) => setTestPath(e.target.value)}
                  className="w-full p-1.5 border border-gray-300 rounded bg-white text-xs font-mono"
                />
              </div>

              <button
                type="submit"
                disabled={isSendingTest}
                className="w-full py-2 bg-[#1A237E] hover:bg-[#283593] disabled:opacity-60 text-white font-bold rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
              >
                {isSendingTest ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Transmitting Event...</span>
                  </>
                ) : (
                  <>
                    <Send className="w-3.5 h-3.5" />
                    <span>Send Event Through Bridge</span>
                  </>
                )}
              </button>
            </form>

            {testResult && (
              <div
                className={`p-2.5 rounded-lg border text-xs flex items-start gap-2 ${
                  testResult.status === 201
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : testResult.duplicate
                    ? 'bg-amber-50 border-amber-200 text-amber-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}
              >
                {testResult.status === 201 ? (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                )}
                <div>
                  <div className="font-bold">
                    HTTP {testResult.status} &bull; {testResult.duplicate ? 'Duplicate Finding' : 'Accepted & Verified'}
                  </div>
                  <div className="text-[11px]">{testResult.message}</div>
                </div>
              </div>
            )}
          </div>

          {/* Python Montoya Extension Instructions */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-3 space-y-2">
            <div className="flex items-center gap-1.5 font-bold text-gray-800">
              <FileCode className="w-4 h-4 text-gray-600" />
              <span>Burp Extender Setup (`permguard_burp_extension.py`)</span>
            </div>
            <ol className="list-decimal pl-4 space-y-1 text-gray-600 text-[11px]">
              <li>In Burp Suite, open <strong>Extensions &rarr; Options &rarr; Python Environment</strong>.</li>
              <li>Configure your Jython Standalone JAR (version 2.7.3+).</li>
              <li>Click <strong>Installed &rarr; Add</strong>, choose <strong>Python</strong>, and select <code>permguard_burp_extension.py</code>.</li>
              <li>The extension will stream real-time HTTP security alerts into PermGuard without storing full request/response bodies.</li>
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
};
