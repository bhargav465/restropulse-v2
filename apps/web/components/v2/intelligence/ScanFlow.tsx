import React, { useEffect, useRef, useState } from 'react';
import type { IntelligenceReport, IntelligenceScan, ScanStatus } from '@restropulse/shared';
import { ActionCard } from '../primitives';
import { ScanStepper } from './primitives';
import PlacePickerHost from './PlacePickerHost';
import type { PlacePickerSelection } from './place-picker-engine';

/**
 * ScanFlow (DESIGN §2) — the empty state ("Run your first scan" form + teaser
 * cards) and the poll-driven pipeline stepper. Owns the start→poll→fetch-report
 * lifecycle; polls every 3s until COMPLETED (then hands the report up) or FAILED
 * (stepper shows the stage-labeled error + retry).
 *
 * The scan API is injected so the poll flow is unit-testable with fake timers.
 */

export const SCAN_POLL_MS = 3000;

export interface ScanApi {
    startScan: (body: { name?: string; city?: string; force?: boolean; placeId?: string }) => Promise<{ scanId: string }>;
    getScan: (scanId: string) => Promise<IntelligenceScan>;
    getReport: (reportId: string) => Promise<IntelligenceReport>;
}

interface ScanFlowProps {
    defaults: { name: string; city: string };
    api: ScanApi;
    onReport: (report: IntelligenceReport) => void;
    /** 'first-run' shows the empty-state form; 'rescan' auto-starts a scan. */
    variant: 'first-run' | 'rescan';
    onCancel?: () => void;
    force?: boolean;
    /** Persist the confirmed Google placeId to the restaurant profile (Brief 10). */
    onPlaceConfirmed?: (selection: PlacePickerSelection) => void;
}

const TEASERS: Array<{ emoji: string; title: string; description: string }> = [
    { emoji: '🥊', title: 'Competitor benchmarks', description: 'See how your rating, reviews and prices stack up against restaurants around the corner.' },
    { emoji: '🔥', title: 'Peak-hour heatmap', description: 'Know exactly when orders surge so staffing and prep always match demand.' },
    { emoji: '💬', title: 'Review sentiment', description: 'Every review, summarised: what guests love, what’s slipping, and what to fix first.' },
    { emoji: '🎯', title: 'One-click actions', description: 'Turn each finding into a post, a campaign or a profile fix — without leaving RestroPulse.' },
];

