import { describe, it, expect } from 'vitest';
import { getEntitlement, isPlanPeriodOver, MANUAL_BILLING_GRACE_DAYS, resolveOrderingSettings, type Subscription } from '../src/index.js';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-12-01T00:00:00.000Z');

function sub(overrides: Partial<Subscription>): Subscription {
  return { id: 's1', restaurantId: 'r1', status: 'ACTIVE', credits: 0, ...overrides };
}

describe('manual billing entitlement', () => {
  it('keeps an active plan entitled through its period and the grace days', () => {
    const end = new Date(now.getTime() - (MANUAL_BILLING_GRACE_DAYS * DAY - 60_000)).toISOString();
    expect(isPlanPeriodOver({ currentPeriodEnd: end }, now)).toBe(false);
    expect(getEntitlement(sub({ currentPeriodEnd: end }), now).activePlan).toBe(true);
  });

  it('stops entitling an active plan once the grace days after its period have passed', () => {
    const end = new Date(now.getTime() - MANUAL_BILLING_GRACE_DAYS * DAY).toISOString();
    expect(isPlanPeriodOver({ currentPeriodEnd: end }, now)).toBe(true);
    const state = getEntitlement(sub({ currentPeriodEnd: end }), now);
    expect(state.activePlan).toBe(false);
    expect(state.entitled).toBe(false);
  });

  it('treats a plan with no period end (or an unreadable one) as not expired', () => {
    expect(isPlanPeriodOver({}, now)).toBe(false);
    expect(isPlanPeriodOver({ currentPeriodEnd: 'not a date' }, now)).toBe(false);
    expect(getEntitlement(sub({}), now).activePlan).toBe(true);
  });

  it('still lets the free trial entitle after a plan period runs out', () => {
    const state = getEntitlement(sub({
      currentPeriodEnd: new Date(now.getTime() - 30 * DAY).toISOString(),
      trialEndsAt: new Date(now.getTime() + 2 * DAY).toISOString(),
    }), now);
    expect(state.activePlan).toBe(false);
    expect(state.inTrial).toBe(true);
    expect(state.entitled).toBe(true);
  });
});

describe('ordering settings without a payment gateway', () => {
  it('drops the legacy cashAccepted flag from stored settings', () => {
    const resolved = resolveOrderingSettings({ storeOpen: true, cashAccepted: false } as never);
    expect(resolved.storeOpen).toBe(true);
    expect('cashAccepted' in resolved).toBe(false);
  });
});
