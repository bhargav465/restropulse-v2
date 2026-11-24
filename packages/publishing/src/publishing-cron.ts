/**
 * Publishing Cron Service
 * Automatically publishes scheduled posts when their scheduled time arrives.
 * Runs every 5 minutes to check for posts due for publishing.
 *
 * Flow:
 *   1. Query posts with status SCHEDULED and scheduledFor <= now
 *   2. For each post, look up the restaurant's Instagram credentials
 *   3. Call the publishing service to publish to Instagram/Facebook
 *   4. Update post status to POSTED (success) or MISSED_DEADLINE (permanent failure)
 *   5. Track retry attempts for transient failures
 */

import cron from 'node-cron';
import { getPostsCollection, getPublishFailuresCollection, getRestaurantsCollection, toObjectId } from '@restropulse/db';
import { publishPost, type PublishFailureClass } from './publishing-service.js';
import { applyPublishResult } from './publish-result.js';
import { POST_PUBLISH_GRACE_HOURS } from '@restropulse/shared';
import { createLogger, tracedCronJob, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('publishing-cron');

// Constants
const MAX_PUBLISH_ATTEMPTS = 3;
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_MINUTE = 60 * 1000;

/**
 * Wait before retry N (index = attempts already made - 1). Without this a
 * transient failure was retried on the very next 5-minute tick, so a short
 * Meta outage burned all three attempts in ~10 minutes.
 */
export const PUBLISH_RETRY_BACKOFF_MINUTES = [5, 20] as const;

/**
 * A post stuck in PUBLISHING longer than this was abandoned by a crashed or
 * restarted worker. The slowest legitimate publish (reel upload + 5-minute
 * processing poll + publish) is well under this.
 */
export const STALE_PUBLISHING_MINUTES = 30;

export const REAUTH_PUBLISH_ERROR =
    'Instagram/Facebook needs to be reconnected before this post can go out. Reconnect in Settings and it will publish automatically.';

export const INTERRUPTED_PUBLISH_ERROR =
    'Publishing was interrupted. Check Instagram/Facebook before posting again, in case it already went out.';

export function nextRetryAt(attemptsMade: number, now: Date = new Date()): Date {
    const idx = Math.min(Math.max(attemptsMade - 1, 0), PUBLISH_RETRY_BACKOFF_MINUTES.length - 1);
    return new Date(now.getTime() + PUBLISH_RETRY_BACKOFF_MINUTES[idx] * MS_PER_MINUTE);
}
const CRON_SCHEDULE = process.env.CRON_PUBLISHER ?? '*/5 * * * *';

// Track publishing attempts for monitoring
interface PublishAttempt {
    postId: string;
    restaurantId: string;
    timestamp: Date;
    success: boolean;
    platform: string;
    error?: string;
    externalPostId?: string;
}

const publishAttempts: PublishAttempt[] = [];

/**
 * Get scheduled posts that are due for publishing.
 * Returns posts with status SCHEDULED whose scheduledFor time has passed.
 * Excludes posts with PUBLISHING status to avoid race conditions.
 */
export async function getPostsDueForPublishing(): Promise<any[]> {
    const col = getPostsCollection();
    const now = new Date();
    // Lower bound: never publish a post more than the grace period past its
    // scheduledFor. Such posts have missed their window and are reaped to
    // MISSED_DEADLINE (see reapMissedScheduledPosts) instead of being published
    // late. The bound lives in the query so every caller is protected, not just
    // runPublishingJob.
    const graceCutoff = new Date(now.getTime() - POST_PUBLISH_GRACE_HOURS * MS_PER_HOUR);

    const posts = await col.find({
        status: 'SCHEDULED',
        scheduledFor: { $lte: now.toISOString(), $gte: graceCutoff.toISOString() },
        $and: [
            {
                $or: [
                    { publishAttempts: { $exists: false } },
                    { publishAttempts: { $lt: MAX_PUBLISH_ATTEMPTS } }
                ]
            },
            {
                // Respect retry backoff (unset = never attempted, or legacy doc)
                $or: [
                    { nextPublishAttemptAt: { $exists: false } },
                    { nextPublishAttemptAt: null },
                    { nextPublishAttemptAt: { $lte: now } }
                ]
            }
        ]
    }).sort({ scheduledFor: 1 }).toArray();

    return posts;
}

/**
 * Move SCHEDULED posts that are more than the grace period past their
 * scheduledFor to MISSED_DEADLINE. These missed their publish window (e.g. the
 * post was stuck in content generation and only became SCHEDULED long after its
 * target time) and must not be published late. publishError is intentionally
 * left unset so the UI renders "Missed Deadline" rather than "Publish Failed".
 * Returns the number of posts reaped.
 */
export async function reapMissedScheduledPosts(now: Date = new Date()): Promise<number> {
    const col = getPostsCollection();
    const graceCutoff = new Date(now.getTime() - POST_PUBLISH_GRACE_HOURS * MS_PER_HOUR);

    const result = await col.updateMany(
        {
            status: 'SCHEDULED',
            scheduledFor: { $lt: graceCutoff.toISOString() },
        },
        { $set: { status: 'MISSED_DEADLINE', updatedAt: new Date() } },
    );

    if (result.modifiedCount > 0) {
        log.info({ count: result.modifiedCount, graceHours: POST_PUBLISH_GRACE_HOURS }, 'Reaped past-due scheduled posts to MISSED_DEADLINE');
    }
    return result.modifiedCount;
}

/**
 * Record a post that failed for good in the `publishFailures` dead-letter
 * collection and emit a telemetry event (feeds the publish-failure alert).
 * Never throws: losing a dead-letter row must not break the publish loop.
 */
export async function recordPublishFailure(entry: {
    postId: string;
    restaurantId: string | null;
    platform: string;
    failureClass: PublishFailureClass | 'interrupted';
    error: string;
    errorCode?: string;
    attempts: number;
}): Promise<void> {
    trackEvent('post.publish_dead_lettered', {
        postId: entry.postId,
        restaurantId: entry.restaurantId ?? 'unknown',
        platform: entry.platform,
        failureClass: entry.failureClass,
        errorCode: entry.errorCode ?? 'none',
    });
    try {
        await getPublishFailuresCollection().insertOne({ ...entry, createdAt: new Date() });
    } catch (error) {
        log.error({ postId: entry.postId, error: String(error) }, 'Failed to write publish dead-letter record');
    }
}

/**
 * Fail posts left in PUBLISHING by a worker that crashed or restarted
 * mid-publish. They are NOT retried automatically: the publish may already
 * have reached Meta, and a retry would post twice. The merchant sees the
 * reason on the post and decides.
 */
export async function reapStalePublishingPosts(now: Date = new Date()): Promise<number> {
    const col = getPostsCollection();
    const cutoff = new Date(now.getTime() - STALE_PUBLISHING_MINUTES * MS_PER_MINUTE);
    const stale = await col.find({ status: 'PUBLISHING', updatedAt: { $lt: cutoff } }).toArray();

    let reaped = 0;
    for (const post of stale) {
        const result = await col.updateOne(
            { _id: post._id, status: 'PUBLISHING', updatedAt: { $lt: cutoff } },
            {
                $set: { status: 'MISSED_DEADLINE', publishError: INTERRUPTED_PUBLISH_ERROR, updatedAt: now },
                $unset: { nextPublishAttemptAt: '' },
            },
        );
        if (result.modifiedCount === 0) continue;
        reaped++;
        await recordPublishFailure({
            postId: String(post._id),
            restaurantId: post.restaurantId ?? null,
            platform: post.platform || 'INSTAGRAM',
            failureClass: 'interrupted',
            error: INTERRUPTED_PUBLISH_ERROR,
            attempts: post.publishAttempts ?? 0,
        });
    }

    if (reaped > 0) {
        log.warn({ count: reaped, staleMinutes: STALE_PUBLISHING_MINUTES }, 'Failed posts stuck in PUBLISHING');
    }
    return reaped;
}

/**
 * Flag a restaurant's Meta connection as needing reconnection. Publishing for
 * the restaurant pauses (posts stay SCHEDULED) until the merchant reconnects,
 * which replaces instagramCredentials and so clears the flag.
 */
export async function markRestaurantNeedsReauth(restaurantId: string, reason: string, now: Date = new Date()): Promise<void> {
    await getRestaurantsCollection().updateOne(
        { _id: toObjectId(restaurantId) as any, 'instagramCredentials.reauthRequiredAt': { $exists: false } },
        { $set: { 'instagramCredentials.reauthRequiredAt': now, 'instagramCredentials.reauthReason': reason } },
    );
}

/**
 * Get restaurant credentials for publishing.
 * Returns the restaurant document with Instagram credentials.
 */
export async function getRestaurantCredentials(restaurantId: string): Promise<any | null> {
    const col = getRestaurantsCollection();
    const restaurant = await col.findOne({
        _id: toObjectId(restaurantId) as any,
        'instagramCredentials.accessToken': { $exists: true, $ne: null }
    });

    return restaurant;
}

/**
 * Process a single post for publishing.
 * Handles the full lifecycle: credential lookup, publish, status update.
 */
export async function processPostForPublishing(postDoc: any): Promise<boolean> {
    const postsCol = getPostsCollection();
    const postId = postDoc._id.toString();
    const restaurantId = postDoc.restaurantId;
    const currentAttempts = postDoc.publishAttempts || 0;

    log.info({ postId, attempt: currentAttempts + 1, maxAttempts: MAX_PUBLISH_ATTEMPTS }, 'Processing post for publishing');

    // Atomically mark post as PUBLISHING to prevent race conditions
    const updateResult = await postsCol.findOneAndUpdate(
        {
            _id: postDoc._id,
            status: 'SCHEDULED'
        },
        {
            $set: {
                status: 'PUBLISHING',
                updatedAt: new Date()
            }
        },
        { returnDocument: 'after' }
    );

    // If update failed, post is already being processed or status changed
    if (!updateResult) {
        log.info({ postId }, 'Post is already being processed or status changed, skipping');
        return false;
    }

    // Validate restaurant ID exists
    if (!restaurantId) {
        log.error({ postId }, 'Post has no restaurantId, marking as MISSED_DEADLINE');
        await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    status: 'MISSED_DEADLINE',
                    publishError: 'No restaurant associated with this post',
                    updatedAt: new Date()
                },
                $inc: { publishAttempts: 1 }
            }
        );
        return false;
    }

    // Get restaurant credentials
    const restaurant = await getRestaurantCredentials(restaurantId);
    if (!restaurant || !restaurant.instagramCredentials) {
        log.error({ postId, restaurantId }, 'No Instagram credentials for restaurant');

        const newAttempts = currentAttempts + 1;
        const isFinalAttempt = newAttempts >= MAX_PUBLISH_ATTEMPTS;

        await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    ...(isFinalAttempt ? { status: 'MISSED_DEADLINE' } : {}),
                    publishError: 'Instagram not connected. Please connect Instagram in Settings.',
                    updatedAt: new Date()
                },
                $inc: { publishAttempts: 1 }
            }
        );

        publishAttempts.push({
            postId,
            restaurantId,
            timestamp: new Date(),
            success: false,
            platform: postDoc.platform || 'INSTAGRAM',
            error: 'No Instagram credentials'
        });

        return false;
    }

    // Publishing is paused while the restaurant's Meta connection needs
    // reconnecting: put the post back without spending an attempt. If the
    // merchant doesn't reconnect within the grace window it is reaped to
    // MISSED_DEADLINE like any other late post.
    if (restaurant.instagramCredentials.reauthRequiredAt) {
        log.info({ postId, restaurantId }, 'Restaurant needs to reconnect Meta; leaving post scheduled');
        await postsCol.updateOne(
            { _id: postDoc._id },
            { $set: { status: 'SCHEDULED', publishError: REAUTH_PUBLISH_ERROR, updatedAt: new Date() } }
        );
        return false;
    }

    // Prepare post data for publishing
    const publishablePost = {
        id: postId,
        type: postDoc.type || 'IMAGE',
        caption: postDoc.caption || '',
        thumbnail: postDoc.thumbnail || '',
        mediaUrls: postDoc.mediaUrls,
        videoUrl: postDoc.videoUrl,
        platform: postDoc.platform || 'INSTAGRAM'
    };

    const credentials = {
        userId: restaurant.instagramCredentials.userId,
        pageId: restaurant.instagramCredentials.pageId,
        accessToken: restaurant.instagramCredentials.accessToken
    };

    // Publish the post
    const result = await publishPost(publishablePost, credentials);

    const newAttempts = currentAttempts + 1;
    const isFinalAttempt = newAttempts >= MAX_PUBLISH_ATTEMPTS;
    const applied = applyPublishResult(result, { isFinalAttempt });

    if (result.success) {
        log.info({ postId, platform: publishablePost.platform }, 'Post published successfully');
        trackEvent('post.published', { postId, postType: publishablePost.type, platform: publishablePost.platform });

        // Ensure database update completes before returning
        const updateResult = await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    status: applied.status,
                    postedAt: new Date().toISOString(),
                    publishAttempts: newAttempts,
                    publishError: applied.publishError,
                    externalPostId: applied.externalPostId,
                    updatedAt: new Date()
                },
                $unset: { nextPublishAttemptAt: '' }
            }
        );

        if (updateResult.modifiedCount === 0) {
            log.warn({ postId }, 'Post database update may have failed');
        }

        publishAttempts.push({
            postId,
            restaurantId,
            timestamp: new Date(),
            success: true,
            platform: publishablePost.platform,
            externalPostId: applied.externalPostId ?? undefined
        });

        return true;
    } else {
        const failureClass: PublishFailureClass = result.failureClass ?? (result.retryable ? 'retryable' : 'permanent');
        log.error({ postId, error: result.error, failureClass }, 'Post publish failed');
        trackEvent('post.publish_failed', { postId, error: result.error ?? 'unknown', failureClass, errorCode: result.errorCode ?? 'none' });

        if (failureClass === 'reauth') {
            // Not the post's fault: pause the restaurant and keep the post
            // scheduled without spending an attempt.
            await markRestaurantNeedsReauth(restaurantId, result.error ?? 'Meta rejected the access token');
            trackEvent('integration.meta_reauth_required', { restaurantId, errorCode: result.errorCode ?? 'none' });
            await postsCol.updateOne(
                { _id: postDoc._id },
                { $set: { status: 'SCHEDULED', publishError: REAUTH_PUBLISH_ERROR, updatedAt: new Date() } }
            );
            publishAttempts.push({
                postId, restaurantId, timestamp: new Date(), success: false,
                platform: publishablePost.platform, error: result.error
            });
            return false;
        }

        const willRetry = applied.status === 'SCHEDULED';

        // Ensure database update completes before returning
        const updateResult = await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    status: applied.status,
                    publishError: applied.publishError,
                    updatedAt: new Date(),
                    ...(willRetry ? { nextPublishAttemptAt: nextRetryAt(newAttempts) } : {})
                },
                ...(willRetry ? {} : { $unset: { nextPublishAttemptAt: '' } }),
                $inc: { publishAttempts: 1 }
            }
        );

        if (updateResult.modifiedCount === 0) {
            log.warn({ postId }, 'Post failure status update may have failed');
        }

        if (applied.status === 'MISSED_DEADLINE') {
            log.error({ postId, attempts: newAttempts, failureClass }, 'Post permanently failed');
            await recordPublishFailure({
                postId,
                restaurantId,
                platform: publishablePost.platform,
                failureClass,
                error: applied.publishError ?? 'Unknown publish error',
                errorCode: result.errorCode,
                attempts: newAttempts,
            });
        } else {
            log.info({ postId, attempt: newAttempts, maxAttempts: MAX_PUBLISH_ATTEMPTS }, 'Post will be retried');
        }

        publishAttempts.push({
            postId,
            restaurantId,
            timestamp: new Date(),
            success: false,
            platform: publishablePost.platform,
            error: result.error
        });

        return false;
    }
}

