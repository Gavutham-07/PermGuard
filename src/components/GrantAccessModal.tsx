import React, { useState } from 'react';
import { ArrowLeft, Check, ShieldCheck, AlertCircle } from 'lucide-react';

interface GrantAccessModalProps {
  isOpen: boolean;
  onClose: (didChange: boolean) => void;
  isGranted: boolean;
  onToggleAccess: (granted: boolean) => void;
}

export const GrantAccessModal: React.FC<GrantAccessModalProps> = ({
  isOpen,
  onClose,
  isGranted,
  onToggleAccess,
}) => {
  const [currentStatus, setCurrentStatus] = useState(isGranted);
  const [initialStatus] = useState(isGranted);

  if (!isOpen) return null;

  const handleToggle = () => {
    const next = !currentStatus;
    setCurrentStatus(next);
    onToggleAccess(next);
  };

  const handleReturn = () => {
    const changed = currentStatus !== initialStatus;
    onClose(changed);
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-sm w-full shadow-2xl overflow-hidden border border-gray-200">
        {/* Android Settings Header Bar */}
        <div className="bg-[#1A237E] text-white p-4 flex items-center gap-3">
          <button
            onClick={handleReturn}
            className="p-1 rounded-full hover:bg-white/10 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h2 className="text-sm font-semibold text-white">Android Settings</h2>
            <p className="text-xs text-[#C5CAE9]">Usage Access &bull; Special App Access</p>
          </div>
        </div>

        {/* Setting Content */}
        <div className="p-5 space-y-4">
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-xl border border-gray-100">
            <div className="w-10 h-10 rounded-xl bg-[#1A237E] flex items-center justify-center text-white shrink-0">
              <ShieldCheck className="w-6 h-6" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-gray-900">PermGuard</div>
              <div className="text-xs text-gray-500">com.example.permguard</div>
            </div>
          </div>

          <div className="flex items-center justify-between py-2 border-y border-gray-100">
            <div>
              <div className="text-sm font-medium text-gray-900">Permit usage access</div>
              <div className="text-xs text-gray-500">
                {currentStatus ? 'Allowed' : 'Not allowed'}
              </div>
            </div>

            <button
              onClick={handleToggle}
              className={`w-12 h-6 flex items-center rounded-full p-1 transition-colors duration-200 ease-in-out cursor-pointer ${
                currentStatus ? 'bg-[#1A237E]' : 'bg-gray-300'
              }`}
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                  currentStatus ? 'translate-x-6' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="text-xs text-gray-600 leading-relaxed space-y-2 bg-amber-50/60 p-3 rounded-lg border border-amber-200/50">
            <div className="flex items-center gap-1.5 font-semibold text-amber-900">
              <AlertCircle className="w-4 h-4 text-amber-700 shrink-0" />
              <span>About Usage Access</span>
            </div>
            <p>
              Usage access allows PermGuard to track 7-day foreground statistics via Android&apos;s{' '}
              <code>UsageStatsManager</code>.
            </p>
            <p>
              This is essential for identifying <strong>dormant apps</strong> that retain sensitive permissions (camera, microphone, location, contacts) without active use.
            </p>
          </div>

          <button
            onClick={handleReturn}
            className="w-full py-2.5 px-4 bg-[#1A237E] hover:bg-[#283593] text-white text-xs font-bold rounded-xl transition-colors shadow-sm"
          >
            Return to PermGuard
          </button>
        </div>
      </div>
    </div>
  );
};
