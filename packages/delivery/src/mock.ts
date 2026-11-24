/**
 * `mock`: a pretend delivery partner with a fixed timeline, for tests, demos
 * and staging. It never calls anything outside the process.
 *
 * Timeline after booking (in "minutes", see `minuteMs`): rider assigned at 1,
 * picked up at 4, on the way at 6, delivered at 15. A drop at pincode 000000
 * is not serviceable, so the fallback path can be tried too.
 *
 * Webhooks: body `{ "events": [{ "id", "shipmentId", "status", "at"?, "riderName"? }] }`
 * signed with HMAC-SHA256 of the raw body in `x-mock-signature` (hex).
 */

import crypto from 'node:crypto';
import type { DeliveryProviderInfo, ShipmentEvent, ShipmentStatus } from '@restropulse/shared';
import { isShipmentStatus } from '@restropulse/shared';
import type { DeliveryProvider } from './provider.js';

export const MOCK_PROVIDER_INFO: DeliveryProviderInfo = { id: 'mock', label: 'Test partner (mock)', kind: 'partner', webhooks: false };

export const MOCK_TIMELINE: ReadonlyArray<{ at: number; status: ShipmentStatus }> = [
  { at: 0, status: 'BOOKED' },
  { at: 1, status: 'RIDER_ASSIGNED' },
  { at: 4, status: 'PICKED_UP' },
  { at: 6, status: 'IN_TRANSIT' },
  { at: 15, status: 'DELIVERED' },
];

export const MOCK_FEE = 45;
export const MOCK_ETA_MINUTES = 30;
const RIDER = { name: 'Test Rider' };

export interface MockProviderOptions {
  /** Webhook signing secret. Without it every webhook is rejected. */
  webhookSecret?: string;
  /** Length of a timeline minute in ms (shorten for demos). Default 60000. */
  minuteMs?: number;
  now?: () => Date;
}

export function mockSignature(secret: string, rawBody: Buffer | string): string {
  return crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
}

function bookedAt(providerShipmentId: string): number | null {
  const m = /^mock_[\w-]+_([0-9a-z]+)$/.exec(providerShipmentId);
  if (!m) return null;
  const ms = parseInt(m[1], 36);
  return Number.isFinite(ms) ? ms : null;
}

export function createMockProvider(opts: MockProviderOptions = {}): DeliveryProvider {
  const minuteMs = opts.minuteMs && opts.minuteMs > 0 ? opts.minuteMs : 60_000;
  const now = opts.now ?? (() => new Date());

  return {
    id: 'mock',
    info: MOCK_PROVIDER_INFO,
    async quote(req) {
      if (req.drop.address.pincode === '000000') {
        return { provider: 'mock', serviceable: false, fee: 0, reason: 'Outside the test area' };
      }
      return { provider: 'mock', serviceable: true, fee: MOCK_FEE, etaMinutes: MOCK_ETA_MINUTES, quoteRef: `mq_${req.orderId}` };
    },
    async createShipment(req, quote) {
      return {
        providerShipmentId: `mock_${req.orderId}_${now().getTime().toString(36)}`,
        status: 'BOOKED',
        carrier: 'Mock Rider Co',
        fee: quote.fee,
        ...(quote.etaMinutes !== undefined ? { etaMinutes: quote.etaMinutes } : {}),
      };
    },
    async cancelShipment() {
      /* stateless: the shipment record is the source of truth */
    },
    async track(providerShipmentId) {
      const start = bookedAt(providerShipmentId);
      if (start === null) return null;
      const elapsed = (now().getTime() - start) / minuteMs;
      let step = MOCK_TIMELINE[0];
      for (const s of MOCK_TIMELINE) if (elapsed >= s.at) step = s;
      const left = Math.max(0, Math.ceil(MOCK_TIMELINE[MOCK_TIMELINE.length - 1].at - elapsed));
      return {
        eventId: `${providerShipmentId}:${step.status}`,
        providerShipmentId,
        status: step.status,
        at: new Date(start + step.at * minuteMs).toISOString(),
        ...(step.status !== 'BOOKED' ? { rider: RIDER } : {}),
        ...(step.status !== 'DELIVERED' ? { etaMinutes: left } : {}),
      };
    },
    verifyWebhook({ headers, rawBody }) {
      const given = headers['x-mock-signature'];
      if (!opts.webhookSecret || !given || !/^[0-9a-f]{64}$/i.test(given)) return false;
      const expected = mockSignature(opts.webhookSecret, rawBody);
      return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(given.toLowerCase(), 'hex'));
    },
    parseWebhook(rawBody) {
      let body: unknown;
      try {
        body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        return [];
      }
      const events = (body as { events?: unknown }).events;
      if (!Array.isArray(events)) return [];
      const out: ShipmentEvent[] = [];
      for (const e of events as Array<Record<string, unknown>>) {
        if (typeof e?.id !== 'string' || typeof e.shipmentId !== 'string' || !isShipmentStatus(e.status)) continue;
        const at = typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at)) ? new Date(e.at).toISOString() : now().toISOString();
        out.push({
          eventId: e.id,
          providerShipmentId: e.shipmentId,
          status: e.status,
          at,
          ...(typeof e.riderName === 'string' ? { rider: { name: e.riderName.slice(0, 80) } } : {}),
        });
      }
      return out;
    },
  };
}
