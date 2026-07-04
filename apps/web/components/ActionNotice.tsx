import React from 'react';
import { X } from 'lucide-react';

interface ActionNoticeProps {
    message: string;
    type?: 'error' | 'success';
    onDismiss?: () => void;
}

export function ActionNotice({ message, type = 'error', onDismiss }: ActionNoticeProps) {
    const isSuccess = type === 'success';

    return (
        <div className={`${isSuccess ? 'bg-green-50 border-green-200/60' : 'bg-red-50 border-red-200/60'} border rounded-xl p-3.5 animate-in slide-in-from-bottom duration-200 flex items-start gap-2`}>
            <p className={`text-xs ${isSuccess ? 'text-green-800' : 'text-red-800'} leading-relaxed font-medium flex-1`}>{message}</p>
            {onDismiss && (
                <button
                    onClick={onDismiss}
                    className={`shrink-0 mt-0.5 ${isSuccess ? 'text-green-600 hover:text-green-800' : 'text-red-400 hover:text-red-700'} transition-colors`}
                    aria-label="Dismiss"
                >
                    <X size={14} />
                </button>
            )}
        </div>
    );
}
