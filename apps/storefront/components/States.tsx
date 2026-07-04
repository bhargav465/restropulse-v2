import React from 'react';

export const Loading: React.FC<{ label?: string }> = ({ label = 'Loading…' }) => (
  <div className="flex flex-col items-center justify-center py-16 text-slate-500" role="status" aria-live="polite">
    <div className="w-8 h-8 border-4 border-slate-200 border-t-[var(--sf-primary)] rounded-full animate-spin mb-3" aria-hidden="true" />
    <span className="text-sm">{label}</span>
  </div>
);

export const ErrorState: React.FC<{ message?: string; onRetry?: () => void }> = ({ message = 'Something went wrong.', onRetry }) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center" role="alert">
    <p className="text-sm text-slate-600 mb-4">{message}</p>
    {onRetry && (
      <button
        onClick={onRetry}
        className="px-5 py-2.5 rounded-xl bg-[var(--sf-primary)] text-white text-sm font-semibold hover:opacity-90"
      >
        Try again
      </button>
    )}
  </div>
);

export const EmptyState: React.FC<{ title: string; text?: string; action?: React.ReactNode }> = ({ title, text, action }) => (
  <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
    <h2 className="text-base font-bold text-slate-700 mb-1">{title}</h2>
    {text && <p className="text-sm text-slate-500 mb-4">{text}</p>}
    {action}
  </div>
);
