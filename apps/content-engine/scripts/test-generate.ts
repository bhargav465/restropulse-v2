/**
 * AI content generation CLI — one-shot test outside the cron worker.
 *
 * Usage:
 *   npm run test:generate                   # show menu
 *   npm run test:generate -- cycle          # draft a content cycle
 *   npm run test:generate -- post           # generate an IMAGE post (default concept)
 *   npm run test:generate -- post reel      # generate a REEL post
 *   npm run test:generate -- post carousel  # generate a CAROUSEL post
 *   npm run test:generate -- post story     # generate a STORY post
 *   npm run test:generate -- adhoc "your custom concept here"
 *   npm run test:generate -- all            # run all scenarios in sequence
 */

import path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { connectDB, disconnectDB } from '@restropulse/db';
import { createContentGenerator } from '../src/services/content-generator/index.js';
import type { PostType } from '@restropulse/shared';

const RESTAURANT_CTX = {
  restaurantId: 'r1',
  restaurantName: 'Spice Garden',
};

const DEFAULT_CONCEPTS: Record<PostType, string> = {
  IMAGE:    'Freshly made dosa with sambar and chutney',
  CAROUSEL: 'Our top 5 signature dishes you must try',
  STORY:    'Behind the scenes: Sunday morning prep',
  REEL:     'Watch our chef make biryani from scratch',
  VIDEO:    'A tour of our open kitchen',
};

const MENU = `
Usage: npm run test:generate -- <command> [options]

Commands:
  cycle                    Draft a 7-day content cycle (Sonnet + current-affairs)
  post [type]              Generate a single post with media
                             types: image (default), reel, carousel, story, video
  adhoc "<concept>"        Generate a post from a custom concept
  all                      Run all scenarios in sequence

Examples:
  npm run test:generate -- cycle
  npm run test:generate -- post reel
  npm run test:generate -- adhoc "Weekend lunch special — 3 courses for 599"
  npm run test:generate -- all
`;

function hr(label: string) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${label}`);
  console.log('─'.repeat(60));
}

async function runCycle() {
  hr('DRAFT CYCLE  (Sonnet + current-affairs injection)');
  const gen = createContentGenerator('ai');
  const cycle = await gen.draftCycle({
    period: 'Week of June 9-15, 2026',
    strategyThemes: ['festive', 'weekend-specials'],
  }, RESTAURANT_CTX);

  console.log('Summary:', cycle.summary);
  console.log('Focus:', cycle.focus?.join(', ') ?? 'n/a');
  console.log('\nPlanned posts:');
  cycle.plannedPosts.forEach((p, i) =>
    console.log(`  ${i + 1}. [${p.category}] x${p.count}`),
  );
}

async function runPost(postType: PostType, concept: string) {
  hr(`GENERATE POST  type=${postType}  (Haiku caption + media)`);
  console.log('Concept:', concept);
  const gen = createContentGenerator('ai');
  const post = await gen.generatePost({
    type: postType,
    platforms: ['INSTAGRAM'],
    concept,
  }, RESTAURANT_CTX);

  console.log('\nCaption:\n');
  console.log(post.caption);

  if (post.mediaUrl) {
    console.log('\nMedia URL:', post.mediaUrl);
  } else if (post.thumbnail) {
    console.log('\nThumbnail:', post.thumbnail);
  } else if (post.mediaJobId) {
    console.log('\nMedia job submitted (async video):');
    console.log('  jobId:', post.mediaJobId);
    console.log('  status: PENDING — poller will advance to PENDING_APPROVAL when done');
    console.log('  check: db.mediaJobs.findOne({ jobId: "' + post.mediaJobId + '" })');
  }
}

const [, , command, ...rest] = process.argv;

if (!command || command === '--help' || command === '-h') {
  console.log(MENU);
  process.exit(0);
}

await connectDB();

try {
  switch (command) {
    case 'cycle':
      await runCycle();
      break;

    case 'post': {
      const typeArg = (rest[0] ?? 'image').toUpperCase() as PostType;
      const postType: PostType = ['IMAGE', 'REEL', 'CAROUSEL', 'STORY', 'VIDEO'].includes(typeArg)
        ? typeArg
        : 'IMAGE';
      await runPost(postType, DEFAULT_CONCEPTS[postType]);
      break;
    }

    case 'adhoc': {
      const concept = rest.join(' ');
      if (!concept) {
        console.error('adhoc requires a concept string.\n  npm run test:generate -- adhoc "your concept"');
        process.exit(1);
      }
      await runPost('IMAGE', concept);
      break;
    }

    case 'all':
      await runCycle();
      await runPost('IMAGE', DEFAULT_CONCEPTS.IMAGE);
      await runPost('CAROUSEL', DEFAULT_CONCEPTS.CAROUSEL);
      await runPost('REEL', DEFAULT_CONCEPTS.REEL);
      break;

    default:
      console.error(`Unknown command: "${command}"\n${MENU}`);
      process.exit(1);
  }
} catch (err) {
  console.error('\nFailed:', (err as Error).message);
  if (process.env.LOG_LEVEL === 'debug') console.error((err as Error).stack);
  process.exit(1);
} finally {
  await disconnectDB();
}
