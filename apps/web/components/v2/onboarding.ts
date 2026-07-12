import { Restaurant } from '@restropulse/shared';

/**
 * Onboarding checklist logic (design.md §4.3) — pure and framework-free so it
 * can be unit-tested and shared by GetStartedV2 (the page) and ShellV2 (the
 * sidebar progress chip). Completion is COMPUTED FROM DATA, never stored;
 * only the user's dismissal of the checklist is persisted (localStorage).
 */

export type OnboardingStepId =
    | 'profile'
    | 'instagram'
    | 'menu'
    | 'storefront'
    | 'campaign';

export interface OnboardingStep {
    id: OnboardingStepId;
    title: string;
    description: string;
    /** Sidebar bucket to jump to when the user acts on this step. */
    bucket: 'PROFILE' | 'CONTENT' | 'ORDERING' | 'DESIGN';
    done: boolean;
}

/**
 * Everything the checklist needs, assembled by the caller from existing APIs
 * (no new endpoints). Counts default to 0 so partial data still renders.
 */
export interface OnboardingSignals {
    restaurant: Restaurant;
    menuItemCount?: number;
    campaignsSent?: number;
}

/**
 * Profile is "done" once Basics + Address are filled (Brief 04): a name, at
 * least one cuisine signal, and a real address (line1 + city + pincode). Typed
 * against the `Restaurant` shape — no untyped probing.
 */
function isProfileComplete(r: Restaurant): boolean {
    const hasName = typeof r.name === 'string' && r.name.trim().length > 0;
    const hasCuisine = (r.cuisineTags?.length ?? 0) > 0 || (typeof r.cuisine === 'string' && r.cuisine.trim().length > 0);
    const hasAddress = Boolean(r.address?.line1 && r.address?.city && r.address?.pincode);
    return hasName && hasCuisine && hasAddress;
}

/** Storefront is "live" once it has a slug and the store is switched on. */
function isStorefrontLive(r: Restaurant): boolean {
    return Boolean(r.slug && r.slug.trim().length > 0) && r.storeOpen === true;
}

export function computeOnboardingSteps(signals: OnboardingSignals): OnboardingStep[] {
    const { restaurant, menuItemCount = 0, campaignsSent = 0 } = signals;
    return [
        {
            id: 'profile',
            title: 'Complete your restaurant profile',
            description: 'Name, cuisine, address and logo — the basics your storefront and posts are built on.',
            bucket: 'PROFILE',
            done: isProfileComplete(restaurant),
        },
        {
            id: 'instagram',
            title: 'Connect Instagram',
            description: 'Link your account so approved posts publish automatically.',
            bucket: 'CONTENT',
            done: restaurant.integrations?.instagram === true,
        },
        {
            id: 'menu',
            title: 'Add your menu',
            description: 'Categories and dishes power your online-ordering storefront.',
            bucket: 'ORDERING',
            done: menuItemCount > 0,
        },
        {
            id: 'storefront',
            title: 'Publish your storefront',
            description: 'Give it a link, set your theme and open the store for orders.',
            bucket: 'DESIGN',
            done: isStorefrontLive(restaurant),
        },
        {
            id: 'campaign',
            title: 'Send your first campaign',
            description: 'Reach past guests with an offer and start tracking ROI.',
            bucket: 'ORDERING',
            done: campaignsSent > 0,
        },
    ];
}

export interface OnboardingProgress {
    steps: OnboardingStep[];
    completed: number;
    total: number;
    /** 0–100, rounded. */
    percent: number;
    allDone: boolean;
}

export function computeOnboardingProgress(signals: OnboardingSignals): OnboardingProgress {
    const steps = computeOnboardingSteps(signals);
    const completed = steps.filter((s) => s.done).length;
    const total = steps.length;
    return {
        steps,
        completed,
        total,
        percent: total === 0 ? 0 : Math.round((completed / total) * 100),
        allDone: completed === total,
    };
}

// ----- Dismissal persistence (the only piece of state we store) -----

const DISMISS_PREFIX = 'rp_onboarding_dismissed:';

function dismissKey(restaurantId: string): string {
    return `${DISMISS_PREFIX}${restaurantId}`;
}

export function isOnboardingDismissed(restaurantId: string): boolean {
    try {
        return localStorage.getItem(dismissKey(restaurantId)) === 'true';
    } catch {
        return false;
    }
}

export function setOnboardingDismissed(restaurantId: string, dismissed: boolean): void {
    try {
        if (dismissed) localStorage.setItem(dismissKey(restaurantId), 'true');
        else localStorage.removeItem(dismissKey(restaurantId));
    } catch {
        /* storage unavailable — non-fatal, checklist just reappears next load */
    }
}
