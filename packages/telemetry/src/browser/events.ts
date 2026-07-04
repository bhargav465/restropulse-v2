/**
 * Client-side event tracking helpers.
 *
 * All custom events and page views bypass trace sampling --
 * they are always collected for exact counts in the Usage Dashboard.
 */

import { getAppInsights } from './sdk.js';

// -- Page/View Tracking --

/**
 * Track a view transition. Maps to pageViews table in Azure Monitor.
 */
export function trackPageView(viewState: string): void {
    const ai = getAppInsights();
    if (ai) {
        ai.trackPageView({ name: viewState });
    }
}

// -- Generic Event/Metric --

/**
 * Track a custom business event. Always collected, never sampled.
 * Use browserEvents helpers below for type-safe common events.
 */
export function trackEvent(name: string, properties?: Record<string, string>): void {
    const ai = getAppInsights();
    if (ai) {
        ai.trackEvent({ name, properties });
    }
}

/**
 * Track a custom metric (e.g., Core Web Vitals).
 */
export function trackMetric(name: string, value: number, properties?: Record<string, string>): void {
    const ai = getAppInsights();
    if (ai) {
        ai.trackMetric({ name, average: value }, properties);
    }
}

// -- Predefined Business Event Helpers --

export const browserEvents = {
    login(method: 'firebase' | 'fallback') {
        trackEvent('auth.login', { method });
    },

    logout() {
        trackEvent('auth.logout');
    },

    onboardingStep(step: number, completed: boolean) {
        trackEvent('onboarding.step', {
            step: String(step),
            completed: String(completed),
        });
    },

    onboardingCompleted() {
        trackEvent('onboarding.completed');
    },

    postCreated(postType: string) {
        trackEvent('post.created', { postType });
    },

    instagramConnected() {
        trackEvent('instagram.connected');
    },

    instagramDisconnected() {
        trackEvent('instagram.disconnected');
    },

    subscriptionStarted(plan: string, cycle: string) {
        trackEvent('subscription.started', { plan, cycle });
    },

    paymentCompleted(type: 'subscription' | 'credit_pack', amount: string) {
        trackEvent('payment.completed', { type, amount });
    },

    networkError(path: string, statusCode: string) {
        trackEvent('network.error', { path, statusCode });
    },

    viewTransition(from: string, to: string) {
        trackEvent('view.transition', { from, to });
    },
};
