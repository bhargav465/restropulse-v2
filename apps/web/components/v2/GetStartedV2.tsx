import React, { useEffect, useMemo, useState } from 'react';
import { Restaurant } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import {
    computeOnboardingProgress,
    OnboardingProgress,
    OnboardingStep,
    setOnboardingDismissed,
} from './onboarding';
import { GRADIENT, TOKENS } from './theme';

/**
 * Get started bucket (design.md §4.3) — a soft-lavender welcome hero with a
 * completion checklist, modelled on the "flying to success" onboarding pattern
 * but recoloured to Electric Lavender. Left column: greeting, launch art and a
 * big X/N progress readout; right column: the checklist, with the next
 * incomplete step lifted into an elevated white card. Completion is COMPUTED
 * FROM DATA; the only persisted state is the user's dismissal. Each step links
 * into the bucket where it's completed.
 */

interface GetStartedV2Props {
    restaurantData: Restaurant;
    onNavigate: (bucket: 'PROFILE' | 'CONTENT' | 'ORDERING' | 'DESIGN') => void;
    onDismiss: () => void;
}

/** Lavender "launch to success" illustration — self-contained inline SVG. */
const LaunchArt: React.FC = () => (
    <svg viewBox="0 0 240 200" className="w-full max-w-[260px] h-auto" role="img" aria-label="Rocket launching">
        <defs>
            <linearGradient id="gs-body" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor={TOKENS.primaryStrong} />
                <stop offset="0.55" stopColor={TOKENS.primary} />
                <stop offset="1" stopColor={TOKENS.info} />
            </linearGradient>
            <linearGradient id="gs-flame" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor={TOKENS.warning} />
                <stop offset="1" stopColor={TOKENS.danger} />
            </linearGradient>
        </defs>
        {/* soft orbit + sparkles */}
        <circle cx="120" cy="96" r="78" fill={TOKENS.surface} opacity="0.55" />
        <circle cx="46" cy="52" r="3" fill={TOKENS.orchid} />
        <circle cx="196" cy="70" r="4" fill={TOKENS.primary} opacity="0.7" />
        <circle cx="188" cy="140" r="2.5" fill={TOKENS.info} />
        <circle cx="58" cy="150" r="3.5" fill={TOKENS.primaryStrong} opacity="0.6" />
        {/* rocket */}
        <g transform="rotate(30 120 100)">
            <path d="M120 34c20 14 30 40 30 70 0 14-4 26-10 36h-40c-6-10-10-22-10-36 0-30 10-56 30-70z" fill="url(#gs-body)" />
            <circle cx="120" cy="86" r="14" fill={TOKENS.surface} />
            <circle cx="120" cy="86" r="8" fill={TOKENS.primarySoft} />
            <path d="M90 128c-12 4-20 12-22 24 12 2 22-1 30-8z" fill={TOKENS.primaryStrong} />
            <path d="M150 128c12 4 20 12 22 24-12 2-22-1-30-8z" fill={TOKENS.primaryStrong} />
            <path d="M104 140h32c-3 18-10 30-16 34-6-4-13-16-16-34z" fill="url(#gs-flame)" />
        </g>
    </svg>
);

/** One checklist row — a full-width button; the "next" step is highlighted. */
const StepItem: React.FC<{ step: OnboardingStep; highlighted: boolean; onGo: () => void }> = ({
    step,
    highlighted,
    onGo,
}) => (
    <button
        type="button"
        onClick={onGo}
        disabled={step.done}
        aria-current={highlighted ? 'step' : undefined}
        className={`group w-full text-left rounded-2xl p-4 sm:p-5 flex items-start gap-4 transition-all ${
            step.done
                ? 'cursor-default bg-surface/40'
                : highlighted
                    ? 'bg-surface shadow-[0_10px_34px_rgba(157,78,221,0.14)] ring-1 ring-primary/25'
                    : 'bg-surface/40 hover:bg-surface hover:shadow-sm cursor-pointer'
        }`}
    >
        {/* circular indicator */}
        <span
            className={`mt-0.5 w-6 h-6 shrink-0 rounded-full flex items-center justify-center text-[11px] font-bold transition-colors ${
                step.done
                    ? 'bg-success text-white'
                    : highlighted
                        ? 'border-2 border-primary-strong text-primary-strong'
                        : 'border-2 border-line text-transparent group-hover:border-primary'
            }`}
            aria-hidden="true"
        >
            {step.done ? '✓' : ''}
        </span>
        <span className="flex-1 min-w-0">
            <span className={`block font-semibold text-[15px] ${step.done ? 'text-muted line-through' : 'text-ink'}`}>
                {step.title}
            </span>
            <span className="block text-sm text-muted mt-1 leading-relaxed">{step.description}</span>
        </span>
        {!step.done && (
            <span
                className={`mt-0.5 shrink-0 text-lg leading-none transition-transform ${
                    highlighted ? 'text-primary-strong' : 'text-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5'
                }`}
                aria-hidden="true"
            >
                →
            </span>
        )}
    </button>
);