/**
 * Run the publishing job - processes all posts due for publishing.
 */
export async function runPublishingJob(): Promise<{ published: number; failed: number; skipped: number; missed: number; interrupted: number }> {
    log.info('Starting publishing job');

    const stats = { published: 0, failed: 0, skipped: 0, missed: 0, interrupted: 0 };

    try {
        stats.interrupted = await reapStalePublishingPosts();

        // Reap past-due posts first so they move to MISSED_DEADLINE instead of
        // being published late; getPostsDueForPublishing then only returns
        // within-grace posts.
        stats.missed = await reapMissedScheduledPosts();

        const posts = await getPostsDueForPublishing();

        if (posts.length === 0) {
            log.info('No posts due for publishing');
            return stats;
        }

        log.info({ count: posts.length }, 'Found posts due for publishing');

        for (const postDoc of posts) {
            try {
                const success = await processPostForPublishing(postDoc);
                if (success) {
                    stats.published++;
                } else {
                    stats.failed++;
                }
            } catch (error) {
                log.error({ postId: String(postDoc._id), error: String(error) }, 'Unexpected error processing post');
                stats.failed++;
            }

            // Small delay between publishes to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 2000));
        }

        log.info({ published: stats.published, failed: stats.failed, missed: stats.missed }, 'Publishing job completed');
    } catch (error) {
        log.error({ error: String(error) }, 'Publishing job failed');
    }

    return stats;
}

