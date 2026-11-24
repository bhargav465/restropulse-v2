/** The delivery partners this API can use (built once from the environment). */

import { buildDeliveryRegistry, type DeliveryRegistry } from '@restropulse/delivery';

let registry: DeliveryRegistry | null = null;

export function getDeliveryRegistry(): DeliveryRegistry {
    if (!registry) registry = buildDeliveryRegistry(process.env);
    return registry;
}

/** Test seam. Pass null to rebuild from the environment. */
export function _setDeliveryRegistry(r: DeliveryRegistry | null): void {
    registry = r;
}
