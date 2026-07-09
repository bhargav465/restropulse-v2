import React, { useEffect, useState } from 'react';
import { Restaurant } from '@restropulse/shared';
import { orderingAdminAPI } from '../../api';
import {
    computeOnboardingProgress,
    OnboardingProgress,
    OnboardingStep,
    setOnboardingDismissed,
} from './onboarding';

/**
 * Get started bucket (design.md §4.3) — a 5-step onboarding checklist whose
 * completion is computed from existing data. The only persisted state is the
 * user's dismissal. Each step links into the bucket where it's completed.
 */

interface GetStartedV2Props {
    restaurantData: Restaurant;
    onNavigate: (bucket: 'CONTENT' | 'ORDERING' | 'DESIGN') => void;
    onDismiss: () => void;
}

const StepRow: React.FC<{ step: OnboardingStep; index: number; onGo: () => void }> = ({ step, index, onGo }) => (
    <li className="flex items-start gap-4 py-4 border-b border-line last:border-b-0">
        <span
            className={`w-7 h-7 shrink-0 rounded-full flex items-center justify-center text-sm font-semibold ${
                step.done ? 'bg-success text-white' : 'bg-primary-soft text-primary-strong'
            }`}
            aria-hidden="true"
        >
            {step.done ? '✓' : index + 1}
        </span>
        <div className="flex-1 min-w-0">
            <p className={`font-semibold text-sm ${step.done ? 'text-muted line-through' : 'text-ink'}`}>
                {step.title}
            </p>
            <p className="text-sm text-muted mt-0.5 leading-relaxed">{step.description}</p>
        </div>
        {!step.done && (
            <button
                type="button"
                onClick={onGo}
                className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-primary-strong hover:opacity-90 transition-opacity"
            >
                Set up
            </button>
        )}
    </li>
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

    return (
        <div className="space-y-6">
            {/* Progress header */}
            <div className="bg-surface rounded-2xl p-6 border border-line">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                        <h3 className="text-base font-semibold text-ink">
                            {progress.allDone ? "You're all set 🎉" : 'Get your restaurant live'}
                        </h3>
                        <p className="text-sm text-muted mt-0.5">
                            {progress.completed} of {progress.total} steps complete
                        </p>
                    </div>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="text-xs font-semibold text-muted hover:text-ink transition-colors"
                    >
                        Dismiss
                    </button>
                </div>
                <div className="mt-4 h-2 rounded-full bg-primary-soft overflow-hidden" role="progressbar" aria-valuenow={progress.percent} aria-valuemin={0} aria-valuemax={100}>
                    <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${progress.percent}%` }} />
                </div>
            </div>

            {/* Checklist */}
            <div className="bg-surface rounded-2xl px-6 border border-line">
                <ol>
                    {progress.steps.map((step, i) => (
                        <StepRow key={step.id} step={step} index={i} onGo={() => onNavigate(step.bucket)} />
                    ))}
                </ol>
            </div>
        </div>
    );
};

export default GetStartedV2;
