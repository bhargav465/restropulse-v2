import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { getRestaurantsFromDB } from '../lib/db-setup.js';
import { selectFromList, ask, confirm, closePrompts } from '../lib/prompts.js';
import { hr, success, warn } from '../lib/display.js';
import { findAllCycles, createPost } from '@restropulse/db';
import { createContentGenerator, getLastAiMediaGenerator } from '../../../src/services/content-generator/index.js';
import { RESTAURANT_ARCHETYPES } from '../../../src/services/content-generator/backends/ai/specialization/restaurant/content-patterns.js';
import type { PostType, Platform } from '@restropulse/shared';

const POST_TYPES: PostType[] = ['IMAGE', 'CAROUSEL', 'STORY', 'REEL', 'VIDEO'];
const PLATFORMS: Platform[] = ['INSTAGRAM', 'FACEBOOK'];

export async function runPostCommand(): Promise<void> {
  hr('CREATE POST');

  const restaurants = await getRestaurantsFromDB();
  const restaurant = await selectFromList(
    restaurants,
    (r) => `${r.name}  [${r._id}]`,
    'Select a restaurant',
  );

  const cycles = await findAllCycles(restaurant._id);
  let cycleId: string | undefined;
  let selectedCycle: any = null;
  if (cycles.length > 0) {
    const withSkip = [...cycles, { id: 'SKIP', period: 'Ad-hoc (no cycle)', status: '', plannedPosts: [] }] as any[];
    const selected = await selectFromList(
      withSkip,
      (c) => c.id === 'SKIP' ? 'Ad-hoc (no cycle)' : `${c.period}  [${c.status}]`,
      'Select a cycle (or ad-hoc)',
    );
    if (selected.id !== 'SKIP') { cycleId = selected.id; selectedCycle = selected; }
  }

  const dateInput = await ask(`\nScheduled date (YYYY-MM-DD) [default: today]: `);
  const scheduledFor = dateInput.trim() ? new Date(dateInput.trim()).toISOString() : new Date().toISOString();

  // Production path: pick an archetype from the cycle's plan (no concept needed)
  // Ad-hoc path: enter a concept manually
  let concept = '';
  let selectedArchetypeId: string | undefined;

  if (cycleId && selectedCycle?.plannedPosts?.length) {
    const CUSTOM = '__CUSTOM__';
    // Only show archetypes that are known and enabled in the catalog.
    // Freeform/legacy category strings and disabled (input-requiring) archetypes are excluded.
    const enabledIds = (selectedCycle.plannedPosts as Array<{ category: string }>)
      .map(p => p.category)
      .filter(id => RESTAURANT_ARCHETYPES.some(a => a.id === id && a.enabled));

    if (enabledIds.length === 0) {
      console.log('\n  No enabled archetypes in this cycle\'s plan. Falling back to custom concept.');
    }

    const options = [...enabledIds, CUSTOM];
    console.log('\n  Archetypes planned in this cycle:');
    options.forEach((id, i) => {
      if (id === CUSTOM) {
        console.log(`  ${i + 1}) Custom concept (ad-hoc)`);
      } else {
        const arch = RESTAURANT_ARCHETYPES.find(a => a.id === id);
        console.log(`  ${i + 1}) [${id}]  ${arch ? '— ' + arch.description : ''}`);
      }
    });
    while (true) {
      const answer = await ask(`\nSelect (1-${options.length}): `);
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < options.length) {
        if (options[idx] === CUSTOM) {
          const conceptInput = await ask('Concept / prompt (required): ');
          if (!conceptInput.trim()) { console.error('Concept is required.'); closePrompts(); return; }
          concept = conceptInput.trim();
        } else {
          selectedArchetypeId = options[idx];
          const arch = RESTAURANT_ARCHETYPES.find(a => a.id === selectedArchetypeId);
          console.log(`\n  Selected: [${selectedArchetypeId}]${arch ? ' — ' + arch.label : ''}`);
          console.log(`  The archetype promptTemplate drives generation. No concept needed.`);
        }
        break;
      }
      console.log(`  Please enter a number between 1 and ${options.length}`);
    }
  } else {
    const conceptInput = await ask('Concept / prompt (required): ');
    if (!conceptInput.trim()) { console.error('Concept is required.'); closePrompts(); return; }
    concept = conceptInput.trim();
  }

  const postType = await selectFromList(POST_TYPES, t => t, 'Post type') as PostType;

  const platformInput = await ask(`Platforms: INSTAGRAM / FACEBOOK / both [default: INSTAGRAM]: `);
  const platforms: Platform[] = platformInput.trim().toLowerCase() === 'both'
    ? ['INSTAGRAM', 'FACEBOOK']
    : platformInput.trim().toUpperCase() === 'FACEBOOK'
    ? ['FACEBOOK']
    : ['INSTAGRAM'];

  const hasCalendarKey = !!process.env.GOOGLE_CALENDAR_API_KEY || !!process.env.PERPLEXITY_API_KEY;
  let currentAffairsHints: string[] | undefined;
  if (hasCalendarKey) {
    const useCA = await confirm('Use current affairs hints?');
    if (!useCA) currentAffairsHints = [];
  }

  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const backendDefault = hasAnthropicKey ? 'ai' : 'placeholder';
  const backendInput = await ask(`Backend: ai / placeholder [default: ${backendDefault}]: `);
  const backend = (backendInput.trim() || backendDefault) as 'ai' | 'placeholder';

  // Enrich restaurant bio before generation (AI backend only; idempotent).
  if (backend === 'ai' && process.env.ANTHROPIC_API_KEY) {
    if (!restaurant.description) {
      console.log(`\nNo bio found for ${restaurant.name} — generating one...`);
      const { AnthropicLLMProvider } = await import('../../../src/services/content-generator/backends/ai/llm/anthropic-provider.js');
      const { enrichRestaurantBioIfNeeded } = await import('../../../src/services/restaurant-enricher/index.js');
      const llm = new AnthropicLLMProvider({ apiKey: process.env.ANTHROPIC_API_KEY });
      const bio = await enrichRestaurantBioIfNeeded(restaurant, llm);
      if (bio) {
        restaurant.description = bio;
        console.log(`  Bio ready.`);
      }
    } else {
      console.log(`\nRestaurant bio found — using existing.`);
    }
  }

  console.log('\nGenerating post...');
  const gen = await createContentGenerator(backend);
  const post = await gen.generatePost(
    {
      concept,
      type: postType,
      platforms,
      cycleId,
      archetype: selectedArchetypeId,
      themes: selectedArchetypeId ? [selectedArchetypeId] : undefined,
      currentAffairsHints,
    },
    {
      restaurantId: restaurant._id,
      restaurantName: restaurant.name,
      restaurantProfile: {
        cuisine: restaurant.cuisine,
        description: restaurant.description,
        menu: restaurant.menu,
        chefSpecials: restaurant.chefSpecials,
        activeOffers: restaurant.activeOffers,
      },
    },
  );

  hr('RESULT');
  if (selectedArchetypeId) console.log(`\nArchetype: [${selectedArchetypeId}]`);
  if (post.motivation) {
    console.log('\nMotivation:');
    console.log(post.motivation);
  }
  console.log('\nCaption:\n');
  console.log(post.caption);
  if (post.videoUrl) { console.log(`\nVideo URL: ${post.videoUrl}`); }
  else if (post.mediaUrls?.length) {
    console.log(`\nCarousel slides (${post.mediaUrls.length}):`);
    post.mediaUrls.forEach((url, i) => console.log(`  ${i + 1}. ${url}`));
  }
  else if (post.thumbnail) { console.log(`\nThumbnail: ${post.thumbnail}`); }
  if (post.pendingMedia && post.mediaJobId) {
    const mediaGen = getLastAiMediaGenerator();
    if (mediaGen) {
      const shouldPoll = await confirm(`\nVideo job submitted (jobId: ${post.mediaJobId}). Poll until ready?`);
      if (shouldPoll) {
        const POLL_INTERVAL_MS = 5000;
        const MAX_WAIT_MS = 5 * 60 * 1000;
        const started = Date.now();
        let done = false;

        console.log('  Polling every 5s (Ctrl+C to cancel)...');
        while (!done && Date.now() - started < MAX_WAIT_MS) {
          await new Promise<void>(r => setTimeout(r, POLL_INTERVAL_MS));
          const elapsed = Math.round((Date.now() - started) / 1000);

          try {
            const job = await mediaGen.pollJob(post.mediaJobId);
            if (job.status === 'COMPLETED') {
              post.videoUrl = job.mediaUrl;
              post.thumbnail = job.thumbnail ?? job.mediaUrl ?? post.thumbnail;
              post.pendingMedia = false;
              console.log(`  [${elapsed}s] COMPLETED`);
              console.log(`\nVideo URL: ${post.videoUrl}`);
              done = true;
            } else if (job.status === 'FAILED') {
              warn(`  [${elapsed}s] FAILED — ${job.error ?? 'unknown error'}`);
              done = true;
            } else {
              console.log(`  [${elapsed}s] ${job.status} — waiting...`);
            }
          } catch (err) {
            warn(`  [${Math.round((Date.now() - started) / 1000)}s] Poll error: ${(err as Error).message}`);
          }
        }

        if (!done) {
          warn(`  Timed out after 5 minutes. Job ${post.mediaJobId} may still be processing.`);
        }
      } else {
        warn(`Job ${post.mediaJobId} queued — post will save as PENDING_MEDIA.`);
      }
    }
  }

  const save = await confirm('\nSave this post to DB?');
  if (save) {
    const finalStatus = post.pendingMedia ? 'PENDING_MEDIA' : 'PENDING_APPROVAL';
    const saved = await createPost({
      restaurantId: restaurant._id,
      type: postType,
      status: finalStatus,
      platforms,
      caption: post.caption,
      thumbnail: post.thumbnail,
      ...(post.mediaUrls ? { mediaUrls: post.mediaUrls } : {}),
      ...(post.videoUrl ? { videoUrl: post.videoUrl } : {}),
      ...(post.pendingMedia && post.mediaJobId ? { mediaJobId: post.mediaJobId } : {}),
      ...(cycleId ? { cycleId } : {}),
      scheduledFor,
      isAdhoc: !cycleId,
    });
    success(`Post saved: ${saved.id}`);
  }

  closePrompts();
}
