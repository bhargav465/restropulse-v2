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
import { getPostsCollection, getRestaurantsCollection, toApiFormat, toObjectId } from '@restropulse/db';
import { publishPost } from './publishing-service.js';
import { applyPublishResult } from './publish-result.js';
import { POST_PUBLISH_GRACE_HOURS } from '@restropulse/shared';
import { createLogger, tracedCronJob, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('publishing-cron');

// Constants
const MAX_PUBLISH_ATTEMPTS = 3;
const MS_PER_HOUR = 60 * 60 * 1000;
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
        $or: [
            { publishAttempts: { $exists: false } },
            { publishAttempts: { $lt: MAX_PUBLISH_ATTEMPTS } }
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
                }
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
        log.error({ postId, error: result.error }, 'Post publish failed');
        trackEvent('post.publish_failed', { postId, error: result.error ?? 'unknown' });

        // Ensure database update completes before returning
        const updateResult = await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    status: applied.status,
                    publishError: applied.publishError,
                    updatedAt: new Date()
                },
                $inc: { publishAttempts: 1 }
            }
        );

        if (updateResult.modifiedCount === 0) {
            log.warn({ postId }, 'Post failure status update may have failed');
        }

        if (applied.status === 'MISSED_DEADLINE') {
            log.error({ postId, attempts: newAttempts }, 'Post permanently failed after max attempts');
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
export async function runPublishingJob(): Promise<{ published: number; failed: number; skipped: number; missed: number }> {
    log.info('Starting publishing job');

    const stats = { published: 0, failed: 0, skipped: 0, missed: 0 };

    try {
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
export async function triggerManualPublish(): Promise<{ published: number; failed: number; skipped: number }> {
    log.info('Manual publish triggered');
    return await runPublishingJob();
}
