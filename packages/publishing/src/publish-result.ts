/**
 * Pure derivation of a post's status transition from a single-platform publish
 * result. Shared by the manual `/publish` API route and the automated
 * publishing cron so the two call sites can't drift out of sync (as they did
 * when this logic was independently re-implemented in each place).
 *
 * The actual DB write, `publishAttempts` increment, and any monitoring/attempt
 * logging stay caller-side, since those differ between the two call sites.
 */

import type { PostStatus } from '@restropulse/shared';
import type { PublishResult } from './publishing-service.js';

export interface AppliedPublishResult {
    status: PostStatus;
    publishError: string | null;
    externalPostId: string | null;
}

export function applyPublishResult(
    result: PublishResult,
    options?: { isFinalAttempt?: boolean },
): AppliedPublishResult {
    if (result.success) {
        return { status: 'POSTED', publishError: null, externalPostId: result.externalPostId ?? null };
    }

    const shouldFail = (options?.isFinalAttempt ?? false) || !result.retryable;
    return {
        status: shouldFail ? 'MISSED_DEADLINE' : 'SCHEDULED',
        publishError: result.error ?? 'Unknown publish error',
        externalPostId: null,
    };
}
