import { describe, it, expect } from 'vitest';
import {
  POST_APPROVAL_BUFFER_HOURS,
  CYCLE_APPROVAL_BUFFER_HOURS,
  ROLLING_WINDOW_HOURS,
  MIN_SCHEDULE_AHEAD_HOURS,
  computePostApprovalDeadline,
  computeCycleApprovalDeadline,
  isPostPastApprovalDeadline,
  isCyclePastApprovalDeadline,
  validateTimingConstraints,
} from '../src/approval-deadlines.js';

const HOUR_MS = 60 * 60 * 1000;

describe('approval-deadlines constants', () => {
  it('post buffer is 2 hours', () => {
    expect(POST_APPROVAL_BUFFER_HOURS).toBe(2);
  });

  it('cycle buffer is 72 hours', () => {
    expect(CYCLE_APPROVAL_BUFFER_HOURS).toBe(72);
  });

  it('rolling window is 48 hours', () => {
    expect(ROLLING_WINDOW_HOURS).toBe(48);
  });

  it('min schedule ahead is 2.5 hours', () => {
    expect(MIN_SCHEDULE_AHEAD_HOURS).toBe(2.5);
  });

  it('static invariant: CYCLE_APPROVAL_BUFFER > ROLLING_WINDOW > POST_APPROVAL_BUFFER', () => {
    expect(CYCLE_APPROVAL_BUFFER_HOURS).toBeGreaterThan(ROLLING_WINDOW_HOURS);
    expect(ROLLING_WINDOW_HOURS).toBeGreaterThan(POST_APPROVAL_BUFFER_HOURS);
    expect(MIN_SCHEDULE_AHEAD_HOURS).toBeGreaterThan(POST_APPROVAL_BUFFER_HOURS);
  });
});

describe('computePostApprovalDeadline', () => {
  it('subtracts POST_APPROVAL_BUFFER_HOURS from scheduledFor (ISO string)', () => {
    const scheduled = '2026-04-19T10:00:00.000Z';
    const deadline = computePostApprovalDeadline({ scheduledFor: scheduled });
    expect(deadline).not.toBeNull();
    expect(deadline!.toISOString()).toBe('2026-04-19T08:00:00.000Z');
  });

  it('returns null when scheduledFor is missing', () => {
    expect(computePostApprovalDeadline({ scheduledFor: undefined })).toBeNull();
  });

  it('returns null when scheduledFor is empty string', () => {
    expect(computePostApprovalDeadline({ scheduledFor: '' })).toBeNull();
  });

  it('returns null when scheduledFor is unparseable', () => {
    expect(computePostApprovalDeadline({ scheduledFor: 'not-a-date' })).toBeNull();
  });
});

describe('computeCycleApprovalDeadline', () => {
  it('subtracts CYCLE_APPROVAL_BUFFER_HOURS (72h) from startDate', () => {
    const start = '2026-05-01T00:00:00.000Z';
    const deadline = computeCycleApprovalDeadline({ startDate: start });
    expect(deadline).not.toBeNull();
    // 72h before 2026-05-01 = 2026-04-28T00:00:00.000Z
    expect(deadline!.toISOString()).toBe('2026-04-28T00:00:00.000Z');
  });

  it('returns null when startDate is missing', () => {
    expect(computeCycleApprovalDeadline({ startDate: undefined as unknown as string })).toBeNull();
  });

  it('returns null when startDate is unparseable', () => {
    expect(computeCycleApprovalDeadline({ startDate: 'garbage' })).toBeNull();
  });
});

describe('isPostPastApprovalDeadline', () => {
  it('returns true exactly at the deadline (boundary inclusive)', () => {
    const scheduled = '2026-04-19T10:00:00.000Z';
    const now = new Date('2026-04-19T08:00:00.000Z');
    expect(isPostPastApprovalDeadline({ scheduledFor: scheduled }, now)).toBe(true);
  });

  it('returns true after the deadline', () => {
    const scheduled = '2026-04-19T10:00:00.000Z';
    const now = new Date('2026-04-19T09:00:00.000Z');
    expect(isPostPastApprovalDeadline({ scheduledFor: scheduled }, now)).toBe(true);
  });

  it('returns false before the deadline', () => {
    const scheduled = '2026-04-19T10:00:00.000Z';
    const now = new Date('2026-04-19T07:59:59.999Z');
    expect(isPostPastApprovalDeadline({ scheduledFor: scheduled }, now)).toBe(false);
  });

  it('returns false when scheduledFor is missing (window treated as open)', () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    expect(isPostPastApprovalDeadline({ scheduledFor: undefined }, now)).toBe(false);
  });
});

