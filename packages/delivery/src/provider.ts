/**
 * The one interface every rider partner sits behind (ADR: docs/LAUNCH_ARCHITECTURE B4).
 *
 * The dispatcher only talks to this; adding Rapido, Shadowfax or a delivery
 * middleware later is a new adapter, not a change to orders.
 */

import type {
  BookedShipment,
  DeliveryProviderId,
  DeliveryProviderInfo,
  DeliveryQuote,
  QuoteRequest,
  ShipmentEvent,
} from '@restropulse/shared';

export interface WebhookRequest {
  /** Lower-cased header names. */
  headers: Record<string, string | undefined>;
  /** The exact bytes received (signatures are over these). */
  rawBody: Buffer;
}

export interface DeliveryProvider {
  readonly id: DeliveryProviderId;
  readonly info: DeliveryProviderInfo;
  /** Price, ETA and whether the partner can take this drop. */
  quote(req: QuoteRequest): Promise<DeliveryQuote>;
  /** Book a rider using a quote from `quote`. */
  createShipment(req: QuoteRequest, quote: DeliveryQuote): Promise<BookedShipment>;
  cancelShipment(providerShipmentId: string, reason: string): Promise<void>;
  /** Latest status, for partners we poll. Null when the partner has nothing new. */
  track(providerShipmentId: string): Promise<ShipmentEvent | null>;
  /** True when the webhook really came from this partner. */
  verifyWebhook(req: WebhookRequest): boolean;
  /** Map a verified webhook body to canonical events. Unknown statuses are dropped. */
  parseWebhook(rawBody: Buffer): ShipmentEvent[];
}

/** A provider call failed. `retryable` = try again later (timeouts, 5xx). */
export class DeliveryProviderError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable = true) {
    super(message);
    this.name = 'DeliveryProviderError';
    this.retryable = retryable;
  }
}
