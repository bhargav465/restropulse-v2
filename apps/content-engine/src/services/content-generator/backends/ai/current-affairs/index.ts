/**
 * Barrel for the current-affairs subsystem + buildCurrentAffairsProvider factory.
 *
 * Decorator chain logic:
 *   - V1 only:  CalendarOnlyProvider
 *   - V1 + V2:  SonarAugmentedProvider over CalendarOnlyProvider
 *   - V2 only:  SonarAugmentedProvider over NoopCurrentAffairsProvider
 *   - Both off: NoopCurrentAffairsProvider
 */

export type {
  ICurrentAffairsProvider,
  FetchHintsParams,
  CurrentAffairsOperation,
} from './types.js';

export { NoopCurrentAffairsProvider } from './providers/noop-provider.js';
export { CalendarOnlyProvider } from './providers/calendar-only-provider.js';
export { SonarAugmentedProvider } from './providers/sonar-augmented-provider.js';

export type { ICurrentAffairsCache, CacheEntry } from './cache/types.js';
export { MongoCurrentAffairsCache } from './cache/mongo-cache.js';

export { GoogleCalendarClient } from './clients/google-calendar-client.js';
export type { GoogleCalendarClientOptions, CalendarHoliday } from './clients/google-calendar-client.js';

export { SonarClient } from './clients/sonar-client.js';
export type { SonarClientOptions, SonarResponse, SonarUsage } from './clients/sonar-client.js';

export { runCurrentAffairsRefresh } from './refresh-job.js';

import type { ICurrentAffairsProvider } from './types.js';
import type { ICurrentAffairsCache } from './cache/types.js';
import type { GoogleCalendarClient } from './clients/google-calendar-client.js';
import type { SonarClient } from './clients/sonar-client.js';
import type { IDomainSpecialization } from '../specialization/types.js';
import { NoopCurrentAffairsProvider } from './providers/noop-provider.js';
import { CalendarOnlyProvider } from './providers/calendar-only-provider.js';
import { SonarAugmentedProvider } from './providers/sonar-augmented-provider.js';

export interface CurrentAffairsFlags {
  v1Enabled: boolean;
  v2Enabled: boolean;
}

export interface CurrentAffairsDeps {
  cache: ICurrentAffairsCache;
  calendarClient: Pick<GoogleCalendarClient, 'listHolidays'>;
  sonarClient: Pick<SonarClient, 'query'>;
  specialization: IDomainSpecialization;
}

export function buildCurrentAffairsProvider(
  flags: CurrentAffairsFlags,
  deps: CurrentAffairsDeps,
): ICurrentAffairsProvider {
  const upstream: ICurrentAffairsProvider = flags.v1Enabled
    ? new CalendarOnlyProvider({ cache: deps.cache, client: deps.calendarClient })
    : new NoopCurrentAffairsProvider();

  if (flags.v2Enabled) {
    return new SonarAugmentedProvider(upstream, {
      cache: deps.cache,
      client: deps.sonarClient,
      specialization: deps.specialization,
    });
  }

  return upstream;
}
