import React, { useState, useEffect } from 'react';
import { Target, Clock, CalendarCheck, Zap, ChevronRight, CheckCircle, RefreshCw, X, Send, AlertCircle, MessageCircle, Calendar, Lock } from 'lucide-react';
import { strategyAPI } from '../api';
import {
    StrategyCycle,
    Restaurant,
    computeCycleApprovalDeadline,
    isCyclePastApprovalDeadline,
} from '@restropulse/shared';
import { ActionNotice } from './ActionNotice';

function formatBillingRange(startDate?: string, endDate?: string): string | null {
    if (!startDate || !endDate) return null;
    const s = new Date(startDate);
    const e = new Date(endDate);
    if (isNaN(s.getTime()) || isNaN(e.getTime())) return null;
    const fmt = (d: Date, opts: Intl.DateTimeFormatOptions) =>
        d.toLocaleDateString('en-US', opts);
    return `${fmt(s, { month: 'short', day: 'numeric' })} – ${fmt(e, { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

function formatCountdown(deadline: Date, now: Date): string {
    const diffMs = deadline.getTime() - now.getTime();
    if (diffMs <= 0) return 'Feedback window closed';
    const totalMinutes = Math.floor(diffMs / (60 * 1000));
    const days = Math.floor(totalMinutes / (60 * 24));
    const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
    const minutes = totalMinutes % 60;
    if (days > 0) return `Feedback closes in ${days}d ${hours}h`;
    if (hours > 0) return `Feedback closes in ${hours}h ${minutes}m`;
    return `Feedback closes in ${minutes}m`;
}

interface StrategyProps {
    restaurantData: Restaurant;
    instagramConnected?: boolean;
    onConnectInstagram?: () => void;
    cycleApprovalBufferMins?: number;
    instagramEnabled?: boolean;
}

const Strategy: React.FC<StrategyProps> = ({ restaurantData, instagramConnected = false, onConnectInstagram, cycleApprovalBufferMins, instagramEnabled = true }) => {
    const [cycles, setCycles] = useState<StrategyCycle[]>([]);
    const [loading, setLoading] = useState(true);
    const [suggestCreateCycle, setSuggestCreateCycle] = useState(false);
    const [notice, setNotice] = useState<{ message: string; type: 'error' | 'success' } | null>(null);
    const [now, setNow] = useState(() => new Date());

    // Tick proportionally to the buffer: 1/12 of buffer, capped 10 s–60 s.
    useEffect(() => {
        const bufferMs = (cycleApprovalBufferMins ?? 4320) * 60 * 1000;
        const tickMs = Math.min(60_000, Math.max(10_000, bufferMs / 12));
        const interval = setInterval(() => setNow(new Date()), tickMs);
        return () => clearInterval(interval);
    }, [cycleApprovalBufferMins]);

    // Auto-dismiss notice
    useEffect(() => {
        if (!notice) return;
        const timer = setTimeout(() => setNotice(null), 6000);
        return () => clearTimeout(timer);
    }, [notice]);

    useEffect(() => {
        const loadData = async () => {
            try {
                const [cycleData, strategyData] = await Promise.all([
                    strategyAPI.getAllCycles(),
                    strategyAPI.getStrategy(),
                ]);
                setCycles(cycleData);
                setSuggestCreateCycle(strategyData.suggestCreateCycle ?? false);
            } catch (error) {
                console.error('Failed to load strategy data:', error);
            } finally {
                setLoading(false);
            }
        };
        loadData();
    }, []);

    // Feedback Modal State
    const [feedbackState, setFeedbackState] = useState<{
        isOpen: boolean;
        cycleId: string | null;
    }>({ isOpen: false, cycleId: null });

    const [dragStartY, setDragStartY] = useState<number | null>(null);
    const [dragOffset, setDragOffset] = useState(0);

    // History Handling
    useEffect(() => {
        const handlePopState = () => {
            if (feedbackState.isOpen) {
                setFeedbackState({ isOpen: false, cycleId: null });
                setDragOffset(0);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [feedbackState.isOpen]);

    // Escape key to dismiss feedback modal
    useEffect(() => {
        if (!feedbackState.isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') closeFeedbackModal(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [feedbackState.isOpen]);

    const closeFeedbackModal = () => {
        setDragOffset(0);
        window.history.back();
    };

    // Form State
    const [selectedAreas, setSelectedAreas] = useState<string[]>([]);
    const [feedbackNote, setFeedbackNote] = useState("");

    const pendingCycle = cycles.find(c => c.status === 'PENDING_APPROVAL' || c.status === 'CHANGES_REQUESTED');
    const approvedCycle = cycles.find(c => c.status === 'APPROVED');
    const activeCycle = cycles.find(c => c.status === 'ACTIVE');

    const handleApprove = async (id: string) => {
        try {
            await strategyAPI.updateCycle(id, { status: 'APPROVED' });
            setCycles(prev => prev.map(c => c.id === id ? { ...c, status: 'APPROVED' } : c));
            setNotice({ message: 'Strategy approved! Content creation will begin shortly.', type: 'success' });
        } catch {
            setNotice({ message: 'Something went wrong. Please try again.', type: 'error' });
        }
    };

    const openFeedbackModal = (id: string) => {
        setFeedbackState({ isOpen: true, cycleId: id });
        window.history.pushState({ modal: 'strategy_feedback' }, '', '#feedback');
        setSelectedAreas([]);
        setFeedbackNote("");
    };

    const submitFeedback = async () => {
        if (!feedbackState.cycleId) return;

        const feedbackData = {
            areas: selectedAreas,
            note: feedbackNote
        };
        const feedbackString = JSON.stringify(feedbackData);

        try {
            await strategyAPI.updateCycle(feedbackState.cycleId, {
                status: 'CHANGES_REQUESTED',
                feedback: feedbackString,
            });
            setCycles(prev => prev.map(c => c.id === feedbackState.cycleId ? {
                ...c,
                status: 'CHANGES_REQUESTED',
                feedback: feedbackString
            } : c));
            setNotice({ message: 'Feedback submitted. Your account manager will review it.', type: 'success' });
        } catch {
            setNotice({ message: 'Something went wrong. Please try again.', type: 'error' });
        }

        window.history.back();
    };

    const toggleArea = (area: string) => {
        setSelectedAreas(prev => prev.includes(area) ? prev.filter(a => a !== area) : [...prev, area]);
    };

    const StrategyCard = ({ cycle, isActionable }: { cycle: StrategyCycle, isActionable: boolean }) => {
        const isChangesRequested = cycle.status === 'CHANGES_REQUESTED';
        const isPendingReview = cycle.status === 'PENDING_APPROVAL' || isChangesRequested;
        const cycleBufferHours = (cycleApprovalBufferMins ?? 4320) / 60;
        const deadline = isPendingReview ? computeCycleApprovalDeadline(cycle, cycleBufferHours) : null;
        const feedbackLocked = isPendingReview && isCyclePastApprovalDeadline(cycle, now, cycleBufferHours);

        return (
            <div className={`rounded-3xl p-6 shadow-sm border relative overflow-hidden ${isActionable ? 'bg-white border-orange-100 shadow-md' : 'bg-slate-50 border-slate-200'}`}>

                {/* Status Badge */}
                <div className="flex justify-between items-start mb-4">
                    <div className="flex flex-col">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Billing Period</span>
                        <h3 className="text-lg font-bold text-slate-800">{cycle.period}</h3>
                        {formatBillingRange(cycle.startDate, cycle.endDate) && (
                            <span className="text-[11px] text-slate-500 mt-0.5">
                                {formatBillingRange(cycle.startDate, cycle.endDate)}
                            </span>
                        )}
                    </div>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wide flex items-center gap-1.5 ${cycle.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                        cycle.status === 'PENDING_APPROVAL' ? 'bg-orange-100 text-orange-700' :
                            cycle.status === 'CHANGES_REQUESTED' ? 'bg-red-100 text-red-700' :
                                cycle.status === 'APPROVED' ? 'bg-blue-100 text-blue-700' :
                                    'bg-slate-200 text-slate-500'
                        }`}>
                        {cycle.status === 'ACTIVE' && <Zap size={12} fill="currentColor" />}
                        {cycle.status === 'PENDING_APPROVAL' && <Clock size={12} />}
                        {cycle.status === 'CHANGES_REQUESTED' && <RefreshCw size={12} />}
                        {cycle.status === 'APPROVED' && <CheckCircle size={12} />}
                        {cycle.status.replace('_', ' ')}
                    </span>
                </div>

                {/* Content */}
                <div className="space-y-5">
                    <div>
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-2">Executive Summary</h4>
                        <p className="text-sm text-slate-700 leading-relaxed font-medium">
                            {cycle.summary}
                        </p>
                    </div>

                    <div className="bg-slate-100/50 rounded-2xl p-4 border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                            <Target size={14} /> Planned Content Mix
                        </h4>
                        <div className="space-y-3">
                            {cycle.plannedPosts.map((post, idx) => (
                                <div key={idx} className="flex items-center justify-between text-sm">
                                    <span className="text-slate-600 font-medium">{post.category}</span>
                                    <div className="flex items-center gap-2">
                                        <div className="w-32 h-2 bg-slate-200 rounded-full overflow-hidden">
                                            <div
                                                className={`h-full rounded-full ${idx % 2 === 0 ? 'bg-orange-400' : 'bg-blue-400'}`}
                                                style={{ width: `${Math.min((post.count / 8) * 100, 100)}%` }}
                                            ></div>
                                        </div>
                                        <span className="font-bold text-slate-800 w-4 text-right">{post.count}</span>
                                    </div>
                                </div>
                            ))}
                            <div className="pt-2 mt-2 border-t border-slate-200 flex justify-between items-center text-xs font-bold text-slate-500">
                                <span>Total Planned Posts</span>
                                <span>{cycle.plannedPosts.reduce((acc, curr) => acc + curr.count, 0)}</span>
                            </div>
                        </div>
                    </div>

                    {/* Planned Schedule */}
                    {/* plannedSchedule added to StrategyCycle in packages/shared -- type will be available after merge */}
                    {((cycle as any).plannedSchedule as Array<{ scheduledFor: string; category: string; postType: string }> | undefined)?.length ? (
                        <div className="bg-slate-100/50 rounded-2xl p-4 border border-slate-100">
                            <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wide mb-3 flex items-center gap-2">
                                <Calendar size={14} /> Planned Schedule
                            </h4>
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs">
                                    <thead>
                                        <tr className="border-b border-slate-200">
                                            <th className="text-left pb-2 pr-3 font-bold text-slate-400 w-6">#</th>
                                            <th className="text-left pb-2 pr-3 font-bold text-slate-400">Archetype</th>
                                            <th className="text-left pb-2 pr-3 font-bold text-slate-400">Type</th>
                                            <th className="text-left pb-2 font-bold text-slate-400">Scheduled For</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {((cycle as any).plannedSchedule as Array<{ scheduledFor: string; category: string; postType: string }>).map((slot, idx) => {
                                            const date = new Date(slot.scheduledFor);
                                            const datePart = date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
                                            const timePart = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                                            return (
                                                <tr key={idx} className="border-b border-slate-100 last:border-0">
                                                    <td className="py-2 pr-3 text-slate-400 font-medium">{idx + 1}</td>
                                                    <td className="py-2 pr-3 text-slate-700 font-medium">{slot.category}</td>
                                                    <td className="py-2 pr-3 text-slate-600">{slot.postType}</td>
                                                    <td className="py-2 text-slate-600">{datePart} &bull; {timePart}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    ) : null}

                    {/* Feedback Display if Changes Requested */}
                    {isChangesRequested && cycle.feedback && (
                        <div className="bg-orange-50 p-4 rounded-xl border border-orange-100 text-orange-900 text-xs">
                            <p className="font-bold flex items-center gap-2 mb-1"><MessageCircle size={14} /> Your Feedback:</p>
                            <p className="opacity-80 line-clamp-2">{JSON.parse(cycle.feedback).note || "Details sent to account manager."}</p>
                        </div>
                    )}

                    {/* Approval deadline countdown */}
                    {isPendingReview && deadline && (
                        <div
                            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-bold ${feedbackLocked ? 'bg-slate-100 text-slate-500' : 'bg-amber-50 text-amber-700 border border-amber-200'}`}
                            aria-label={feedbackLocked ? 'Feedback window closed' : 'Time remaining to request changes'}
                        >
                            {feedbackLocked ? <Lock size={12} /> : <Clock size={12} />}
                            <span>{formatCountdown(deadline, now)}</span>
                        </div>
                    )}
                </div>

                {/* Actions */}
                {isActionable && (
                    <div className="mt-6 grid grid-cols-2 gap-3">
                        {isChangesRequested ? (
                            <div className="col-span-2 bg-slate-100 text-slate-500 py-3 rounded-xl text-center text-xs font-bold">
                                Awaiting Revision from Team
                            </div>
                        ) : instagramEnabled && !instagramConnected ? (
                            <div className="col-span-2 bg-amber-50 text-amber-700 py-3 rounded-xl text-center text-xs font-bold border border-amber-200">
                                Connect Instagram to approve
                            </div>
                        ) : (
                            <>
                                {feedbackLocked ? (
                                    <div className="py-3.5 rounded-xl border border-slate-200 bg-slate-50 text-slate-400 font-bold text-xs flex items-center justify-center gap-2">
                                        <Lock size={16} /> Feedback Closed
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => openFeedbackModal(cycle.id)}
                                        aria-label="Request changes to strategy"
                                        className="py-3.5 rounded-xl border border-slate-200 text-slate-600 font-bold text-xs hover:bg-slate-50 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                    >
                                        <RefreshCw size={16} /> Request Changes
                                    </button>
                                )}
                                <button
                                    onClick={() => handleApprove(cycle.id)}
                                    aria-label="Approve strategy"
                                    className="py-3.5 rounded-xl bg-slate-900 text-white font-bold text-xs shadow-lg shadow-slate-900/20 hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                >
                                    <CheckCircle size={16} /> Approve Strategy
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        );
    };

    if (loading) {
        return (
            <div className="p-4 space-y-4">
                {[1, 2].map(i => <div key={i} className="bg-slate-100 rounded-3xl h-48 animate-pulse" />)}
            </div>
        );
    }

    return (
        <div className="p-4 space-y-8">
            {instagramEnabled && !instagramConnected && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3.5 flex items-center justify-between gap-3">
                    <p className="text-xs text-amber-800 font-medium">Connect Instagram to approve strategies and start publishing.</p>
                    {onConnectInstagram && (
                        <button onClick={onConnectInstagram} className="shrink-0 px-3 py-1.5 bg-amber-600 text-white text-xs font-bold rounded-lg hover:bg-amber-700 transition-colors">
                            Connect
                        </button>
                    )}
                </div>
            )}

            {notice && (
                <ActionNotice
                    message={notice.message}
                    type={notice.type}
                />
            )}

            {/* Pending Action Section */}
            {pendingCycle && (
                <div className="animate-in slide-in-from-top duration-500">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <div className="w-2 h-2 bg-orange-500 rounded-full animate-pulse"></div>
                        <h2 className="text-sm font-bold text-orange-600 uppercase tracking-widest">Action Required</h2>
                    </div>
                    <StrategyCard cycle={pendingCycle} isActionable={true} />
                </div>
            )}

            {/* Approved / Upcoming Section */}
            {approvedCycle && (
                <div className="animate-in slide-in-from-top duration-500">
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                        <h2 className="text-sm font-bold text-blue-600 uppercase tracking-widest">Upcoming Strategy</h2>
                    </div>
                    <StrategyCard cycle={approvedCycle} isActionable={false} />
                </div>
            )}

            {!pendingCycle && !approvedCycle && !activeCycle && (
                suggestCreateCycle ? (
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 p-6 rounded-3xl border border-blue-100 text-center">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm text-blue-600">
                            <Zap size={24} />
                        </div>
                        <h3 className="font-bold text-blue-900">Setting Up Your Strategy</h3>
                        <p className="text-xs text-blue-700 mt-1">Your first content strategy is being prepared. It will appear here shortly.</p>
                    </div>
                ) : (
                    <div className="bg-gradient-to-r from-green-50 to-emerald-50 p-6 rounded-3xl border border-green-100 text-center">
                        <div className="w-12 h-12 bg-white rounded-full flex items-center justify-center mx-auto mb-3 shadow-sm text-green-600">
                            <CheckCircle size={24} />
                        </div>
                        <h3 className="font-bold text-green-900">All Caught Up!</h3>
                        <p className="text-xs text-green-700 mt-1">Your next strategy cycle will be created when your billing period begins.</p>
                    </div>
                )
            )}

            {/* Active Strategy Section */}
            {activeCycle && (
                <div>
                    <div className="flex items-center gap-2 mb-3 px-1">
                        <div className="w-2 h-2 bg-green-500 rounded-full"></div>
                        <h2 className="text-sm font-bold text-slate-400 uppercase tracking-widest">Active Cycle</h2>
                    </div>
                    <StrategyCard cycle={activeCycle} isActionable={false} />
                </div>
            )}

            <div className="h-10"></div>

            {/* Feedback Modal / Bottom Sheet */}
            {feedbackState.isOpen && (
                <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    {/* Backdrop click */}
                    <div className="absolute inset-0" onClick={closeFeedbackModal}></div>

                    <div
                        className="bg-white w-full max-w-md rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl animate-in slide-in-from-bottom duration-300 relative z-10"
                        style={{ transform: `translateY(${Math.max(0, dragOffset)}px)` }}
                        onTouchStart={(e) => {
                            setDragStartY(e.touches[0].clientY);
                        }}
                        onTouchMove={(e) => {
                            if (dragStartY !== null) {
                                const offset = e.touches[0].clientY - dragStartY;
                                setDragOffset(offset);
                            }
                        }}
                        onTouchEnd={() => {
                            if (dragOffset > 100) {
                                closeFeedbackModal();
                            } else {
                                setDragOffset(0);
                            }
                            setDragStartY(null);
                        }}
                    >

                        {/* Drag Handle */}
                        <div className="w-12 h-1.5 bg-slate-200 rounded-full mx-auto mb-6 shrink-0 sm:hidden"></div>

                        <div className="flex justify-between items-center mb-6">
                            <div>
                                <h3 className="text-lg font-bold text-slate-800">Strategy Feedback</h3>
                                <p className="text-xs text-slate-500">Help us refine the plan</p>
                            </div>
                        </div>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">What needs improvement?</label>
                                <div className="space-y-2">
                                    {['Posting frequency', 'Posting timing', 'Content topics', 'Content variety', 'Other'].map(area => (
                                        <button
                                            key={area}
                                            onClick={() => toggleArea(area)}
                                            className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all text-sm font-medium ${selectedAreas.includes(area)
                                                ? 'bg-orange-50 border-orange-200 text-orange-800 shadow-sm'
                                                : 'bg-white border-slate-100 text-slate-600 hover:bg-slate-50'
                                                }`}
                                        >
                                            {area}
                                            {selectedAreas.includes(area) && <CheckCircle size={16} className="text-orange-500" />}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Additional Details</label>
                                <textarea
                                    rows={3}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none transition-all resize-none"
                                    placeholder="Please provide specific context..."
                                    value={feedbackNote}
                                    onChange={(e) => setFeedbackNote(e.target.value)}
                                ></textarea>
                            </div>

                            <button
                                onClick={submitFeedback}
                                disabled={selectedAreas.length === 0}
                                className="w-full bg-slate-900 text-white font-bold py-3.5 rounded-2xl shadow-lg hover:bg-slate-800 active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Send size={18} /> Submit Feedback
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};

export default Strategy;
