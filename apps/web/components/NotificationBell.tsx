import React, { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import type { IntelligenceNotification } from '@restropulse/shared';
import { relativeTime, SEVERITY_DOT } from './intelligence/sections/notifications';

/**
 * The top-bar bell, made real. Shows the Intelligence feed (report ready,
 * rival alerts, yesterday's reviews) plus the existing "posts awaiting
 * approval" count. Opening it marks the feed seen; clicking an item navigates.
 */
const NotificationBell: React.FC<{
    items: IntelligenceNotification[];
    unread: number;
    pendingPosts: number;
    onOpen: () => void;
    onItemClick: (n: IntelligenceNotification) => void;
    onPendingPostsClick?: () => void;
}> = ({ items, unread, pendingPosts, onOpen, onItemClick, onPendingPostsClick }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDoc);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const total = unread + pendingPosts;

    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => {
                    const next = !open;
                    setOpen(next);
                    if (next) onOpen();
                }}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-label={total > 0 ? `Notifications, ${total} new` : 'Notifications'}
                className="w-10 h-10 bg-slate-100 rounded-xl flex items-center justify-center relative hover:bg-slate-200 transition-colors"
                data-testid="notification-bell"
            >
                <Bell size={20} className="text-slate-600" />
                {total > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center border border-white" data-testid="notification-badge">
                        {total > 9 ? '9+' : total}
                    </span>
                )}
            </button>

            {open && (
                <div
                    role="dialog"
                    aria-label="Notifications"
                    className="absolute right-0 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] rounded-2xl border border-slate-200 bg-white shadow-lg z-50 overflow-hidden"
                >
                    <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                        <p className="text-sm font-semibold text-slate-800">What’s new</p>
                        <button type="button" onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:text-slate-800">Close</button>
                    </div>
                    <div className="max-h-[70vh] overflow-y-auto">
                        {pendingPosts > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onPendingPostsClick?.();
                                }}
                                className="w-full text-left px-4 py-3 border-b border-slate-100 hover:bg-slate-50"
                            >
                                <p className="text-sm font-medium text-slate-800">
                                    {pendingPosts} post{pendingPosts === 1 ? '' : 's'} waiting for your approval
                                </p>
                                <p className="text-xs text-slate-500 mt-0.5">Content Studio</p>
                            </button>
                        )}
                        {items.length === 0 && pendingPosts === 0 && (
                            <p className="px-4 py-6 text-sm text-slate-500">Nothing new yet. We check your Google profile and rivals every night — changes show up here.</p>
                        )}
                        {items.map((n) => (
                            <button
                                key={n.id}
                                type="button"
                                onClick={() => {
                                    setOpen(false);
                                    onItemClick(n);
                                }}
                                className={`w-full text-left px-4 py-3 border-b border-slate-100 last:border-b-0 hover:bg-slate-50 ${n.unread ? 'bg-orange-50/40' : ''}`}
                            >
                                <div className="flex items-start gap-2.5">
                                    <span className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[n.severity]} ${n.unread ? '' : 'opacity-40'}`} aria-hidden="true" />
                                    <div className="min-w-0">
                                        <p className={`text-sm leading-snug ${n.unread ? 'font-semibold text-slate-900' : 'font-medium text-slate-700'}`}>{n.title}</p>
                                        {n.body && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{n.body}</p>}
                                        <p className="text-[11px] text-slate-400 mt-1">{relativeTime(n.at)}</p>
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default NotificationBell;
