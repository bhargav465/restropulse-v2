import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIDEO_RETRY_POLICY as P,
  backoffBeforeAttempt,
  classifyVideoFailure,
  decideAfterFailure,
  loadVideoRetryPolicy,
  usesAlternateModel,
} from '../../../../src/services/processors/media-job-poller/video-retry-policy.js';

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

describe('classifyVideoFailure', () => {
  it.each([
    'NSFW content detected',
    'The input was flagged by our safety system',
    'Content policy violation',
    'prompt contains sensitive words',
    'Rejected by moderation',
  ])('treats "%s" as permanent', (msg) => {
    expect(classifyVideoFailure(msg)).toBe('permanent');
  });

  it.each([
    'Prediction timed out',
    'CUDA out of memory',
    'stale RUNNING -- attempt exceeded the 20 minute budget',
    'Replicate prediction canceled',
    '503 Service Unavailable',
  ])('treats "%s" as retryable', (msg) => {
    expect(classifyVideoFailure(msg)).toBe('retryable');
  });

  it('treats a missing error as retryable', () => {
    expect(classifyVideoFailure(undefined)).toBe('retryable');
  });
});

describe('backoffBeforeAttempt', () => {
  it('follows the 2m, 10m, 30m, 2h, 6h table and repeats the last step', () => {
    expect(backoffBeforeAttempt(2, P)).toBe(2 * MIN);
    expect(backoffBeforeAttempt(3, P)).toBe(10 * MIN);
    expect(backoffBeforeAttempt(4, P)).toBe(30 * MIN);
    expect(backoffBeforeAttempt(5, P)).toBe(2 * HOUR);
    expect(backoffBeforeAttempt(6, P)).toBe(6 * HOUR);
    expect(backoffBeforeAttempt(8, P)).toBe(6 * HOUR);
  });
});

describe('usesAlternateModel', () => {
  it('switches model from attempt 3', () => {
    expect(usesAlternateModel(1, P)).toBe(false);
    expect(usesAlternateModel(2, P)).toBe(false);
    expect(usesAlternateModel(3, P)).toBe(true);
    expect(usesAlternateModel(8, P)).toBe(true);
  });
});

describe('loadVideoRetryPolicy', () => {
  it('defaults to 8 attempts within 24 hours', () => {
    const p = loadVideoRetryPolicy({});
    expect(p.maxAttempts).toBe(8);
    expect(p.maxWindowMs).toBe(24 * HOUR);
  });

  it('reads VIDEO_MAX_ATTEMPTS and VIDEO_RETRY_WINDOW_HOURS', () => {
    const p = loadVideoRetryPolicy({ VIDEO_MAX_ATTEMPTS: '5', VIDEO_RETRY_WINDOW_HOURS: '12' });
    expect(p.maxAttempts).toBe(5);
    expect(p.maxWindowMs).toBe(12 * HOUR);
  });

  it('ignores invalid values', () => {
    const p = loadVideoRetryPolicy({ VIDEO_MAX_ATTEMPTS: 'lots', VIDEO_RETRY_WINDOW_HOURS: '-3' });
    expect(p.maxAttempts).toBe(8);
    expect(p.maxWindowMs).toBe(24 * HOUR);
  });
});

describe('decideAfterFailure', () => {
  const now = new Date('2026-11-24T12:00:00Z');

  it('schedules a retry after a retryable failure', () => {
    const d = decideAfterFailure({ attempts: 1, startedAt: now, firstStartedAt: now }, 'timed out', now, P);
    expect(d).toEqual({ action: 'retry', errorClass: 'retryable', nextAttemptAt: new Date(now.getTime() + 2 * MIN) });
  });

  it('gives up at once on a permanent failure', () => {
    const d = decideAfterFailure({ attempts: 1, startedAt: now }, 'NSFW content detected', now, P);
    expect(d.action).toBe('give_up');
    expect(d.errorClass).toBe('permanent');
  });

  it('gives up when the attempt ceiling is reached', () => {
    const d = decideAfterFailure({ attempts: 8, startedAt: now, firstStartedAt: now }, 'timed out', now, P);
    expect(d.action).toBe('give_up');
    if (d.action === 'give_up') expect(d.reason).toMatch(/8 attempts/);
  });

  it('gives up when the next attempt would start outside the 24 hour window', () => {
    const first = new Date(now.getTime() - 20 * HOUR);
    // attempt 4 failed: wait before attempt 5 is 2h -> starts at 22h, inside
    expect(decideAfterFailure({ attempts: 4, startedAt: now, firstStartedAt: first }, 'x', now, P).action).toBe('retry');
    // attempt 5 failed: wait before attempt 6 is 6h -> would start at 26h, outside
    const d = decideAfterFailure({ attempts: 5, startedAt: now, firstStartedAt: first }, 'x', now, P);
    expect(d.action).toBe('give_up');
    if (d.action === 'give_up') expect(d.reason).toMatch(/24h/);
  });

  it('falls back to startedAt when firstStartedAt is missing', () => {
    // attempt 2 failed; attempt 3 would wait 10m and start 24h05m after the first
    const first = new Date(now.getTime() - 23 * HOUR - 55 * MIN);
    const d = decideAfterFailure({ attempts: 2, startedAt: first }, 'x', now, P);
    expect(d.action).toBe('give_up');
  });
});
