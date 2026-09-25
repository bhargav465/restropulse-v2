import { RequestHandler } from 'express';
import { findActiveSubscription, findRestaurantById, getWeeklyPostCounts, getDailyAdhocPostCounts, getDailyAdhocGroupCount } from '@restropulse/db';
import { POST_TYPE_CREDIT_COSTS, PostType, Platform, DEFAULT_DAILY_ADHOC_POST_LIMIT } from '@restropulse/shared';
import { getEntitlement } from '../lib/entitlement.js';

/**
 * enforcePlanLimits middleware (Content Engine gate).
 *
 * Access model:
 *  - Not entitled (no active plan and trial ended / never started) -> 403 UPGRADE_REQUIRED.
 *  - Entitled (trial or paid) -> restaurant-level daily cap on adhoc post
 *    creation requests (DEFAULT_DAILY_ADHOC_POST_LIMIT unless overridden on the
 *    restaurant doc) -> 403 DAILY_ADHOC_LIMIT_REACHED when hit.
 *  - In free trial -> otherwise full access (plan/credit limits bypassed).
 *  - Active paid plan -> per-platform per-post-type weekly limits, plus a
 *    plan-tier dailyAdhoc cap for adhoc posts; over-limit falls back to
 *    purchased credit packs.
 *
 * Sets req.creditCost when a credit-pack deduction is needed. Expects req.body.type
 * and req.body.platforms. A post is adhoc when req.body.cycleId is absent --
 * matches the isAdhoc value routes/posts.ts persists on the Post document.
 * Must be used after requireAuth.
 */
export const enforcePlanLimits: RequestHandler = async (req, res, next) => {
    try {
        const restaurantId = req.user!.restaurantId;
        const postType = (req.body.type || 'IMAGE') as PostType;
        const platforms = (req.body.platforms || ['INSTAGRAM']) as Platform[];
        const creditCost = POST_TYPE_CREDIT_COSTS[postType] ?? 1;
        const isAdhoc = !req.body.cycleId;

        const subscription = await findActiveSubscription(restaurantId);
        const entitlement = getEntitlement(subscription);

        // Neither trialing nor subscribed -- feature is locked.
        if (!entitlement.entitled) {
            res.status(403).json({
                success: false,
                error: 'Your free trial has ended. Subscribe to a plan to keep creating content.',
                code: 'UPGRADE_REQUIRED',
                creditsNeeded: creditCost,
            });
            return;
        }

        // Restaurant-level daily cap on adhoc post creation requests. Applies to
        // every entitled restaurant regardless of plan tier -- one "create post"
        // action (one groupId, however many platforms it targets) counts once.
        // Checked before the trial bypass below so trial restaurants are capped too.
        if (isAdhoc) {
            const restaurant = await findRestaurantById(restaurantId);
            const dailyLimit = restaurant?.dailyAdhocPostLimit ?? DEFAULT_DAILY_ADHOC_POST_LIMIT;
            const usedToday = await getDailyAdhocGroupCount(restaurantId);
            if (usedToday >= dailyLimit) {
                res.status(403).json({
                    success: false,
                    error: `You've reached today's limit of ${dailyLimit} posts. Try again tomorrow.`,
                    code: 'DAILY_ADHOC_LIMIT_REACHED',
                    limit: dailyLimit,
                    used: usedToday,
                });
                return;
            }
        }

        // Free trial grants full access -- no further plan/credit limits.
        if (entitlement.inTrial) {
            next();
            return;
        }

        // Active paid plan (entitled and not trialing implies a non-null active sub).
        const sub = subscription!;

        // Enforce plan limits, fall back to purchased credit packs.
        if (sub.planSnapshot?.limits) {
            const counts = await getWeeklyPostCounts(restaurantId);
            const weeklyLimits = sub.planSnapshot.limits.weekly;

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
            if (withinLimit && isAdhoc && sub.planSnapshot.limits.dailyAdhoc) {
                const dailyAdhocLimits = sub.planSnapshot.limits.dailyAdhoc;
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

        // Over the plan limit -- fall back to purchased credit packs.
        if (sub.credits >= creditCost) {
            req.creditCost = creditCost;
            next();
            return;
        }

        res.status(403).json({
            success: false,
            error: 'You have hit your plan limit. Purchase credits or upgrade your plan.',
            creditsNeeded: creditCost,
            creditsAvailable: sub.credits,
        });
    } catch (error) {
        next(error);
    }
};
