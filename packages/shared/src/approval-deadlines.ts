// -------------------------------------------------------
// Approval Deadlines
//
// Shared logic for post- and cycle-approval windows.
// Imported by apps/web (UI countdown + lock), apps/api (route enforcement),
// and apps/content-engine (deadline auto-advance processor).
//
// Pure functions, zero runtime deps -- safe for browser, Node, and tests.
//
// All functions accept an optional bufferHours override so callers
// (e.g. content-engine with env-configured values) can deviate from the
// compile-time defaults without forking the logic.
// -------------------------------------------------------

import type { Post, StrategyCycle } from './index.js';

// Default buffer hours. These are the production values and the fallback for
// any caller that does not supply an explicit override.
export const POST_APPROVAL_BUFFER_HOURS = 2;

// Cycle approval buffer is intentionally LARGER than the rolling window:
//   CYCLE_APPROVAL_BUFFER (72h) > ROLLING_WINDOW (48h)
// This gives users a 24h window between "last chance for feedback" and
// "posts start being generated". If the cycle deadline fires (auto-approve),
// the rolling window picks it up on the next tick.
export const CYCLE_APPROVAL_BUFFER_HOURS = 72;
export const ROLLING_WINDOW_HOURS = 48;

// Minimum hours ahead a post must be scheduled.
// = POST_APPROVAL_BUFFER_HOURS (2h) + 0.5h review buffer.
// ASAP scheduling defaults to exactly this value.
export const MIN_SCHEDULE_AHEAD_HOURS = 2.5;

const MS_PER_HOUR = 60 * 60 * 1000;

function toDateOrNull(value: unknown): Date | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/**
 * Deadline after which a post's approval status auto-locks to SCHEDULED.
 * Returns null when `scheduledFor` is missing or unparseable.
 */
export function computePostApprovalDeadline(
  post: Pick<Post, 'scheduledFor'>,
  bufferHours = POST_APPROVAL_BUFFER_HOURS,
): Date | null {
  const scheduled = toDateOrNull(post.scheduledFor);
  if (!scheduled) return null;
  return new Date(scheduled.getTime() - bufferHours * MS_PER_HOUR);
}

/**
 * Deadline after which a cycle's approval status auto-locks to APPROVED.
 * Returns null when `startDate` is missing or unparseable.
 */
export function computeCycleApprovalDeadline(
  cycle: Pick<StrategyCycle, 'startDate'>,
  bufferHours = CYCLE_APPROVAL_BUFFER_HOURS,
): Date | null {
  const start = toDateOrNull(cycle.startDate);
  if (!start) return null;
  return new Date(start.getTime() - bufferHours * MS_PER_HOUR);
}

/**
 * True when `now` is at or past the post's approval deadline.
 * False when the deadline cannot be computed (treated as still open).
 */
export function isPostPastApprovalDeadline(
  post: Pick<Post, 'scheduledFor'>,
  now: Date,
  bufferHours = POST_APPROVAL_BUFFER_HOURS,
): boolean {
  const deadline = computePostApprovalDeadline(post, bufferHours);
  if (!deadline) return false;
  return now.getTime() >= deadline.getTime();
}

/**
 * True when `now` is at or past the cycle's approval deadline.
 * False when the deadline cannot be computed (treated as still open).
 */
export function isCyclePastApprovalDeadline(
  cycle: Pick<StrategyCycle, 'startDate'>,
  now: Date,
  bufferHours = CYCLE_APPROVAL_BUFFER_HOURS,
): boolean {
  const deadline = computeCycleApprovalDeadline(cycle, bufferHours);
  if (!deadline) return false;
  return now.getTime() >= deadline.getTime();
}

// -------------------------------------------------------
// Timing Constraint Validation
//
// Called at content-engine startup to catch misconfigured env values
// (e.g. from npm run env:test) before they cause silent pipeline failures.
//
// Static invariant (not checked here — both are compile-time constants):
//   MIN_SCHEDULE_AHEAD_HOURS (2.5) > POST_APPROVAL_BUFFER_HOURS (2)
//   Guarantees a newly created adhoc post always has an open feedback window.
// -------------------------------------------------------

export interface TimingConstraintConfig {
  postApprovalBufferMins: number;
  rollingWindowMins: number;
  cycleApprovalBufferMins: number;
}

/**
 * Throws if content-engine timing env vars violate logical invariants.
 * Call once after env is loaded, before starting any cron jobs.
 */
export function validateTimingConstraints(config: TimingConstraintConfig): void {
  const { postApprovalBufferMins, rollingWindowMins, cycleApprovalBufferMins } = config;

  if (rollingWindowMins <= postApprovalBufferMins) {
    throw new Error(
      `ROLLING_WINDOW_MINS (${rollingWindowMins}) must be greater than POST_APPROVAL_BUFFER_MINS (${postApprovalBufferMins}). ` +
      `The rolling window must generate stubs while users can still review them.`,
    );
  }

  if (cycleApprovalBufferMins <= rollingWindowMins) {
    throw new Error(
      `CYCLE_APPROVAL_BUFFER_MINS (${cycleApprovalBufferMins}) must be greater than ROLLING_WINDOW_MINS (${rollingWindowMins}). ` +
      `The cycle approval deadline must fire before the rolling window starts generating post stubs.`,
    );
  }
}
