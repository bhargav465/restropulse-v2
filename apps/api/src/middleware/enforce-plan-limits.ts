import { RequestHandler } from 'express';
import { findActiveSubscription, getWeeklyPostCounts, getDailyAdhocPostCounts } from '@restropulse/db';
import { POST_TYPE_CREDIT_COSTS, PostType, Platform } from '@restropulse/shared';

/**
 * enforcePlanLimits middleware.
 * Checks weekly post counts against per-platform per-post-type plan limits, plus
 * a daily count against per-platform per-post-type dailyAdhoc limits for adhoc posts.
 * If over limit on ANY requested platform (or no active plan), checks credit balance.
 * Sets req.creditCost if credit deduction is needed. Returns 403 if no credits available.
 *
 * Expects req.body.type and req.body.platforms. A post is treated as adhoc when
 * req.body.strategyId is absent, matching how routes/posts.ts sets Post.isAdhoc.
 * Must be used after requireAuth.
 */
export const enforcePlanLimits: RequestHandler = async (req, res, next) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const postType = (req.body.type || 'IMAGE') as PostType;
        const platforms = (req.body.platforms || ['INSTAGRAM']) as Platform[];
        const creditCost = POST_TYPE_CREDIT_COSTS[postType] ?? 1;
        const isAdhoc = !req.body.strategyId;

        const subscription = await findActiveSubscription(restaurantId);

        // No subscription doc at all -- block
        if (!subscription) {
            res.status(403).json({
                success: false,
                error: 'No subscription found. Please subscribe or purchase credits.',
                creditsNeeded: creditCost,
            });
            return;
        }

        const isActive = subscription.status === 'ACTIVE' || subscription.status === 'PAST_DUE';

        if (isActive && subscription.planSnapshot?.limits) {
            const counts = await getWeeklyPostCounts(restaurantId);
            const weeklyLimits = subscription.planSnapshot.limits.weekly;

            // Check if within limits on ALL requested platforms
            let withinLimit = true;
            for (const platform of platforms) {
                const platformLimits = weeklyLimits[platform];
                const limit = platformLimits?.[postType];
                if (limit === undefined) {
                    // No limit defined for this platform/type -- falls to credits
                    withinLimit = false;
                    break;
                }
                const used = counts[platform]?.[postType] ?? 0;
                if (used >= limit) {
                    withinLimit = false;
                    break;
                }
            }

            // Daily adhoc cap is an additional gate on top of the weekly limit above --
            // only applies when the plan defines it and the request is for an adhoc post.
            if (withinLimit && isAdhoc && subscription.planSnapshot.limits.dailyAdhoc) {
                const dailyAdhocLimits = subscription.planSnapshot.limits.dailyAdhoc;
                const dailyCounts = await getDailyAdhocPostCounts(restaurantId);
                for (const platform of platforms) {
                    const limit = dailyAdhocLimits[platform]?.[postType];
                    if (limit === undefined) continue;
                    const used = dailyCounts[platform]?.[postType] ?? 0;
                    if (used >= limit) {
                        withinLimit = false;
                        break;
                    }
                }
            }

            if (withinLimit) {
                next();
                return;
            }
        }

        // Over limit or no active plan -- check credits
        if (subscription.credits >= creditCost) {
            req.creditCost = creditCost;
            next();
            return;
        }

        res.status(403).json({
            success: false,
            error: 'No active subscription or credits. Subscribe to a plan or purchase credits.',
            creditsNeeded: creditCost,
            creditsAvailable: subscription.credits,
        });
    } catch (error) {
        next(error);
    }
};
