/**
 * Video retry policy (A3-1, docs/LAUNCH_ARCHITECTURE.md).
 *
 * Owner decision: a video post keeps retrying until it succeeds, with no
 * silent fallback to an image. A hard ceiling (8 attempts or 24 h, both
 * config values) stops a permanently broken prompt from spending forever.
 * A content-policy rejection is permanent and fails at once.
 *
 * Everything here is pure so the poller's decisions can be unit tested
 * without a clock or a database.
 */

import type { MediaFailureClass, MediaJobRecord } from '@restropulse/shared';

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

export interface VideoRetryPolicy {
  /** Total attempts including the first. */
  maxAttempts: number;
  /** No new attempt starts once this long has passed since the first one. */
  maxWindowMs: number;
  /** Wait before attempt n+1, indexed by n-1. The last entry repeats. */
  backoffMs: readonly number[];
  /** An attempt still running after this long is failed (the post is not). */
  attemptTimeoutMs: number;
  /** Attempts numbered at or above this use the alternate model. */
  alternateModelFromAttempt: number;
}

export const DEFAULT_VIDEO_RETRY_POLICY: VideoRetryPolicy = {
  maxAttempts: 8,
  maxWindowMs: 24 * HOUR,
  backoffMs: [2 * MINUTE, 10 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR],
  attemptTimeoutMs: 20 * MINUTE,
  alternateModelFromAttempt: 3,
};

function positiveNumber(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * Reads the ceiling from the environment so the owner can change it without
 * a code change: VIDEO_MAX_ATTEMPTS and VIDEO_RETRY_WINDOW_HOURS. Invalid or
 * missing values fall back to the defaults.
 */
export function loadVideoRetryPolicy(env: NodeJS.ProcessEnv = process.env): VideoRetryPolicy {
  const maxAttempts = positiveNumber(env.VIDEO_MAX_ATTEMPTS);
  const windowHours = positiveNumber(env.VIDEO_RETRY_WINDOW_HOURS);
  return {
    ...DEFAULT_VIDEO_RETRY_POLICY,
    ...(maxAttempts ? { maxAttempts: Math.floor(maxAttempts) } : {}),
    ...(windowHours ? { maxWindowMs: windowHours * HOUR } : {}),
  };
}

/**
 * Provider wording for a safety or content-policy rejection. Retrying the
 * same prompt cannot change that answer, so it is permanent.
 */
const PERMANENT_PATTERNS: readonly RegExp[] = [
  /nsfw/i,
  /content[\s_-]?polic/i,
  /safety/i,
  /flagged/i,
  /sensitive (content|word|information)/i,
  /moderation/i,
  /prohibited/i,
  /violat/i,
  /invalid (input|prompt|parameter)/i,
];

export function classifyVideoFailure(error: string | undefined): MediaFailureClass {
  if (!error) return 'retryable';
  return PERMANENT_PATTERNS.some((re) => re.test(error)) ? 'permanent' : 'retryable';
}

export function backoffBeforeAttempt(nextAttempt: number, policy: VideoRetryPolicy): number {
  const idx = Math.max(0, nextAttempt - 2);
  const table = policy.backoffMs;
  return table[Math.min(idx, table.length - 1)] ?? 0;
}

export function usesAlternateModel(attempt: number, policy: VideoRetryPolicy): boolean {
  return attempt >= policy.alternateModelFromAttempt;
}

export type FailureDecision =
  | { action: 'retry'; errorClass: 'retryable'; nextAttemptAt: Date }
  | { action: 'give_up'; errorClass: MediaFailureClass; reason: string };

/**
 * Decides what happens after the attempt numbered job.attempts failed.
 */
export function decideAfterFailure(
  job: Pick<MediaJobRecord, 'attempts' | 'startedAt' | 'firstStartedAt'>,
  error: string,
  now: Date,
  policy: VideoRetryPolicy,
): FailureDecision {
  const errorClass = classifyVideoFailure(error);
  const attempts = job.attempts;

  if (errorClass === 'permanent') {
    return { action: 'give_up', errorClass, reason: `rejected by the video model: ${error}` };
  }
  if (attempts >= policy.maxAttempts) {
    return {
      action: 'give_up',
      errorClass,
      reason: `video failed after ${attempts} attempts (limit ${policy.maxAttempts}); last error: ${error}`,
    };
  }

  const firstStart = new Date(job.firstStartedAt ?? job.startedAt).getTime();
  const nextAttemptAt = new Date(now.getTime() + backoffBeforeAttempt(attempts + 1, policy));
  if (nextAttemptAt.getTime() - firstStart > policy.maxWindowMs) {
    const hours = Math.round(policy.maxWindowMs / HOUR);
    return {
      action: 'give_up',
      errorClass,
      reason: `video failed after ${attempts} attempts within ${hours}h; last error: ${error}`,
    };
  }

  return { action: 'retry', errorClass, nextAttemptAt };
}