describe('isCyclePastApprovalDeadline', () => {
  it('returns true exactly at the deadline (boundary inclusive)', () => {
    const start = '2026-05-01T00:00:00.000Z';
    const now = new Date(new Date(start).getTime() - CYCLE_APPROVAL_BUFFER_HOURS * HOUR_MS);
    expect(isCyclePastApprovalDeadline({ startDate: start }, now)).toBe(true);
  });

  it('returns true after the deadline', () => {
    const start = '2026-05-01T00:00:00.000Z';
    // 72h deadline = Apr 28; Apr 30 is past it
    const now = new Date('2026-04-30T00:00:00.000Z');
    expect(isCyclePastApprovalDeadline({ startDate: start }, now)).toBe(true);
  });

  it('returns false well before the deadline', () => {
    const start = '2026-05-01T00:00:00.000Z';
    const now = new Date('2026-04-01T00:00:00.000Z');
    expect(isCyclePastApprovalDeadline({ startDate: start }, now)).toBe(false);
  });

  it('returns false when startDate is missing', () => {
    const now = new Date('2026-04-19T10:00:00.000Z');
    expect(
      isCyclePastApprovalDeadline({ startDate: undefined as unknown as string }, now),
    ).toBe(false);
  });
});

describe('validateTimingConstraints', () => {
  it('passes with production defaults', () => {
    expect(() =>
      validateTimingConstraints({
        postApprovalBufferMins: 120,   // 2h
        rollingWindowMins: 2880,       // 48h
        cycleApprovalBufferMins: 4320, // 72h
      }),
    ).not.toThrow();
  });

  it('passes with test profile defaults (5-2-10 mins)', () => {
    expect(() =>
      validateTimingConstraints({
        postApprovalBufferMins: 2,
        rollingWindowMins: 5,
        cycleApprovalBufferMins: 10,
      }),
    ).not.toThrow();
  });

  it('throws when rollingWindow equals postApprovalBuffer', () => {
    expect(() =>
      validateTimingConstraints({
        postApprovalBufferMins: 120,
        rollingWindowMins: 120,
        cycleApprovalBufferMins: 4320,
      }),
    ).toThrow('ROLLING_WINDOW_MINS (120) must be greater than POST_APPROVAL_BUFFER_MINS (120)');
  });

  it('throws when rollingWindow is less than postApprovalBuffer', () => {
    expect(() =>
      validateTimingConstraints({
        postApprovalBufferMins: 120,
        rollingWindowMins: 60,
        cycleApprovalBufferMins: 4320,
      }),
    ).toThrow('ROLLING_WINDOW_MINS (60) must be greater than POST_APPROVAL_BUFFER_MINS (120)');
  });

  it('throws when cycleApprovalBuffer equals rollingWindow', () => {
    expect(() =>
      validateTimingConstraints({
        postApprovalBufferMins: 120,
        rollingWindowMins: 2880,
        cycleApprovalBufferMins: 2880,
      }),
    ).toThrow('CYCLE_APPROVAL_BUFFER_MINS (2880) must be greater than ROLLING_WINDOW_MINS (2880)');
  });

  it('throws when cycleApprovalBuffer is less than rollingWindow', () => {
    expect(() =>
      validateTimingConstraints({
        postApprovalBufferMins: 120,
        rollingWindowMins: 2880,
        cycleApprovalBufferMins: 1440,
      }),
    ).toThrow('CYCLE_APPROVAL_BUFFER_MINS (1440) must be greater than ROLLING_WINDOW_MINS (2880)');
  });

  it('error message includes both values for rollingWindow constraint', () => {
    let message = '';
    try {
      validateTimingConstraints({
        postApprovalBufferMins: 200,
        rollingWindowMins: 100,
        cycleApprovalBufferMins: 400,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('100');
    expect(message).toContain('200');
  });

  it('error message includes both values for cycleApprovalBuffer constraint', () => {
    let message = '';
    try {
      validateTimingConstraints({
        postApprovalBufferMins: 120,
        rollingWindowMins: 2880,
        cycleApprovalBufferMins: 2880,
      });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain('2880');
  });
});
