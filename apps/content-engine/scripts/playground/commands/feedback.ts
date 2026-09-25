import { getRestaurantsFromDB } from '../lib/db-setup.js';
import { selectFromList, ask, confirm, multiSelect, closePrompts } from '../lib/prompts.js';
import { hr, success } from '../lib/display.js';
import { findAllPosts, updatePost } from '@restropulse/db';
import { FEEDBACK_CATEGORIES, QUICK_OPTIONS } from '../lib/feedback-options.js';
import { createContentGenerator } from '../../../src/services/content-generator/index.js';
import type { PostType, Platform } from '@restropulse/shared';

export async function runFeedbackCommand(): Promise<void> {
  hr('POST FEEDBACK');

  const restaurants = await getRestaurantsFromDB();
  const restaurant = await selectFromList(
    restaurants,
    (r) => `${r.name}  [${r._id}]`,
    'Select a restaurant',
  );

  const allPosts = await findAllPosts(restaurant._id);
  const reviewable = allPosts
    .filter(p => p.status === 'PENDING_APPROVAL' || p.status === 'CHANGES_REQUESTED')
    .sort((a, b) => new Date(b.scheduledFor ?? 0).getTime() - new Date(a.scheduledFor ?? 0).getTime())
    .slice(0, 10);

  if (reviewable.length === 0) {
    console.log('\nNo posts awaiting review for this restaurant.');
    console.log('Tip: run "npm run playground -- post" to generate one first.');
    closePrompts();
    return;
  }

  const post = await selectFromList(
    reviewable,
    (p) => `[${p.type}] ${p.status}  "${p.caption?.slice(0, 60)}..."`,
    'Select a post',
  );

  const action = await selectFromList(
    ['Approve', 'Request changes'],
    a => a,
    'Action',
  );

  if (action === 'Approve') {
    await updatePost(post.id, {
      status: 'SCHEDULED',
      scheduledFor: post.scheduledFor ?? new Date().toISOString(),
    });
    success('Post approved and scheduled.');
  } else {
    // Request changes -- mirror UI feedback flow
    const category = await selectFromList(
      FEEDBACK_CATEGORIES,
      (c) => `${c.label}  -- ${c.question}`,
      'Feedback category',
    );

    const options = QUICK_OPTIONS[category.id] ?? [];
    const selected = await multiSelect(options, `Select issues (${category.label})`);

    const note = await ask('Additional note (optional): ');

    const feedbackPayload = {
      tags: [category.id],
      details: { [category.id]: selected.join(', ') },
      note: note.trim(),
      resolution: '',
    };

    await updatePost(post.id, {
      status: 'CHANGES_REQUESTED',
      feedback: JSON.stringify(feedbackPayload),
    });
    success('Feedback submitted.');

    const reviseNow = await confirm('Revise now using the content generator?', false);
    if (reviseNow) {
      const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
      const backendDefault = hasAnthropicKey ? 'ai' : 'placeholder';
      const backendInput = await ask(`Backend: ai / placeholder [default: ${backendDefault}]: `);
      const backend = (backendInput.trim() || backendDefault) as 'ai' | 'placeholder';

      const gen = await createContentGenerator(backend);
      const themes = Array.isArray(post.themes) ? post.themes : undefined;
      const archetype = (post as any).archetype ?? themes?.[0];

      console.log('\nRevising post...');
      const revised = await gen.revisePost(
        {
          existingPost: {
            type: post.type as PostType,
            platforms: (post.platforms as Platform[]) || ['INSTAGRAM'],
            caption: post.caption || '',
            themes,
            archetype,
            thumbnail: (post as any).thumbnail,
            mediaUrls: (post as any).mediaUrls ?? undefined,
            videoUrl: (post as any).videoUrl ?? undefined,
          },
          feedback: {
            tags: feedbackPayload.tags,
            details: feedbackPayload.details,
            note: feedbackPayload.note,
          },
        },
        { restaurantId: restaurant._id, restaurantName: restaurant.name },
      );

      hr('REVISED RESULT');
      if (archetype) console.log(`\nArchetype: [${archetype}]`);
      console.log('\nCaption:\n');
      console.log(revised.caption);

      const saveRevised = await confirm('\nSave revised post?');
      if (saveRevised) {
        await updatePost(post.id, {
          status: 'PENDING_APPROVAL',
          caption: revised.caption,
          ...(revised.thumbnail ? { thumbnail: revised.thumbnail } : {}),
          ...(revised.mediaUrls ? { mediaUrls: revised.mediaUrls } : {}),
          ...(revised.videoUrl ? { videoUrl: revised.videoUrl } : {}),
          feedback: JSON.stringify({ ...feedbackPayload, resolution: `Revised via playground: addressed "${feedbackPayload.note}"` }),
        });
        success('Revised post saved and set to PENDING_APPROVAL.');
      }
    }
  }

  closePrompts();
}