const ScanFlow: React.FC<ScanFlowProps> = ({ defaults, api, onReport, variant, onCancel, force, onPlaceConfirmed }) => {
    const [name, setName] = useState(defaults.name);
    const [city, setCity] = useState(defaults.city);
    const [placeId, setPlaceId] = useState<string | undefined>();
    const [scanId, setScanId] = useState<string | null>(null);
    const [status, setStatus] = useState<ScanStatus>('QUEUED');
    const [error, setError] = useState<string | undefined>();
    const [starting, setStarting] = useState(false);
    const [manualEntry, setManualEntry] = useState(false);
    const startedRef = useRef(false);

    const start = async (overrides?: { name?: string; city?: string; placeId?: string }) => {
        setError(undefined);
        setStatus('QUEUED');
        setStarting(true);
        try {
            const { scanId: id } = await api.startScan({
                name: overrides?.name ?? name,
                city: overrides?.city ?? city,
                force,
                placeId: overrides?.placeId ?? placeId,
            });
            setScanId(id);
        } catch (e) {
            setStatus('FAILED');
            setError(e instanceof Error ? e.message : 'Could not start the scan.');
        } finally {
            setStarting(false);
        }
    };

    // Owner confirmed their restaurant in the Google picker: persist the placeId,
    // pre-fill name/city, and kick off the scan straight to Place Details.
    const handlePlaceConfirmed = (sel: PlacePickerSelection) => {
        setName(sel.name);
        setCity(sel.city);
        setPlaceId(sel.placeId);
        onPlaceConfirmed?.(sel);
        void start({ name: sel.name, city: sel.city, placeId: sel.placeId });
    };

    // Auto-start a re-scan on mount (once).
    useEffect(() => {
        if (variant === 'rescan' && !startedRef.current) {
            startedRef.current = true;
            void start();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [variant]);

    // Poll the scan while we have an id and it isn't terminal.
    useEffect(() => {
        if (!scanId) return;
        let cancelled = false;
        const id = setInterval(async () => {
            try {
                const scan = await api.getScan(scanId);
                if (cancelled) return;
                setStatus(scan.status);
                if (scan.status === 'COMPLETED' && scan.reportId) {
                    clearInterval(id);
                    const report = await api.getReport(scan.reportId);
                    if (!cancelled) onReport(report);
                } else if (scan.status === 'FAILED') {
                    clearInterval(id);
                    setError(scan.error || 'The scan failed before it finished.');
                }
            } catch (e) {
                if (cancelled) return;
                clearInterval(id);
                setStatus('FAILED');
                setError(e instanceof Error ? e.message : 'Lost contact with the scan.');
            }
        }, SCAN_POLL_MS);
        return () => {
            cancelled = true;
            clearInterval(id);
        };
    }, [scanId]); // eslint-disable-line react-hooks/exhaustive-deps

    const scanning = starting || (scanId !== null && status !== 'FAILED');
    const showStepper = scanning || status === 'FAILED';

    const retry = () => {
        setScanId(null);
        void start();
    };

    if (showStepper) {
        return (
            <div className="space-y-4">
                <ScanStepper status={status} error={error} onRetry={status === 'FAILED' ? retry : undefined} />
                {variant === 'rescan' && status !== 'FAILED' && onCancel && (
                    <button type="button" onClick={onCancel} className="text-xs font-semibold text-muted hover:text-ink">
                        ← Back to your report
                    </button>
                )}
            </div>
        );
    }

    // Empty state (no report yet).
    return (
        <div className="space-y-6">
            <div className="bg-banner rounded-2xl p-8 text-white">
                <div className="text-4xl mb-3" aria-hidden="true">📊</div>
                <h3 className="text-xl font-semibold">Run your first scan</h3>
                <p className="text-sidebar-ink text-sm mt-2 max-w-xl leading-relaxed">
                    We’ll find you on Google, scan nearby competitors, and build a RestroScore with a prioritized action plan — in under a minute.
                </p>

                {manualEntry ? (
                    <form
                        onSubmit={(e) => {
                            e.preventDefault();
                            setPlaceId(undefined);
                            void start();
                        }}
                        className="mt-5 flex flex-col sm:flex-row gap-3 max-w-xl"
                    >
                        <input
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            placeholder="Restaurant name"
                            aria-label="Restaurant name"
                            className="flex-1 rounded-lg px-3 py-2 text-sm text-ink bg-white/95 placeholder:text-muted focus:outline-none"
                        />
                        <input
                            value={city}
                            onChange={(e) => setCity(e.target.value)}
                            placeholder="City"
                            aria-label="City"
                            className="sm:w-40 rounded-lg px-3 py-2 text-sm text-ink bg-white/95 placeholder:text-muted focus:outline-none"
                        />
                        <button
                            type="submit"
                            disabled={starting || !name.trim()}
                            className="rounded-lg bg-primary-strong text-white px-5 py-2 text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 whitespace-nowrap"
                        >
                            {starting ? 'Starting…' : 'Run scan'}
                        </button>
                    </form>
                ) : (
                    <div className="mt-5 max-w-xl rounded-xl bg-white/95 p-4">
                        <PlacePickerHost
                            onConfirm={handlePlaceConfirmed}
                            onCancel={() => setManualEntry(true)}
                        />
                    </div>
                )}
            </div>

            {error && <p className="text-sm text-danger">{error}</p>}

            <div className="grid sm:grid-cols-2 gap-4">
                {TEASERS.map((t) => (
                    <ActionCard key={t.title} emoji={t.emoji} title={t.title} description={t.description} />
                ))}
            </div>
        </div>
    );
};

export default ScanFlow;
