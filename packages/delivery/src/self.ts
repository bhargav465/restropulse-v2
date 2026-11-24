/**
 * `self`: the restaurant's own riders. Booking always succeeds and nothing is
 * sent anywhere; the restaurant moves the shipment from the order screen.
 * It is also where every order lands when no partner can take it.
 */

import type { DeliveryProviderInfo } from '@restropulse/shared';
import type { DeliveryProvider } from './provider.js';

export const SELF_PROVIDER_INFO: DeliveryProviderInfo = { id: 'self', label: 'Your own riders', kind: 'own', webhooks: false };

export function createSelfProvider(now: () => Date = () => new Date()): DeliveryProvider {
  return {
    id: 'self',
    info: SELF_PROVIDER_INFO,
    async quote() {
      return { provider: 'self', serviceable: true, fee: 0 };
    },
    async createShipment(req) {
      return {
        providerShipmentId: `self_${req.orderId}_${now().getTime().toString(36)}`,
        status: 'BOOKED',
        carrier: 'Own rider',
      };
    },
    async cancelShipment() {
      /* nothing to tell anyone */
    },
    async track() {
      return null;
    },
    verifyWebhook() {
      return false;
    },
    parseWebhook() {
      return [];
    },
  };
}
