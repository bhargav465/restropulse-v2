/**
 * Azure Monitor OpenTelemetry distro initialization for Node.js services.
 *
 * Must be called BEFORE any other application imports to ensure
 * auto-instrumentation patches (Express, MongoDB, HTTP) are applied
 * before the target modules are loaded.
 *
 * Auto-instruments:
 *   - Express HTTP requests (spans -> requests table)
 *   - MongoDB driver v6 queries (spans -> dependencies table)
 *   - Outbound HTTP/HTTPS via axios (spans -> dependencies table)
 */

import { useAzureMonitor, shutdownAzureMonitor } from '@azure/monitor-opentelemetry';
import { resourceFromAttributes } from '@opentelemetry/resources';
import type { TelemetryConfig } from '../types.js';

let initialized = false;

export function initServerTelemetry(config: TelemetryConfig): void {
    if (initialized) return;

    if (!config.connectionString) {
        // No Azure connection string -- telemetry export disabled.
        // pino still logs to stdout. OTel auto-instrumentation is skipped.
        return;
    }

    useAzureMonitor({
        azureMonitorExporterOptions: {
            connectionString: config.connectionString,
        },
        samplingRatio: config.samplingRatio,
        instrumentationOptions: {
            http: { enabled: true },
            azureSdk: { enabled: false },
            mongoDb: { enabled: true },
        },
        resource: resourceFromAttributes({
            'service.name': `restropulse-${config.serviceName}`,
            'service.version': config.serviceVersion || '1.0.0',
            'deployment.environment.name': config.environment,
        }),
    });

    initialized = true;
}

export async function shutdownServerTelemetry(): Promise<void> {
    if (!initialized) return;
    await shutdownAzureMonitor();
    initialized = false;
}
