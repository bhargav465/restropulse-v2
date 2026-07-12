import React from 'react';
import type { PillarScore, ScanStatus } from '@restropulse/shared';
import { TOKENS, intensity, DELTA_TEXT } from '../theme';
import { SCAN_STAGE_ORDER, SCAN_STAGE_LABELS, SCAN_STAGE_HINTS, stageState } from './scan-status';

/**
 * Shared intelligence UI atoms (DESIGN §5). Hand-rolled SVG for the dial/bars
 * keeps exact token control (no chart-lib theming) and zero new deps. Tokens
 * only — colors come from theme.ts (`TOKENS`, `intensity`) and semantic classes.
 */

export type Grade = 'A' | 'B' | 'C' | 'D' | 'F';

/** Human-friendly pillar labels keyed by PillarScore.key. */
export const PILLAR_LABELS: Record<PillarScore['key'], string> = {
    profile: 'Profile',
    reviews: 'Reviews',
    photos: 'Photos',
    website: 'Website',
    competition: 'Competition',
    momentum: 'Momentum',
};

/** Grade → semantic text color. A/B strong, C neutral-primary, D warn, F danger. */
export function gradeTextClass(grade: Grade): string {
    switch (grade) {
        case 'A':
        case 'B':
            return 'text-success';
        case 'C':
            return 'text-primary-strong';
        case 'D':
            return 'text-warning';
        default:
            return 'text-danger';
    }
}

// ---------------------------------------------------------------------------
// ScoreDial — the RestroScore gauge (DESIGN §3): SVG ring, primaryStrong on a
// primarySoft track, score + grade centered, optional delta as colored text.
// ---------------------------------------------------------------------------

export const ScoreDial: React.FC<{
    score: number;
    grade: Grade;
    size?: number;
    delta?: number;
    label?: string;
}> = ({ score, grade, size = 140, delta, label = 'RestroScore' }) => {
    const stroke = 12;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const frac = Math.max(0, Math.min(1, score / 100));
    const filled = frac * c;
    const deltaTone = delta === undefined || delta === 0 ? 'neutral' : delta > 0 ? 'up' : 'down';

    return (
        <div className="flex flex-col items-center" role="img" aria-label={`${label} ${score} out of 100, grade ${grade}`}>
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
                <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={TOKENS.primarySoft} strokeWidth={stroke} />
                <circle
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={TOKENS.primaryStrong}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={`${filled} ${c - filled}`}
                />
            </svg>
            {/* Center content is absolutely stacked over the (rotated) svg. */}
            <div className="flex flex-col items-center" style={{ marginTop: -size / 2 - 18, height: size / 2, justifyContent: 'center' }}>
                <span className="text-[34px] font-semibold text-ink leading-none tabular-nums">{score}</span>
                <span className={`text-sm font-bold ${gradeTextClass(grade)}`}>Grade {grade}</span>
            </div>
            <div className="mt-1 text-center" style={{ marginTop: size / 2 - 10 }}>
                <p className="text-[11px] uppercase tracking-wider text-muted font-semibold">{label}</p>
                {delta !== undefined && (
                    <p className={`text-xs font-semibold ${DELTA_TEXT[deltaTone]}`}>
                        {delta > 0 ? '▲' : delta < 0 ? '▼' : '■'} {delta > 0 ? '+' : ''}{delta} vs last scan
                    </p>
                )}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// PillarBar — one of the six mini bars in the header (DESIGN §3). Clickable →
// scrolls to that pillar's checks. Fill via intensity(score/100).
// ---------------------------------------------------------------------------

export const PillarBar: React.FC<{
    pillar: PillarScore;
    onSelect?: (key: PillarScore['key']) => void;
}> = ({ pillar, onSelect }) => {
    const label = PILLAR_LABELS[pillar.key];
    return (
        <button
            type="button"
            onClick={onSelect ? () => onSelect(pillar.key) : undefined}
            className="text-left w-full group"
            aria-label={`${label}: grade ${pillar.grade}, score ${pillar.score}`}
        >
            <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-semibold text-ink group-hover:text-primary-strong transition-colors">{label}</span>
                <span className={`text-xs font-bold ${gradeTextClass(pillar.grade)}`}>{pillar.grade}</span>
            </div>
            <div className="h-2 rounded-full bg-primary-soft overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${pillar.score}%`, background: intensity(pillar.score / 100) }} />
            </div>
        </button>
    );
};

// ---------------------------------------------------------------------------
// ThreatBar — compact competitor threat meter (DESIGN §4.2 table).
// ---------------------------------------------------------------------------

export const ThreatBar: React.FC<{ value: number; className?: string }> = ({ value, className = '' }) => (
    <div className={`flex items-center gap-2 ${className}`} title={`Threat ${Math.round(value)}/100`}>
        <div className="h-1.5 w-16 rounded-full bg-primary-soft overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, value))}%`, background: intensity(value / 100) }} />
        </div>
        <span className="text-xs font-semibold text-muted tabular-nums">{Math.round(value)}</span>
    </div>
);

// ---------------------------------------------------------------------------
// CheckRow — a pass/fail deterministic check (DESIGN §4.4). Pass = success
// check, fail = warning fix icon; optional "Fix" affordance on failing rows.
// ---------------------------------------------------------------------------

export const CheckRow: React.FC<{
    label: string;
    pass: boolean;
    note?: string;
    action?: { label: string; onClick: () => void; href?: string };
}> = ({ label, pass, note, action }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-line last:border-b-0">
        <span className={`mt-0.5 shrink-0 ${pass ? 'text-success' : 'text-warning'}`} aria-hidden="true">
            {pass ? (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 6L9 17l-5-5" />
                </svg>
            ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L14.7 3.9a2 2 0 00-3.4 0z" />
                </svg>
            )}
        </span>
        <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${pass ? 'text-ink' : 'text-ink'}`}>{label}</p>
            {note && <p className="text-xs text-muted mt-0.5 leading-relaxed">{note}</p>}
        </div>
        {!pass && action && (
            <button
                type="button"
                onClick={action.onClick}
                title={action.href}
                className="shrink-0 text-xs font-semibold text-primary-strong hover:underline whitespace-nowrap"
            >
                {action.label} →
            </button>
        )}
    </div>
);

// ---------------------------------------------------------------------------
// KeywordChips — chip groups; each chip can seed a Content Engine draft.
// ---------------------------------------------------------------------------

export const KeywordChips: React.FC<{
    title: string;
    keywords: string[];
    tone?: 'default' | 'negative';
    onDraft?: (keyword: string) => void;
}> = ({ title, keywords, tone = 'default', onDraft }) => {
    if (!keywords.length) return null;
    const chipClass =
        tone === 'negative'
            ? 'border-danger/40 text-danger bg-surface'
            : 'border-line text-ink bg-surface hover:border-primary/40 hover:bg-primary-soft';
    return (
        <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">{title}</p>
            <div className="flex flex-wrap gap-2">
                {keywords.map((kw) => (
                    <button
                        key={kw}
                        type="button"
                        onClick={onDraft ? () => onDraft(kw) : undefined}
                        disabled={!onDraft || tone === 'negative'}
                        title={onDraft && tone !== 'negative' ? 'Draft a post from this keyword' : undefined}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition-colors ${chipClass} ${
                            onDraft && tone !== 'negative' ? 'cursor-pointer' : 'cursor-default'
                        }`}
                    >
                        {kw}
                        {onDraft && tone !== 'negative' && <span className="text-primary-strong font-semibold">→ Draft post</span>}
                    </button>
                ))}
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// ScanStepper — pipeline progress (DESIGN §2). Active stage pulses text-primary;
// FAILED shows the stage-labeled error + retry.
// ---------------------------------------------------------------------------

