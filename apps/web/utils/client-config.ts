import type { ClientConfig } from '@restropulse/shared';

let config: ClientConfig | null = null;

function buildFallbackConfig(): ClientConfig {
    return {
        apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
        appUrl: import.meta.env.VITE_APP_URL || 'http://localhost:3000',
        googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '',
        razorpayKeyId: import.meta.env.VITE_RAZORPAY_KEY_ID || '',
        appInsightsConnectionString: import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING || '',
        telemetrySampleRate: Number(import.meta.env.VITE_TELEMETRY_SAMPLE_RATE) || 100,
        firebase: {
            apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'your-api-key',
            authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'your-project.firebaseapp.com',
            projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'your-project-id',
            storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'your-project.appspot.com',
            messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '123456789',
            appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:123456789:web:abc123',
        },
    };
}

/**
 * Resolve runtime client configuration.
 *
 * Fetches the same-origin `/config.json` sidecar (written by the deploy
 * pipeline from Key Vault at build/deploy time, so the web bundle never
 * embeds secrets). If the fetch fails for any reason (local dev where the
 * file does not exist, network error, malformed JSON), falls back to
 * `import.meta.env.VITE_*` values. Never throws.
 */
export async function initClientConfig(): Promise<void> {
    try {
        const response = await fetch('/config.json');
        if (!response.ok) {
            config = buildFallbackConfig();
            return;
        }
        config = (await response.json()) as ClientConfig;
    } catch {
        config = buildFallbackConfig();
    }
}

export function getClientConfig(): ClientConfig {
    if (!config) {
        throw new Error('getClientConfig() called before initClientConfig() resolved');
    }
    return config;
}
