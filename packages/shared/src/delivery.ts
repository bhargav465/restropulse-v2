// -------------------------------------------------------
// @restropulse/shared - delivery and rider dispatch (Phase 2, M4)
//
// Canonical shipment model every delivery provider maps onto, the shipment
// status machine, how a shipment moves the order, per-restaurant dispatch
// settings, and the store contract the dispatcher runs against. Provider
// adapters live in @restropulse/delivery; Mongo lives in @restropulse/db.
// -------------------------------------------------------

import type { Order, OrderAddress, OrderStatus } from './orders.js';
import type { Restaurant } from './index.js';

// ----- Providers -----

/** Every provider the interface allows. Only `mock` and `self` have adapters today. */
export type DeliveryProviderId = 'mock' | 'self' | 'middleware' | 'shadowfax' | 'rapido';
export const DELIVERY_PROVIDER_IDS: readonly DeliveryProviderId[] = ['mock', 'self', 'middleware', 'shadowfax', 'rapido'];

export function isDeliveryProviderId(value: unknown): value is DeliveryProviderId {
  return typeof value === 'string' && (DELIVERY_PROVIDER_IDS as readonly string[]).includes(value);
}

/** What the dashboard lists for a provider that is available on this server. */
export interface DeliveryProviderInfo {
  id: DeliveryProviderId;
  label: string;
  /** `own` = the restaurant's own riders, `partner` = a delivery company. */
  kind: 'own' | 'partner';
  /** True when the provider pushes status updates (webhooks) rather than being polled. */
  webhooks: boolean;
}

// ----- Shipment status machine -----

export type ShipmentStatus =
  | 'QUOTED'
  | 'BOOKED'
  | 'RIDER_ASSIGNED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'FAILED';

/** Forward order of the happy path (used to ignore late, out-of-order events). */
export const SHIPMENT_FLOW: readonly ShipmentStatus[] = ['QUOTED', 'BOOKED', 'RIDER_ASSIGNED', 'PICKED_UP', 'IN_TRANSIT', 'DELIVERED'];
export const TERMINAL_SHIPMENT_STATUSES: readonly ShipmentStatus[] = ['DELIVERED', 'CANCELLED', 'FAILED'];
export const SHIPMENT_STATUSES: readonly ShipmentStatus[] = [...SHIPMENT_FLOW, 'CANCELLED', 'FAILED'];

export function isShipmentStatus(value: unknown): value is ShipmentStatus {
  return typeof value === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(value);
}

export function isTerminalShipment(status: ShipmentStatus): boolean {
  return TERMINAL_SHIPMENT_STATUSES.includes(status);
}

/**
 * Providers skip steps (a rider can be assigned and picked up in one webhook),
 * so any forward move along the flow is allowed. CANCELLED is allowed until
 * pickup; FAILED (including return-to-origin) at any live point.
 */
export function canTransitionShipment(from: ShipmentStatus, to: ShipmentStatus): boolean {
  if (from === to || isTerminalShipment(from)) return false;
  if (to === 'FAILED') return true;
  if (to === 'CANCELLED') return SHIPMENT_FLOW.indexOf(from) < SHIPMENT_FLOW.indexOf('PICKED_UP');
  return SHIPMENT_FLOW.indexOf(to) > SHIPMENT_FLOW.indexOf(from);
}

/** The order status a shipment status implies, if any. */
export function orderStatusForShipment(status: ShipmentStatus): OrderStatus | undefined {
  if (status === 'PICKED_UP' || status === 'IN_TRANSIT') return 'OUT_FOR_DELIVERY';
  if (status === 'DELIVERED') return 'COMPLETED';
  return undefined;
}

/**
 * The single-step order moves needed to reach `target` from `current`, for a
 * delivery order. Empty when the order is already there, past it, or closed.
 * (A rider can collect food the kitchen hasn't marked READY yet.)
 */
export function orderPathTo(current: OrderStatus, target: OrderStatus): OrderStatus[] {
  const flow: OrderStatus[] = ['RECEIVED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED'];
  const from = flow.indexOf(current);
  const to = flow.indexOf(target);
  if (from < 0 || to < 0 || to <= from) return [];
  return flow.slice(from + 1, to + 1);
}