export const ScanStepper: React.FC<{
    status: ScanStatus;
    error?: string;
    onRetry?: () => void;
}> = ({ status, error, onRetry }) => {
    const failed = status === 'FAILED';
    return (
        <div className="bg-surface rounded-2xl p-6 border border-line max-w-xl">
            <h3 className="text-base font-semibold text-ink">
                {failed ? 'Scan stopped' : status === 'COMPLETED' ? 'Scan complete' : 'Scanning your restaurant…'}
            </h3>
            <p className="text-sm text-muted mt-1">
                {failed ? SCAN_STAGE_HINTS.FAILED : status === 'COMPLETED' ? SCAN_STAGE_HINTS.COMPLETED : 'This usually takes under a minute. You can keep working — we’ll update this automatically.'}
            </p>

            <ol className="mt-5 space-y-3" aria-label="Scan progress">
                {SCAN_STAGE_ORDER.map((stage) => {
                    const state = failed ? 'pending' : stageState(stage, status);
                    return (
                        <li key={stage} className="flex items-start gap-3">
                            <span
                                className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-xs font-semibold ${
                                    state === 'done'
                                        ? 'bg-primary-strong text-white'
                                        : state === 'active'
                                          ? 'bg-primary-soft text-primary-strong'
                                          : 'bg-canvas text-muted border border-line'
                                }`}
                                aria-hidden="true"
                            >
                                {state === 'done' ? (
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M20 6L9 17l-5-5" />
                                    </svg>
                                ) : (
                                    SCAN_STAGE_ORDER.indexOf(stage) + 1
                                )}
                            </span>
                            <div>
                                <p className={`text-sm font-semibold ${state === 'active' ? 'text-primary animate-pulse' : state === 'done' ? 'text-ink' : 'text-muted'}`}>
                                    {SCAN_STAGE_LABELS[stage]}
                                </p>
                                {state === 'active' && <p className="text-xs text-muted mt-0.5">{SCAN_STAGE_HINTS[stage]}</p>}
                            </div>
                        </li>
                    );
                })}
            </ol>

            {failed && (
                <div className="mt-5 rounded-xl border border-danger/40 bg-surface p-4">
                    <p className="text-sm text-danger font-medium">{error || 'The scan failed. Please try again.'}</p>
                    {onRetry && (
                        <button
                            type="button"
                            onClick={onRetry}
                            className="mt-3 px-4 py-2 rounded-lg bg-primary-strong text-white text-sm font-semibold hover:opacity-90 transition-opacity"
                        >
                            Retry scan
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};
