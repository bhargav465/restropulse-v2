/**
 * What the public grader returns before unlock. Pure, so the route and its
 * tests share one definition of what the locked response withholds.
 */

import type { GraderResult } from './grader.js';

/** Shown in place of a competitor's name or a search's top result until unlock. */
export const LOCKED_MASK = '••••••';

/**
 * The response a scan returns before unlock. Everything the page blurs is
 * withheld or masked here, so it can't be read from the network response.
 * What stays is what the teaser shows in the clear: score, estimated loss,
 * counts, the first problems, pillar grades, the closest rival line and the
 * first search row. The board keeps its shape (positions, ratings, review
 * counts, which row is you) so the blurred layout still renders.
 */
export function toLockedTeaser(result: GraderResult): GraderResult {
    return {
        ...result,
        problems: result.problems.slice(0, 4),
        leaderboard: result.leaderboard.slice(0, 4).map((row) =>
            row.isYou ? row : { ...row, name: LOCKED_MASK, beatsYou: [] },
        ),
        searches: result.searches.map((s, i) => (i === 0 ? s : { ...s, topResult: LOCKED_MASK })),
        pillars: result.pillars.map((p) => ({ ...p, checks: [] })),
        likelyNew: [],
        unlocked: false,
    };
}