export const SHIPMENT_STATUS_LABELS: Record<ShipmentStatus, string> = {
  QUOTED: 'Finding a rider',
  BOOKED: 'Rider requested',
  RIDER_ASSIGNED: 'Rider assigned',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'On the way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Rider cancelled',
  FAILED: 'Delivery failed',
};

// ----- Quotes and shipments -----

export interface DeliveryParty {
  name: string;
  phone?: string;
  address?: OrderAddress;
}

export interface QuoteRequest {
  restaurantId: string;
  orderId: string;
  orderNumber: string;
  pickup: DeliveryParty;
  drop: DeliveryParty & { address: OrderAddress };
  /** Order total in rupees (some partners need it for cash collection or insurance). */
  orderValue: number;
  /** True when the rider must collect cash from the customer. */
  collectCash: boolean;
}

export interface DeliveryQuote {
  provider: DeliveryProviderId;
  serviceable: boolean;
  /** What the partner charges the restaurant, in rupees. */
  fee: number;
  /** Minutes until delivery, when the partner says. */
  etaMinutes?: number;
  /** The partner's quote reference, passed back when booking. */
  quoteRef?: string;
  /** Why it isn't serviceable. */
  reason?: string;
}

export interface ShipmentRider {
  name?: string;
  phone?: string;
}

/** One status update from a provider, mapped to the canonical model. */
export interface ShipmentEvent {
  /** The provider's id for this update; redeliveries are ignored by it. */
  eventId: string;
  providerShipmentId: string;
  status: ShipmentStatus;
  at: string;
  rider?: ShipmentRider;
  trackingUrl?: string;
  etaMinutes?: number;
  note?: string;
}

export interface ShipmentEventEntry {
  status: ShipmentStatus;
  at: string;
  source: 'dispatcher' | 'provider' | 'restaurant';
  eventId?: string;
  note?: string;
}

/** What `createShipment` returns. */
export interface BookedShipment {
  providerShipmentId: string;
  status: ShipmentStatus;
  /** The company actually delivering, e.g. Rapido via a middleware. */
  carrier?: string;
  fee?: number;
  etaMinutes?: number;
  trackingUrl?: string;
  rider?: ShipmentRider;
}

