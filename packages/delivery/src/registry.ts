/** Which providers this server can use, built once from the environment. */

import type { DeliveryProviderId, DeliveryProviderInfo } from '@restropulse/shared';
import type { DeliveryProvider } from './provider.js';
import { createMockProvider } from './mock.js';
import { createSelfProvider } from './self.js';

export interface DeliveryRegistry {
  get(id: DeliveryProviderId): DeliveryProvider | undefined;
  has(id: DeliveryProviderId): boolean;
  list(): DeliveryProviderInfo[];
}

export function createDeliveryRegistry(providers: DeliveryProvider[]): DeliveryRegistry {
  const byId = new Map<DeliveryProviderId, DeliveryProvider>();
  for (const p of providers) byId.set(p.id, p);
  return {
    get: (id) => byId.get(id),
    has: (id) => byId.has(id),
    list: () => [...byId.values()].map((p) => p.info),
  };
}

/**
 * `self` always; `mock` only when DELIVERY_MOCK_ENABLED=true (staging, demos).
 * Real partners are added here once their accounts exist.
 */
export function buildDeliveryRegistry(env: Record<string, string | undefined> = process.env): DeliveryRegistry {
  const providers: DeliveryProvider[] = [createSelfProvider()];
  if (env.DELIVERY_MOCK_ENABLED === 'true') {
    const minuteMs = Number(env.DELIVERY_MOCK_MINUTE_MS);
    providers.push(createMockProvider({
      ...(env.MOCK_DELIVERY_WEBHOOK_SECRET ? { webhookSecret: env.MOCK_DELIVERY_WEBHOOK_SECRET } : {}),
      ...(Number.isFinite(minuteMs) && minuteMs > 0 ? { minuteMs } : {}),
    }));
  }
  return createDeliveryRegistry(providers);
}
