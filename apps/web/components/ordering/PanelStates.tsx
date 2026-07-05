import React from 'react';
import { Loader2, AlertTriangle, Inbox } from 'lucide-react';

/** Shared loading / error / empty states for the ordering admin panels. */

export const PanelLoading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400" role="status">
        <Loader2 size={28} className="animate-spin mb-3" />
        <p className="text-sm font-medium">{label}</p>
    </div>
);

export const PanelError: React.FC<{ message: string; onRetry?: () => void }> = ({ message, onRetry }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6" role="alert">
        <div className="w-12 h-12 rounded-2xl bg-red-50 flex items-center justify-center mb-3">
            <AlertTriangle size={24} className="text-red-500" />
        </div>
        <p className="text-sm font-bold text-slate-700 mb-1">Something went wrong</p>
        <p className="text-xs text-slate-500 mb-4">{message}</p>
        {onRetry && (
            <button onClick={onRetry} className="px-5 py-2.5 rounded-xl bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 active:scale-95 transition-all">
                Try again
            </button>
        )}
    </div>
);

export const PanelEmpty: React.FC<{ title: string; hint?: string; action?: React.ReactNode }> = ({ title, hint, action }) => (
    <div className="flex flex-col items-center justify-center py-16 text-center px-6">
        <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
            <Inbox size={24} className="text-slate-400" />
        </div>
        <p className="text-sm font-bold text-slate-600 mb-1">{title}</p>
        {hint && <p className="text-xs text-slate-400 mb-4">{hint}</p>}
        {action}
    </div>
);
