import React, { useEffect } from 'react';

interface ConfirmDialogProps {
    title: string;
    message: string;
    confirmLabel: string;
    cancelLabel?: string;
    onConfirm: () => void;
    onCancel: () => void;
    details?: React.ReactNode[];
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ title, message, confirmLabel, cancelLabel, onConfirm, onCancel, details }) => {
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onCancel]);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="absolute inset-0" onClick={onCancel}></div>
            <div className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 relative z-10">
                <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 shrink-0 sm:hidden"></div>
                <h3 className="text-lg font-bold text-slate-800 mb-2">{title}</h3>
                <p className={`text-sm text-slate-500 ${details && details.length > 0 ? 'mb-2' : 'mb-6'}`}>{message}</p>
                {details && details.length > 0 && (
                    <ul className="mb-6 space-y-2">
                        {details.map((item, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-slate-500">
                                <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-slate-400 shrink-0" />
                                {item}
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex gap-3">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-3.5 rounded-2xl border border-slate-200 text-slate-600 font-bold text-sm hover:bg-slate-50 active:scale-[0.98] transition-all"
                    >
                        {cancelLabel ?? 'Cancel'}
                    </button>
                    <button
                        onClick={onConfirm}
                        className="flex-1 py-3.5 rounded-2xl bg-red-600 text-white font-bold text-sm hover:bg-red-700 active:scale-[0.98] transition-all shadow-lg"
                    >
                        {confirmLabel}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ConfirmDialog;
