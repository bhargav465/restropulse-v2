/**
 * current-affairs-refresh processor.
 *
 * Wraps runCurrentAffairsRefresh in the IProcessor shape so worker.ts can
 * register it via the standard processors loop. Default schedule is 06:00 IST
 * (configured via CRON_CURRENT_AFFAIRS_REFRESH env var on the worker).
 */

import type { IProcessor } from '../types.js';
import {
  type ICurrentAffairsProvider,
  runCurrentAffairsRefresh,
} from '../../content-generator/backends/ai/current-affairs/index.js';

export function createCurrentAffairsRefreshProcessor(
  cron: string,
  provider: ICurrentAffairsProvider,
): IProcessor {
  return {
    name: 'current-affairs-refresh',
    cron,
    run: () => runCurrentAffairsRefresh(provider),
  };
}
