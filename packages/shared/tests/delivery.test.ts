import { describe, expect, it } from 'vitest';
import {
  canTransitionShipment,
  isDeliveryProviderId,
  isShipmentStatus,
  isTerminalShipment,
  orderPathTo,
  orderStatusForShipment,
  resolveDeliverySettings,
  toPublicShipment,
  DEFAULT_DELIVERY_SETTINGS,
} from '../src/delivery';

describe('shipment status machine', () => {
  it('moves forward and may skip steps', () => {
    expect(canTransitionShipment('BOOKED', 'RIDER_ASSIGNED')).toBe(true);
    expect(canTransitionShipment('BOOKED', 'PICKED_UP')).toBe(true);
    expect(canTransitionShipment('QUOTED', 'DELIVERED')).toBe(true);
  });

  it('never moves backwards, sideways or out of a terminal state', () => {
    expect(canTransitionShipment('PICKED_UP', 'RIDER_ASSIGNED')).toBe(false);
    expect(canTransitionShipment('BOOKED', 'BOOKED')).toBe(false);
    expect(canTransitionShipment('DELIVERED', 'FAILED')).toBe(false);
    expect(canTransitionShipment('CANCELLED', 'BOOKED')).toBe(false);
  });

  it('cancels only before pickup and fails at any live point', () => {
    expect(canTransitionShipment('RIDER_ASSIGNED', 'CANCELLED')).toBe(true);
    expect(canTransitionShipment('PICKED_UP', 'CANCELLED')).toBe(false);
    expect(canTransitionShipment('IN_TRANSIT', 'FAILED')).toBe(true);
  });

  it('knows terminal states and valid values', () => {
    expect(isTerminalShipment('DELIVERED')).toBe(true);
    expect(isTerminalShipment('IN_TRANSIT')).toBe(false);
    expect(isShipmentStatus('PICKED_UP')).toBe(true);
    expect(isShipmentStatus('LOST')).toBe(false);
    expect(isDeliveryProviderId('mock')).toBe(true);
    expect(isDeliveryProviderId('zomato')).toBe(false);
  });
});

describe('shipment to order status', () => {
  it('maps pickup and transit to out for delivery, delivered to completed', () => {
    expect(orderStatusForShipment('PICKED_UP')).toBe('OUT_FOR_DELIVERY');
    expect(orderStatusForShipment('IN_TRANSIT')).toBe('OUT_FOR_DELIVERY');
    expect(orderStatusForShipment('DELIVERED')).toBe('COMPLETED');
    expect(orderStatusForShipment('RIDER_ASSIGNED')).toBeUndefined();
  });

  it('plans the single steps an order needs', () => {
    expect(orderPathTo('READY', 'OUT_FOR_DELIVERY')).toEqual(['OUT_FOR_DELIVERY']);
    expect(orderPathTo('PREPARING', 'OUT_FOR_DELIVERY')).toEqual(['READY', 'OUT_FOR_DELIVERY']);
    expect(orderPathTo('READY', 'COMPLETED')).toEqual(['OUT_FOR_DELIVERY', 'COMPLETED']);
    expect(orderPathTo('COMPLETED', 'OUT_FOR_DELIVERY')).toEqual([]);
    expect(orderPathTo('CANCELLED', 'COMPLETED')).toEqual([]);
    expect(orderPathTo('OUT_FOR_DELIVERY', 'OUT_FOR_DELIVERY')).toEqual([]);
  });
});

describe('resolveDeliverySettings', () => {
  it('defaults to off, at READY, own riders', () => {
    expect(resolveDeliverySettings(undefined)).toEqual(DEFAULT_DELIVERY_SETTINGS);
    expect(resolveDeliverySettings(null).providers).not.toBe(DEFAULT_DELIVERY_SETTINGS.providers);
  });

  it('keeps known values and drops unknown or repeated providers', () => {
    const s = resolveDeliverySettings({
      dispatchEnabled: true,
      dispatchAt: 'PREPARING',
      strategy: 'cheapest',
      providers: ['mock', 'zomato' as never, 'mock', 'self'],
    });
    expect(s).toEqual({ dispatchEnabled: true, dispatchAt: 'PREPARING', strategy: 'cheapest', providers: ['mock', 'self'] });
  });

  it('falls back when values are junk', () => {
    const s = resolveDeliverySettings({ dispatchEnabled: 'yes' as never, dispatchAt: 'NOW' as never, strategy: 'random' as never, providers: [] });
    expect(s).toEqual(DEFAULT_DELIVERY_SETTINGS);
  });
});

describe('toPublicShipment', () => {
  it('shows the label, carrier, rider name and an https tracking link only', () => {
    expect(toPublicShipment({
      status: 'PICKED_UP', carrier: 'Rapido', rider: { name: 'Ravi', phone: '+911234' }, etaMinutes: 12, trackingUrl: 'https://track.example/abc',
    })).toEqual({ status: 'PICKED_UP', label: 'Picked up', carrier: 'Rapido', riderName: 'Ravi', etaMinutes: 12, trackingUrl: 'https://track.example/abc' });
    expect(toPublicShipment({ status: 'BOOKED', trackingUrl: 'javascript:alert(1)' })).toEqual({ status: 'BOOKED', label: 'Rider requested' });
  });
});