const GetStartedV2: React.FC<GetStartedV2Props> = ({ restaurantData, onNavigate, onDismiss }) => {
    const [progress, setProgress] = useState<OnboardingProgress>(() =>
        computeOnboardingProgress({ restaurant: restaurantData }),
    );

    useEffect(() => {
        let cancelled = false;
        (async () => {
            let menuItemCount = 0;
            try {
                const items = await orderingAdminAPI.getItems();
                menuItemCount = items.length;
            } catch { /* new restaurants have no menu yet */ }
            if (!cancelled) {
                setProgress(computeOnboardingProgress({ restaurant: restaurantData, menuItemCount }));
            }
        })();
        return () => { cancelled = true; };
    }, [restaurantData]);

    const handleDismiss = () => {
        setOnboardingDismissed(restaurantData.id, true);
        onDismiss();
    };

    // The first not-yet-done step is the one we spotlight in a raised card.
    const firstIncomplete = useMemo(
        () => progress.steps.findIndex((s) => !s.done),
        [progress.steps],
    );

    const greetName = (restaurantData.name || '').trim();

    return (
        <div className="space-y-6">
            <section className="rounded-3xl bg-primary-soft/70 border border-line p-6 sm:p-8 lg:p-10">
                <div className="grid lg:grid-cols-2 gap-8 lg:gap-12 items-center">
                    {/* Left — greeting, art, progress */}
                    <div>
                        <span className="text-4xl leading-none" aria-hidden="true">👋</span>
                        {greetName && (
                            <p className="mt-4 text-xs font-bold uppercase tracking-widest text-primary-strong">
                                Welcome, {greetName}
                            </p>
                        )}
                        <h2 className="mt-2 text-3xl sm:text-4xl font-bold text-ink leading-[1.15] tracking-tight whitespace-pre-line">
                            {progress.allDone ? "You're all set for success! 🎉" : "Let's get you set up\nfor success!"}
                        </h2>
                        <p className="mt-3 text-muted text-sm sm:text-base leading-relaxed max-w-md">
                            {progress.allDone
                                ? 'Every step is done — your restaurant is live and ready to grow.'
                                : 'A few quick steps to get your restaurant fully live. Knock them out in any order.'}
                        </p>

                        <div className="mt-8 flex justify-center lg:justify-start">
                            <LaunchArt />
                        </div>

                        {/* Progress readout */}
                        <div className="mt-8 max-w-md">
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-ink tabular-nums">{progress.completed}</span>
                                <span className="text-sm font-semibold text-muted">/{progress.total} Completed</span>
                            </div>
                            <div
                                className="mt-3 h-2.5 rounded-full bg-surface/80 overflow-hidden"
                                role="progressbar"
                                aria-valuenow={progress.percent}
                                aria-valuemin={0}
                                aria-valuemax={100}
                            >
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{ width: `${progress.percent}%`, background: GRADIENT }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Right — checklist */}
                    <div className="space-y-3">
                        {progress.steps.map((step, i) => (
                            <StepItem
                                key={step.id}
                                step={step}
                                highlighted={i === firstIncomplete}
                                onGo={() => onNavigate(step.bucket)}
                            />
                        ))}
                    </div>
                </div>

                <div className="mt-8 flex justify-end">
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="text-xs font-semibold text-muted hover:text-ink transition-colors"
                    >
                        {progress.allDone ? 'Hide this' : "I'll finish later"}
                    </button>
                </div>
            </section>
        </div>
    );
};

export default GetStartedV2;