export interface Shipment {
  id: string;
  restaurantId: string;
  orderId: string;
  provider: DeliveryProviderId;
  providerShipmentId: string;
  carrier?: string;
  status: ShipmentStatus;
  fee?: number;
  etaMinutes?: number;
  trackingUrl?: string;
  rider?: ShipmentRider;
  events: ShipmentEventEntry[];
  cancelReason?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

/** What the customer's tracking page may see. */
export interface PublicShipment {
  status: ShipmentStatus;
  label: string;
  carrier?: string;
  riderName?: string;
  etaMinutes?: number;
  trackingUrl?: string;
}

export function toPublicShipment(s: Pick<Shipment, 'status' | 'carrier' | 'rider' | 'etaMinutes' | 'trackingUrl'>): PublicShipment {
  return {
    status: s.status,
    label: SHIPMENT_STATUS_LABELS[s.status],
    ...(s.carrier ? { carrier: s.carrier } : {}),
    ...(s.rider?.name ? { riderName: s.rider.name } : {}),
    ...(s.etaMinutes !== undefined ? { etaMinutes: s.etaMinutes } : {}),
    ...(s.trackingUrl && /^https:\/\//i.test(s.trackingUrl) ? { trackingUrl: s.trackingUrl } : {}),
  };
}

// ----- Dispatch settings -----

export type DeliveryStrategy = 'preferred' | 'cheapest' | 'fastest';
export const DELIVERY_STRATEGIES: readonly DeliveryStrategy[] = ['preferred', 'cheapest', 'fastest'];

export interface RestaurantDeliverySettings {
  /** Book a rider automatically for delivery orders. */
  dispatchEnabled: boolean;
  /** When to book: READY by default; PREPARING gives the rider a head start. */
  dispatchAt: 'READY' | 'PREPARING';
  /** How to pick among the providers that can deliver. `preferred` = list order. */
  strategy: DeliveryStrategy;
  /** Providers to try, most preferred first. `self` is always the last resort. */
  providers: DeliveryProviderId[];
}

export const DEFAULT_DELIVERY_SETTINGS: RestaurantDeliverySettings = {
  dispatchEnabled: false,
  dispatchAt: 'READY',
  strategy: 'preferred',
  providers: ['self'],
};

export function resolveDeliverySettings(stored?: Partial<RestaurantDeliverySettings> | null): RestaurantDeliverySettings {
  const s = stored ?? {};
  const providers = Array.isArray(s.providers)
    ? s.providers.filter((p, i, all) => isDeliveryProviderId(p) && all.indexOf(p) === i)
    : [];
  return {
    dispatchEnabled: s.dispatchEnabled === true,
    dispatchAt: s.dispatchAt === 'PREPARING' ? 'PREPARING' : 'READY',
    strategy: DELIVERY_STRATEGIES.includes(s.strategy as DeliveryStrategy) ? (s.strategy as DeliveryStrategy) : 'preferred',
    providers: providers.length ? providers : [...DEFAULT_DELIVERY_SETTINGS.providers],
  };
}

// ----- Outbox jobs and the dispatcher's store -----

export type DeliveryJobType = 'dispatch' | 'cancel';
export type DeliveryJobStatus = 'pending' | 'running' | 'done' | 'failed';

export interface DeliveryJob {
  id: string;
  type: DeliveryJobType;
  restaurantId: string;
  orderId: string;
  /** For `cancel`: the reason passed to the provider. */
  reason?: string;
  status: DeliveryJobStatus;
  attempts: number;
  nextRunAt: string | Date;
  lastError?: string;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface DeliveryJobInsert {
  type: DeliveryJobType;
  restaurantId: string;
  orderId: string;
  reason?: string;
  /** Jobs with the same key collapse into one while it is still open. */
  dedupeKey?: string;
  runAt?: Date;
}

export type ShipmentInsert = Omit<Shipment, 'id' | 'createdAt' | 'updatedAt'>;

export interface ShipmentPatch {
  status?: ShipmentStatus;
  carrier?: string;
  fee?: number;
  etaMinutes?: number;
  trackingUrl?: string;
  rider?: ShipmentRider;
  cancelReason?: string;
  events?: ShipmentEventEntry[];
}

/**
 * Persistence the dispatcher needs. @restropulse/db implements it on MongoDB;
 * tests use an in-memory version.
 */
export interface DeliveryStore {
  enqueueJob(job: DeliveryJobInsert): Promise<DeliveryJob | null>;
  /** Take the next due job (or one whose worker died) and mark it running. */
  claimDueJob(now: Date, leaseMs: number): Promise<DeliveryJob | null>;
  completeJob(id: string): Promise<void>;
  retryJob(id: string, nextRunAt: Date, error: string): Promise<void>;
  failJob(id: string, error: string): Promise<void>;

  findRestaurant(restaurantId: string): Promise<Restaurant | null>;
  findOrder(restaurantId: string, orderId: string): Promise<Order | null>;
  /** Single-step order move, only if the order is still at `from`. */
  moveOrder(restaurantId: string, orderId: string, from: OrderStatus, to: OrderStatus, note: string): Promise<Order | null>;

  insertShipment(shipment: ShipmentInsert): Promise<Shipment>;
  /** The newest shipment for an order. */
  findShipmentForOrder(restaurantId: string, orderId: string): Promise<Shipment | null>;
  findShipmentByProviderId(provider: DeliveryProviderId, providerShipmentId: string): Promise<Shipment | null>;
  /** Write the patch only if the shipment is still at `expected`; null when it moved meanwhile. */
  updateShipment(id: string, expected: ShipmentStatus, patch: ShipmentPatch): Promise<Shipment | null>;
  /** Live shipments of the given providers, oldest update first (for polling). */
  findLiveShipments(providers: DeliveryProviderId[], limit: number): Promise<Shipment[]>;
}
