import { createApiClient } from './api-client.js';
import { createSitesApp } from './app.js';
import { loadConfig } from './config.js';

const config = loadConfig();
const api = createApiClient({ apiUrl: config.apiUrl, ttlMs: config.cacheTtlMs });
createSitesApp(config, api).listen(config.port, () => {
    console.log(`[sites] listening on :${config.port} (api ${config.apiUrl}, base ${config.baseUrl})`);
});
