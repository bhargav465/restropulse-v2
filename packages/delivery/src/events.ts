/**
 * Applying partner status updates to a shipment, and moving the order along
 * with it (PICKED_UP -> OUT_FOR_DELIVERY, DELIVERED -> COMPLETED).
 *
 * Safe to call with redelivered, late or out-of-order events: an event id
 * already on the shipment is skipped, and a status that isn't a forward move
 * is ignored.
 */

import type { DeliveryStore, Order, Shipment, ShipmentEvent, ShipmentEventEntry, ShipmentPatch } from '@restropulse/shared';
import { canTransitionShipment, orderPathTo, orderStatusForShipment, SHIPMENT_STATUS_LABELS } from '@restropulse/shared';

export interface ApplyResult {
  shipment: Shipment;
  /** Events that changed something. */
  applied: number;
  /** The order after any moves (undefined when it didn't need to move). */
  order?: Order;
}

function plan(shipment: Shipment, events: ShipmentEvent[], source: ShipmentEventEntry['source']) {
  const seen = new Set(shipment.events.map((e) => e.eventId).filter(Boolean));
  let status = shipment.status;
  const patch: ShipmentPatch = {};
  const entries: ShipmentEventEntry[] = [];
  for (const e of events) {
    if (seen.has(e.eventId) || !canTransitionShipment(status, e.status)) continue;
    seen.add(e.eventId);
    status = e.status;
    entries.push({ status: e.status, at: e.at, source, eventId: e.eventId, ...(e.note ? { note: e.note.slice(0, 200) } : {}) });
    if (e.rider) patch.rider = { ...shipment.rider, ...patch.rider, ...e.rider };
    if (e.trackingUrl) patch.trackingUrl = e.trackingUrl;
    if (e.etaMinutes !== undefined) patch.etaMinutes = e.etaMinutes;
  }
  if (entries.length) {
    patch.status = status;
    patch.events = [...shipment.events, ...entries];
    if (status === 'CANCELLED') patch.cancelReason = entries[entries.length - 1].note ?? 'Cancelled by the delivery partner';
  }
  return { patch, applied: entries.length };
}

/** Move the order forward to what the shipment implies, one valid step at a time. */
export async function syncOrderWithShipment(store: DeliveryStore, shipment: Shipment): Promise<Order | undefined> {
  const target = orderStatusForShipment(shipment.status);
  if (!target) return undefined;
  let order = await store.findOrder(shipment.restaurantId, shipment.orderId);
  if (!order) return undefined;
  let moved: Order | undefined;
  for (const step of orderPathTo(order.status, target)) {
    const next = await store.moveOrder(order.restaurantId, order.id, order.status, step, `Rider: ${SHIPMENT_STATUS_LABELS[shipment.status].toLowerCase()}`);
    if (!next) break; // someone moved it meanwhile; the next update will catch up
    order = next;
    moved = next;
  }
  return moved;
}

export async function applyShipmentEvents(
  store: DeliveryStore,
  shipment: Shipment,
  events: ShipmentEvent[],
  source: ShipmentEventEntry['source'] = 'provider',
): Promise<ApplyResult> {
  let current = shipment;
  for (let tries = 0; tries < 3; tries += 1) {
    const { patch, applied } = plan(current, events, source);
    if (!applied) return { shipment: current, applied: 0 };
    const saved = await store.updateShipment(current.id, current.status, patch);
    if (saved) {
      const order = await syncOrderWithShipment(store, saved);
      return { shipment: saved, applied, ...(order ? { order } : {}) };
    }
    const fresh = await store.findShipmentByProviderId(current.provider, current.providerShipmentId);
    if (!fresh) break;
    current = fresh;
  }
  return { shipment: current, applied: 0 };
}
