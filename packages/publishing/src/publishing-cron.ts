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
import { publishPost, PublishResult } from './publishing-service.js';
import { Post } from '@restropulse/shared';
import { createLogger, tracedCronJob, trackEvent } from '@restropulse/telemetry/server';

const log = createLogger('publishing-cron');

// Constants
const MAX_PUBLISH_ATTEMPTS = 3;
const CRON_SCHEDULE = process.env.CRON_PUBLISHER ?? '*/5 * * * *';

// Track publishing attempts for monitoring
interface PublishAttempt {
    postId: string;
    restaurantId: string;
    timestamp: Date;
    success: boolean;
    platform: string;
    error?: string;
    instagramMediaId?: string;
    facebookPostId?: string;
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

    const posts = await col.find({
        status: 'SCHEDULED',
        scheduledFor: { $lte: now.toISOString() },
        $or: [
            { publishAttempts: { $exists: false } },
            { publishAttempts: { $lt: MAX_PUBLISH_ATTEMPTS } }
        ]
    }).sort({ scheduledFor: 1 }).toArray();

    return posts;
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
            platform: (postDoc.platforms || ['INSTAGRAM']).join(','),
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
        platforms: postDoc.platforms || ['INSTAGRAM']
    };

    const credentials = {
        userId: restaurant.instagramCredentials.userId,
        pageId: restaurant.instagramCredentials.pageId,
        accessToken: restaurant.instagramCredentials.accessToken
    };

    // Publish the post
    const results = await publishPost(publishablePost, credentials);

    // Determine overall success
    const igSuccess = !results.instagram || results.instagram.success;
    const fbSuccess = !results.facebook || results.facebook.success;
    const overallSuccess = igSuccess && fbSuccess;

    // Check if any failures are retryable
    const igRetryable = results.instagram && !results.instagram.success && results.instagram.retryable;
    const fbRetryable = results.facebook && !results.facebook.success && results.facebook.retryable;
    const anyRetryable = igRetryable || fbRetryable;

    const newAttempts = currentAttempts + 1;
    const isFinalAttempt = newAttempts >= MAX_PUBLISH_ATTEMPTS;

    if (overallSuccess) {
        // Success - update post status
        log.info({ postId, platforms: publishablePost.platforms }, 'Post published successfully');
        trackEvent('post.published', { postId, postType: publishablePost.type, platforms: publishablePost.platforms.join(',') });

        // Ensure database update completes before returning
        const updateResult = await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    status: 'POSTED',
                    postedAt: new Date().toISOString(),
                    publishAttempts: newAttempts,
                    publishError: null,
                    instagramMediaId: results.instagram?.instagramMediaId || null,
                    facebookPostId: results.facebook?.facebookPostId || null,
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
            platform: publishablePost.platforms.join(','),
            instagramMediaId: results.instagram?.instagramMediaId,
            facebookPostId: results.facebook?.facebookPostId
        });

        return true;
    } else {
        // Failure
        const errorMessages: string[] = [];
        if (results.instagram && !results.instagram.success) {
            errorMessages.push(`Instagram: ${results.instagram.error}`);
        }
        if (results.facebook && !results.facebook.success) {
            errorMessages.push(`Facebook: ${results.facebook.error}`);
        }
        const combinedError = errorMessages.join('; ');

        log.error({ postId, error: combinedError }, 'Post publish failed');
        trackEvent('post.publish_failed', { postId, error: combinedError });

        // If not retryable or final attempt, mark as MISSED_DEADLINE
        const shouldFail = isFinalAttempt || !anyRetryable;

        // Ensure database update completes before returning
        const updateResult = await postsCol.updateOne(
            { _id: postDoc._id },
            {
                $set: {
                    status: shouldFail ? 'MISSED_DEADLINE' : 'SCHEDULED',
                    publishError: combinedError,
                    updatedAt: new Date()
                },
                $inc: { publishAttempts: 1 }
            }
        );

        if (updateResult.modifiedCount === 0) {
            log.warn({ postId }, 'Post failure status update may have failed');
        }

        if (shouldFail) {
            log.error({ postId, attempts: newAttempts }, 'Post permanently failed after max attempts');
        } else {
            log.info({ postId, attempt: newAttempts, maxAttempts: MAX_PUBLISH_ATTEMPTS }, 'Post will be retried');
        }

        publishAttempts.push({
            postId,
            restaurantId,
            timestamp: new Date(),
            success: false,
            platform: publishablePost.platforms.join(','),
            error: combinedError
        });

        return false;
    }
}

/**
 * Run the publishing job - processes all posts due for publishing.
 */
export async function runPublishingJob(): Promise<{ published: number; failed: number; skipped: number }> {
    log.info('Starting publishing job');

    const stats = { published: 0, failed: 0, skipped: 0 };

    try {
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

        log.info({ published: stats.published, failed: stats.failed }, 'Publishing job completed');
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
        await tracedCronJob('publishing-job', () => runPublishingJob());
    }, {
        timezone: 'Asia/Kolkata'
    });

    log.info('Cron job scheduled: Every 5 minutes');

    // In development, run initial check after a short delay
    if (process.env.NODE_ENV === 'development') {
        log.info('Development mode: Running initial check in 10 seconds...');
        setTimeout(async () => {
            await tracedCronJob('publishing-job', () => runPublishingJob());
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
