import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initBrowserTelemetry } from '@restropulse/telemetry/browser';
import { initClientConfig, getClientConfig } from './utils/client-config';
import { initFirebase } from './firebase';

async function boot(): Promise<void> {
    try {
        await initClientConfig();
        const cfg = getClientConfig();
        initFirebase(cfg);
        initBrowserTelemetry({
            connectionString: cfg.appInsightsConnectionString,
            apiBaseUrl: cfg.apiUrl,
            samplingPercentage: cfg.telemetrySampleRate,
        });
    } catch (err) {
        // initClientConfig() never throws (it falls back to import.meta.env
        // internally), so this only fires on an unexpected error in
        // initFirebase/initBrowserTelemetry. Log and continue so the screen
        // never stays blank.
        console.error('Client boot initialization failed:', err);
    }

    const rootElement = document.getElementById('root');
    if (!rootElement) {
        throw new Error("Could not find root element to mount to");
    }

    const root = ReactDOM.createRoot(rootElement);
    root.render(
        <React.StrictMode>
            <App />
        </React.StrictMode>
    );
}

void boot();