/**
 * Get recent publishing attempts for monitoring.
 */
export function getRecentPublishAttempts(limit: number = 50): PublishAttempt[] {
    return publishAttempts.slice(-limit);
}

/**
 * Start the publishing cron job.
 * Runs every 5 minutes to check for scheduled posts due for publishing.
 */
export function startPublishingCron(): void {
    const job = cron.schedule(CRON_SCHEDULE, async () => {
        try {
            await tracedCronJob('publishing-job', () => runPublishingJob());
        } catch (error) {
            log.error({ err: error }, 'Publishing cron tick failed');
        }
    }, {
        timezone: 'Asia/Kolkata'
    });

    log.info('Cron job scheduled: Every 5 minutes');

    // In development, run initial check after a short delay
    if (process.env.NODE_ENV === 'development') {
        log.info('Development mode: Running initial check in 10 seconds...');
        setTimeout(async () => {
            try {
                await tracedCronJob('publishing-job', () => runPublishingJob());
            } catch (error) {
                log.error({ err: error }, 'Initial publishing check failed');
            }
        }, 10000);
    }
}

/**
 * Manually trigger the publishing job (for admin/testing).
 */
export async function triggerManualPublish(): Promise<{ published: number; failed: number; skipped: number; missed: number; interrupted: number }> {
    log.info('Manual publish triggered');
    return await runPublishingJob();
}
