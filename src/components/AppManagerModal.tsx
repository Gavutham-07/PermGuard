import React, { useState } from 'react';
import { InstalledAppMock } from '../data/defaultApps';
import { SHORT_PERMISSIONS } from '../engine/RiskEngine';
import { X, Plus, RotateCcw, Smartphone } from 'lucide-react';

interface AppManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  apps: InstalledAppMock[];
  onSaveApps: (apps: InstalledAppMock[]) => void;
  onResetApps: () => void;
}

export const AppManagerModal: React.FC<AppManagerModalProps> = ({
  isOpen,
  onClose,
  apps,
  onSaveApps,
  onResetApps,
}) => {
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAppName, setNewAppName] = useState('');
  const [newPackageName, setNewPackageName] = useState('');
  const [newPermissions, setNewPermissions] = useState<string[]>(['CAMERA']);
  const [newForeground, setNewForeground] = useState(0);
  const [newIsSystem, setNewIsSystem] = useState(false);

  if (!isOpen) return null;

  const handleTogglePermission = (pkgIndex: number, perm: string) => {
    const updated = [...apps];
    const target = { ...updated[pkgIndex] };
    if (target.permissions.includes(perm)) {
      target.permissions = target.permissions.filter((p) => p !== perm);
    } else {
      target.permissions = [...target.permissions, perm];
    }
    updated[pkgIndex] = target;
    onSaveApps(updated);
  };

  const handleUpdateForeground = (pkgIndex: number, minutes: number) => {
    const updated = [...apps];
    updated[pkgIndex] = {
      ...updated[pkgIndex],
      foregroundMinutes: Math.max(0, minutes),
    };
    onSaveApps(updated);
  };

  const handleAddApp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim() || !newPackageName.trim()) return;

    const newApp: InstalledAppMock = {
      appName: newAppName.trim(),
      packageName: newPackageName.trim(),
      permissions: newPermissions,
      foregroundMinutes: Number(newForeground),
      isSystemApp: newIsSystem,
      lastUsedTime: newForeground > 0 ? 'Recently' : 'Never used',
      dataUsage: {
        mobileBytes: 25 * 1024 * 1024,
        wifiBytes: 50 * 1024 * 1024,
        available: true,
      },
    };

    onSaveApps([newApp, ...apps]);
    setShowAddForm(false);
    setNewAppName('');
    setNewPackageName('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#1A237E] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-[#C5CAE9]" />
            <div>
              <h2 className="text-base font-bold">Manage Installed Packages</h2>
              <p className="text-xs text-[#C5CAE9]">Test permissions, foreground stats, and risk</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-white/10 text-white/80 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action bar */}
        <div className="flex items-center justify-between p-3 bg-gray-50 border-b border-gray-200">
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#1A237E] text-white hover:bg-[#283593] flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{showAddForm ? 'Cancel Add' : 'Add Test Package'}</span>
          </button>

          <button
            onClick={onResetApps}
            className="text-xs font-semibold px-2.5 py-1.5 rounded-lg border border-gray-300 text-gray-700 hover:bg-gray-100 flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset Factory Apps</span>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {showAddForm && (
            <form onSubmit={handleAddApp} className="bg-indigo-50/50 border border-indigo-100 p-3 rounded-xl space-y-2.5 text-xs">
              <h3 className="font-bold text-indigo-950 text-sm">Add New Installed App</h3>
              <div>
                <label className="block text-gray-700 mb-1 font-medium">App Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. My Secure Bank"
                  value={newAppName}
                  onChange={(e) => setNewAppName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded bg-white text-xs"
                />
              </div>

              <div>
                <label className="block text-gray-700 mb-1 font-medium">Package Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. com.mybank.app"
                  value={newPackageName}
                  onChange={(e) => setNewPackageName(e.target.value)}
                  className="w-full p-2 border border-gray-300 rounded bg-white text-xs"
                />
              </div>

              <div>
                <label className="block text-gray-700 mb-1 font-medium">Foreground Minutes (7d)</label>
                <input
                  type="number"
                  min="0"
                  value={newForeground}
                  onChange={(e) => setNewForeground(Number(e.target.value))}
                  className="w-full p-2 border border-gray-300 rounded bg-white text-xs"
                />
              </div>

              <div>
                <label className="block text-gray-700 mb-1 font-medium">Sensitive Permissions</label>
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {SHORT_PERMISSIONS.map((perm) => (
                    <button
                      type="button"
                      key={perm}
                      onClick={() => {
                        if (newPermissions.includes(perm)) {
                          setNewPermissions(newPermissions.filter((p) => p !== perm));
                        } else {
                          setNewPermissions([...newPermissions, perm]);
                        }
                      }}
                      className={`px-2 py-1 rounded text-[10px] font-bold border transition-colors ${
                        newPermissions.includes(perm)
                          ? 'bg-[#1A237E] text-white border-[#1A237E]'
                          : 'bg-white text-gray-600 border-gray-300'
                      }`}
                    >
                      {perm}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="systemApp"
                  checked={newIsSystem}
                  onChange={(e) => setNewIsSystem(e.target.checked)}
                />
                <label htmlFor="systemApp" className="text-gray-700 font-medium">
                  System App (pre-installed system partition)
                </label>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-[#1A237E] text-white font-bold rounded hover:bg-[#283593] transition-colors"
              >
                Save App
              </button>
            </form>
          )}

          <div className="space-y-2">
            {apps.map((app, index) => (
              <div
                key={app.packageName}
                className="bg-white border border-gray-200 rounded-xl p-3 text-xs space-y-2 shadow-xs"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-gray-900 text-sm">{app.appName}</h4>
                    <p className="text-[11px] text-gray-500 font-mono">{app.packageName}</p>
                  </div>
                  <span className="text-[10px] bg-gray-100 text-gray-700 font-medium px-2 py-0.5 rounded">
                    {app.isSystemApp ? 'System' : 'User App'}
                  </span>
                </div>

                {/* Foreground time quick adjuster */}
                <div className="flex items-center gap-2 pt-1 text-gray-700">
                  <span className="font-medium text-gray-500">Foreground (7d):</span>
                  <input
                    type="number"
                    min="0"
                    value={app.foregroundMinutes}
                    onChange={(e) => handleUpdateForeground(index, Number(e.target.value))}
                    className="w-16 px-1.5 py-0.5 border border-gray-300 rounded text-center text-xs"
                  />
                  <span className="text-gray-500">min</span>
                  <span className="text-[10px] text-gray-400">(&lt;5min = high dormant suspicion)</span>
                </div>

                {/* Permission checkboxes */}
                <div>
                  <div className="text-[11px] font-medium text-gray-500 mb-1">
                    Toggle Permissions (Audited for Silent Abuse):
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {SHORT_PERMISSIONS.map((perm) => {
                      const isGranted = app.permissions.includes(perm);
                      return (
                        <button
                          type="button"
                          key={perm}
                          onClick={() => handleTogglePermission(index, perm)}
                          className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition-all ${
                            isGranted
                              ? 'bg-indigo-600 text-white border-indigo-700'
                              : 'bg-gray-100 text-gray-500 border-gray-200 hover:bg-gray-200'
                          }`}
                        >
                          {perm}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
