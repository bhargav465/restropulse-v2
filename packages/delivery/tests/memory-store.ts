import type {
  DeliveryJob,
  DeliveryJobInsert,
  DeliveryStore,
  Order,
  OrderStatus,
  Restaurant,
  Shipment,
  ShipmentInsert,
  ShipmentStatus,
} from '@restropulse/shared';
import { isTerminalShipment } from '@restropulse/shared';

export function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    restaurantId: 'r1',
    orderNumber: 'RP-ABC234',
    trackingToken: 't',
    orderType: 'delivery',
    items: [],
    totals: { subtotal: 400, discount: 0, deliveryFee: 30, deliveryDiscount: 0, tax: 20, total: 450 },
    status: 'READY',
    statusHistory: [],
    paymentMethod: 'cash',
    customerName: 'Asha',
    customerPhone: '+919800000000',
    address: { line1: '12 MG Road', city: 'Bengaluru', pincode: '560001' },
    createdAt: '2026-11-24T10:00:00.000Z',
    updatedAt: '2026-11-24T10:00:00.000Z',
    ...over,
  };
}

export function makeRestaurant(over: Partial<Restaurant> = {}): Restaurant {
  return { id: 'r1', name: '[SAMPLE] Spice Route', deliverySettings: { dispatchEnabled: true, providers: ['mock', 'self'] }, ...over } as Restaurant;
}

export class MemoryStore implements DeliveryStore {
  jobs: Array<DeliveryJob & { openKey?: string }> = [];
  orders = new Map<string, Order>();
  restaurants = new Map<string, Restaurant>();
  shipments: Shipment[] = [];
  /** Make the next N updateShipment calls lose the race. */
  updateConflicts = 0;
  moveConflicts = 0;
  private seq = 0;

  constructor(order?: Order, restaurant?: Restaurant) {
    if (order) this.orders.set(order.id, order);
    if (restaurant) this.restaurants.set(restaurant.id, restaurant);
  }

  async enqueueJob(input: DeliveryJobInsert) {
    if (input.dedupeKey && this.jobs.some((j) => j.openKey === input.dedupeKey)) return null;
    const now = new Date();
    const job = {
      id: `j${++this.seq}`, type: input.type, restaurantId: input.restaurantId, orderId: input.orderId,
      ...(input.reason ? { reason: input.reason } : {}),
      status: 'pending' as const, attempts: 0, nextRunAt: input.runAt ?? new Date(0), createdAt: now, updatedAt: now,
      ...(input.dedupeKey ? { openKey: input.dedupeKey } : {}),
    };
    this.jobs.push(job);
    return job;
  }
  async claimDueJob(now: Date) {
    const job = this.jobs.find((j) => j.status === 'pending' && new Date(j.nextRunAt) <= now);
    if (!job) return null;
    job.status = 'running';
    return { ...job };
  }
  async completeJob(id: string) {
    const j = this.jobs.find((x) => x.id === id)!;
    j.status = 'done';
    delete j.openKey;
  }
  async retryJob(id: string, nextRunAt: Date, error: string) {
    const j = this.jobs.find((x) => x.id === id)!;
    Object.assign(j, { status: 'pending', attempts: j.attempts + 1, nextRunAt, lastError: error });
  }
  async failJob(id: string, error: string) {
    const j = this.jobs.find((x) => x.id === id)!;
    Object.assign(j, { status: 'failed', attempts: j.attempts + 1, lastError: error });
    delete j.openKey;
  }
  async findRestaurant(id: string) {
    return this.restaurants.get(id) ?? null;
  }
  async findOrder(_rid: string, id: string) {
    return this.orders.get(id) ?? null;
  }
  async moveOrder(_rid: string, id: string, from: OrderStatus, to: OrderStatus, note: string) {
    const o = this.orders.get(id);
    if (!o || o.status !== from) return null;
    if (this.moveConflicts > 0) {
      this.moveConflicts -= 1;
      return null;
    }
    const next = { ...o, status: to, statusHistory: [...o.statusHistory, { status: to, at: new Date().toISOString(), by: 'system' as const, note }] };
    this.orders.set(id, next);
    return next;
  }
  async insertShipment(s: ShipmentInsert) {
    const now = new Date().toISOString();
    const shipment = { ...s, id: `s${++this.seq}`, createdAt: now, updatedAt: now };
    this.shipments.push(shipment);
    return { ...shipment };
  }
  async findShipmentForOrder(_rid: string, orderId: string) {
    const list = this.shipments.filter((s) => s.orderId === orderId);
    return list.length ? { ...list[list.length - 1] } : null;
  }
  async findShipmentByProviderId(provider: string, id: string) {
    const s = this.shipments.find((x) => x.provider === provider && x.providerShipmentId === id);
    return s ? { ...s } : null;
  }
  async updateShipment(id: string, expected: ShipmentStatus, patch: Partial<Shipment>) {
    const s = this.shipments.find((x) => x.id === id);
    if (!s || s.status !== expected) return null;
    if (this.updateConflicts > 0) {
      this.updateConflicts -= 1;
      return null;
    }
    Object.assign(s, patch, { updatedAt: new Date().toISOString() });
    return { ...s };
  }
  async findLiveShipments(providers: string[], limit: number) {
    return this.shipments.filter((s) => providers.includes(s.provider) && !isTerminalShipment(s.status)).slice(0, limit).map((s) => ({ ...s }));
  }
}
