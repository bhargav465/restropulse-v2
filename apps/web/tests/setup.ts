import '@testing-library/jest-dom';
import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Mock browser telemetry
vi.mock('@restropulse/telemetry/browser', () => ({
    initBrowserTelemetry: vi.fn(),
    getAppInsights: vi.fn().mockReturnValue(null),
    reportError: vi.fn(),
    trackPageView: vi.fn(),
    trackEvent: vi.fn(),
    trackMetric: vi.fn(),
    browserEvents: {
        login: vi.fn(),
        logout: vi.fn(),
        onboardingStep: vi.fn(),
        onboardingCompleted: vi.fn(),
        postCreated: vi.fn(),
        instagramConnected: vi.fn(),
        instagramDisconnected: vi.fn(),
        subscriptionStarted: vi.fn(),
        paymentCompleted: vi.fn(),
        networkError: vi.fn(),
        viewTransition: vi.fn(),
    },
}));

// Cleanup after each test
afterEach(() => {
    cleanup();
});

// Mock localStorage
const localStorageMock = {
    getItem: vi.fn(),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
};
global.localStorage = localStorageMock as any;

// Mock window.matchMedia
Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation(query => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })),
});

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
    constructor() { }
    disconnect() { }
    observe() { }
    takeRecords() {
        return [];
    }
    unobserve() { }
} as any;

vi.mock('@vis.gl/react-google-maps', () => ({ APIProvider: ({children}: {children: any}) => children, Map: ({children}: {children: any}) => children, AdvancedMarker: () => null, useMap: () => null, useMapsLibrary: () => null }));

