import React from 'react';
import { ChangeEvent } from '../types';
import { getRiskColorClass } from '../utils/formatters';
import { Bell, BellOff, CheckCircle2, ShieldAlert, Trash2, X, AlertCircle } from 'lucide-react';

interface NotificationFeedModalProps {
  isOpen: boolean;
  onClose: () => void;
  events: ChangeEvent[];
  onDismissEvent: (id: string) => void;
  onClearAll: () => void;
}

export const NotificationFeedModal: React.FC<NotificationFeedModalProps> = ({
  isOpen,
  onClose,
  events,
  onDismissEvent,
  onClearAll,
}) => {
  if (!isOpen) return null;

  const activeEvents = events.filter((e) => !e.dismissed);

  const getEventBadge = (type: ChangeEvent['type']) => {
    switch (type) {
      case 'CATEGORY_TRANSITION':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800">CATEGORY SHIFT</span>;
      case 'SCORE_DELTA':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">&Delta; SCORE &ge; 5 PTS</span>;
      case 'PERMISSION_CHANGED':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">PERMISSIONS MODIFIED</span>;
      case 'NEW_FINDING':
        return <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800">VULNERABILITY INGESTED</span>;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-[#1A237E] text-white p-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bell className="w-5 h-5 text-[#C5CAE9]" />
            <div>
              <h2 className="text-base font-bold">Change Detection Feed</h2>
              <p className="text-xs text-[#C5CAE9]">Meaningful score deltas (&ge;5 pts) &amp; permission shifts</p>
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
        <div className="flex items-center justify-between p-3 bg-gray-50 border-b border-gray-200 text-xs">
          <span className="font-semibold text-gray-700">
            {activeEvents.length} Active Notification(s)
          </span>
          {activeEvents.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-red-600 hover:text-red-800 font-medium flex items-center gap-1 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              <span>Clear All</span>
            </button>
          )}
        </div>

        {/* Event List */}
        <div className="p-4 space-y-2.5 overflow-y-auto flex-1 text-xs">
          {activeEvents.length === 0 ? (
            <div className="py-16 text-center text-gray-500 space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="font-bold text-gray-800">No Pending Change Alerts</p>
              <p className="text-gray-400 max-w-xs mx-auto text-[11px]">
                PermGuard compares scans against the saved snapshot. Notifications trigger on category transitions, score changes &ge;5 pts, or newly attributed Burp findings.
              </p>
            </div>
          ) : (
            activeEvents.map((event) => (
              <div
                key={event.id}
                className="bg-white border border-gray-200 rounded-xl p-3 shadow-xs space-y-2 hover:border-indigo-300 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-gray-900 text-[13px]">{event.appName}</span>
                      {getEventBadge(event.type)}
                    </div>
                    <div className="text-[10px] text-gray-500 font-mono">{event.packageName}</div>
                  </div>
                  <button
                    onClick={() => onDismissEvent(event.id)}
                    className="text-gray-400 hover:text-gray-600 p-1 rounded"
                    title="Dismiss alert"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <p className="text-[12px] text-gray-800 leading-snug">{event.description}</p>

                {/* Before & After score comparison */}
                {(event.oldScore !== undefined || event.newScore !== undefined) && (
                  <div className="bg-gray-50 rounded-lg p-2 text-[11px] flex items-center justify-between border border-gray-100">
                    <div>
                      <span className="text-gray-500">Previous: </span>
                      <span className="font-bold text-gray-700">{event.oldScore ?? 0} pts</span>
                      {event.oldCategory && (
                        <span className="ml-1 text-[10px] font-semibold text-gray-600">
                          ({event.oldCategory})
                        </span>
                      )}
                    </div>
                    <span className="text-gray-400">&rarr;</span>
                    <div>
                      <span className="text-gray-500">Current: </span>
                      <span className="font-bold text-indigo-700">{event.newScore ?? 0} pts</span>
                      {event.newCategory && (
                        <span className="ml-1 text-[10px] font-semibold text-indigo-800">
                          ({event.newCategory})
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="text-[10px] text-gray-400 flex items-center justify-between pt-0.5">
                  <span>Detected: {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="text-emerald-700 font-medium">&check; Deduplicated</span>
                </div>
              </div>
            ))
          )}

          <div className="mt-4 pt-3 border-t border-gray-100 text-[10px] text-gray-500 flex items-start gap-1.5 bg-amber-50/50 p-2 rounded-lg">
            <AlertCircle className="w-4 h-4 text-amber-700 shrink-0 mt-0.5" />
            <span>
              Disclaimer: Change events reflect heuristic evidence and vulnerability scans. High score shifts do not prove malicious behavior.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
