/**
 * runCurrentAffairsRefresh -- single entry point for the daily refresh cron.
 *
 * Delegates to provider.refresh() (decorator chain handles the rest -- V1
 * refresh feeds V2 refresh, etc.). Logs + reraises so tracedCronJob records
 * the failure on the OTel span.
 */

import { createLogger } from '@restropulse/telemetry/server';
import type { ICurrentAffairsProvider } from './types.js';

const log = createLogger('current-affairs-refresh');

export async function runCurrentAffairsRefresh(provider: ICurrentAffairsProvider): Promise<void> {
  log.info({ provider: provider.name }, 'Current-affairs refresh starting');
  const start = Date.now();
  try {
    await provider.refresh();
    log.info({ provider: provider.name, durationMs: Date.now() - start }, 'Current-affairs refresh completed');
  } catch (err) {
    log.error({ err, provider: provider.name }, 'Current-affairs refresh failed');
    throw err;
  }
}
