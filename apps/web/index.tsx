import './index.css';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initBrowserTelemetry } from '@restropulse/telemetry/browser';

initBrowserTelemetry({
    connectionString: import.meta.env.VITE_APPINSIGHTS_CONNECTION_STRING || '',
    apiBaseUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001/api',
    samplingPercentage: Number(import.meta.env.VITE_TELEMETRY_SAMPLE_RATE) || 100,
});

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
