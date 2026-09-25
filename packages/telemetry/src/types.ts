/**
 * Telemetry configuration types shared across server and browser.
 */

export interface TelemetryConfig {
    serviceName: string;
    serviceVersion?: string;
    environment: string;
    logLevel: LogLevel;
    connectionString?: string;
    samplingRatio: number;
}

export interface BrowserTelemetryConfig {
    connectionString: string;
    apiBaseUrl: string;
    samplingPercentage: number;
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

/**
 * Predefined business event names.
 * Using constants prevents typos in event tracking calls.
 */
export const EventNames = {
    // Auth
    AUTH_LOGIN: 'auth.login',
    AUTH_LOGOUT: 'auth.logout',

    // Onboarding
    ONBOARDING_STEP: 'onboarding.step',
    ONBOARDING_COMPLETED: 'onboarding.completed',

    // Posts
    POST_CREATED: 'post.created',
    POST_PUBLISHED: 'post.published',
    POST_PUBLISH_FAILED: 'post.publish_failed',

    // Content
    CONTENT_GENERATED: 'content.generated',
    CONTENT_GENERATION_FAILED: 'content.generation_failed',

    // Strategy
    STRATEGY_CREATED: 'strategy.created',
    STRATEGY_CYCLE_APPROVED: 'strategy.cycle_approved',

    // Instagram
    INSTAGRAM_CONNECTED: 'instagram.connected',
    INSTAGRAM_DISCONNECTED: 'instagram.disconnected',

    // Token
    TOKEN_REFRESHED: 'token.refreshed',
    TOKEN_REFRESH_FAILED: 'token.refresh_failed',

    // Subscriptions & Payments
    SUBSCRIPTION_STARTED: 'subscription.started',
    SUBSCRIPTION_ACTIVATED: 'subscription.activated',
    SUBSCRIPTION_CANCELLED: 'subscription.cancelled',
    PAYMENT_COMPLETED: 'payment.completed',
    CREDIT_PURCHASED: 'credit.purchased',
    COUPON_REDEEMED: 'coupon.redeemed',

    // Webhooks
    WEBHOOK_RECEIVED: 'webhook.received',

    // AI (future)
    AI_REQUEST_COMPLETED: 'ai.request.completed',
    AI_REQUEST_FAILED: 'ai.request.failed',

    // Network (browser)
    NETWORK_ERROR: 'network.error',
} as const;

export type EventName = (typeof EventNames)[keyof typeof EventNames];
