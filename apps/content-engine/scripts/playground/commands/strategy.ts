import path from 'node:path';
import { config } from 'dotenv';
config({ path: path.resolve(process.cwd(), '.env'), override: false });

import { getRestaurantsFromDB } from '../lib/db-setup.js';
import { selectFromList, ask, confirm, closePrompts } from '../lib/prompts.js';
import { hr, success } from '../lib/display.js';
import { createCycle } from '@restropulse/db';
import { createContentGenerator } from '../../../src/services/content-generator/index.js';
import type { PlannedPost } from '@restropulse/shared';

const ARCHETYPE_IDS = [
  'CHEFS_PICK','BEHIND_THE_SCENES','SOCIAL_PROOF','OFFER_PROMO','STAFF_SPOTLIGHT',
  'ORIGIN_STORY','RECIPE_REVEAL','SEASONAL_MENU','ORDER_NOW_CTA','FOOD_PAIRING',
  'CUSTOMER_SPOTLIGHT','USER_GENERATED_CONTENT','SUSTAINABILITY','AWARDS_RECOGNITION',
  'HEALTH_DIETARY_SIGNAL','VIBE_CHECK','EVENT_ANNOUNCEMENT','SOUND_OF_THE_KITCHEN',
  'CRAVING_CUE','SECRET_MENU_UNLOCK','THE_GUESSING_GAME','ANATOMY_OF_A_DISH',
  'SUPPLIER_SHOUTOUT','TIMELAPSE_STORY','WASTE_NOT','THE_REJECTS','FESTIVAL_TIE_IN',
  'CUISINE_EDUCATION','COMMUNITY_POLL','MEME_CULTURE','CHALLENGE_TREND','THIS_OR_THAT',
  'INGREDIENT_DEEP_DIVE','THE_PERFECT_SITUATION','MYTH_BUSTING','OCCASION_SPOTLIGHT',
  'INSTAGRAMMABLE_MOMENT',
];

export async function runStrategyCommand(): Promise<void> {
  hr('CREATE STRATEGY CYCLE');

  const restaurants = await getRestaurantsFromDB();
  const restaurant = await selectFromList(
    restaurants,
    (r) => `${r.name}  [${r._id}]  ${r.cuisine.split(',')[0]}`,
    'Select a restaurant',
  );

  const startDateInput = await ask(`\nCycle start date (YYYY-MM-DD) [default: today]: `);
  const startDate = startDateInput.trim() || new Date().toISOString().split('T')[0];
  const start = new Date(startDate);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  const endDate = end.toISOString().split('T')[0];

  const defaultPeriod = `Week of ${start.toLocaleDateString('en-IN', { month: 'long', day: 'numeric' })}–${end.getDate()}, ${end.getFullYear()}`;
  const periodInput = await ask(`Period label [default: ${defaultPeriod}]: `);
  const period = periodInput.trim() || defaultPeriod;

  const themesInput = await ask(`Focus themes (comma-separated) [optional]: `);
  const themes = themesInput.trim() ? themesInput.split(',').map(t => t.trim()) : [];

  console.log(`\nAvailable archetypes: ${ARCHETYPE_IDS.join(', ')}`);
  const excludeInput = await ask(`Exclude archetypes (comma-separated IDs) [optional]: `);
  const excludeArchetypes = excludeInput.trim()
    ? excludeInput.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : [];

  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const backendDefault = hasAnthropicKey ? 'ai' : 'placeholder';
  const backendInput = await ask(`Backend: ai / placeholder [default: ${backendDefault}]: `);
  const backend = (backendInput.trim() || backendDefault) as 'ai' | 'placeholder';

  console.log('\nDrafting cycle...');
  const gen = await createContentGenerator(backend);
  const cycle = await gen.draftCycle(
    {
      period,
      startDate,
      endDate,
      strategyThemes: themes.length ? themes : undefined,
      excludeArchetypes: excludeArchetypes.length ? excludeArchetypes : undefined,
    },
    { restaurantId: restaurant._id, restaurantName: restaurant.name },
  );

  hr('RESULT');
  console.log(`\nSummary: ${cycle.summary}`);
  console.log(`\nFocus: ${cycle.focus?.join(', ') ?? 'n/a'}`);
  console.log('\nPlanned posts:');
  cycle.plannedPosts.forEach((p: PlannedPost, i: number) => console.log(`  ${i + 1}. [${p.category}] x${p.count}`));

  // Derive and display planned schedule (mirrors rolling-window slot logic)
  const daysBetween = Math.max(1, Math.floor(7 / 5));
  const slotBase = new Date(startDate);
  slotBase.setHours(10, 0, 0, 0);
  let slotIndex = 0;
  const slots: Array<{ category: string; scheduledFor: Date }> = [];
  for (const post of cycle.plannedPosts) {
    for (let j = 0; j < post.count; j++) {
      const d = new Date(slotBase);
      d.setDate(d.getDate() + slotIndex * daysBetween);
      slots.push({ category: post.category, scheduledFor: d });
      slotIndex++;
    }
  }
  if (slots.length) {
    console.log('\nPlanned schedule (postsPerWeek=5, bestTime=10:00 — from ContentStrategy):');
    slots.forEach((s, i) => {
      const datePart = s.scheduledFor.toLocaleDateString('en-IN', { weekday: 'short', month: 'short', day: 'numeric' });
      console.log(`  ${i + 1}. [${s.category}]  ${datePart}  10:00 AM`);
    });
  }

  const save = await confirm('\nSave this cycle to DB?');
  if (save) {
    const saved = await createCycle({
      restaurantId: restaurant._id,
      period,
      startDate,
      endDate,
      status: 'PENDING_APPROVAL',
      summary: cycle.summary,
      plannedPosts: cycle.plannedPosts,
      focus: cycle.focus ?? [],
    });
    success(`Cycle saved: ${saved.id}`);
  }

  closePrompts();
}
