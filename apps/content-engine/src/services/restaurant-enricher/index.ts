/**
 * Restaurant bio enricher.
 *
 * Generates a concise prose bio for a restaurant and stores it in
 * restaurant.description. Skips if description is already present (idempotent).
 *
 * Sources:
 *   1. Perplexity Sonar (web search) — when PERPLEXITY_API_KEY is available.
 *      Used to find factual, Google-indexed information about the restaurant.
 *   2. Known structured fields (cuisine, address, chefSpecials, menu) — always
 *      available; used as the ground truth when Sonar returns nothing useful.
 *
 * IMPORTANT: This enricher never invents menu items, history, awards, or facts
 * not explicitly provided. The bio is prose-only; it never writes new dishes
 * into the menu field (that remains a separate data-entry concern).
 *
 * Dish reference images are fetched on-demand during post generation via the
 * SonarClient in PipelineDeps — not here — to avoid bulk pre-fetch throttling.
 */

import { z } from 'zod';
import { updateRestaurant } from '@restropulse/db';
import { createLogger } from '@restropulse/telemetry/server';
import type { Restaurant } from '@restropulse/shared';
import type { ILLMProvider } from '../content-generator/backends/ai/llm/types.js';
import { SonarClient } from '../content-generator/backends/ai/current-affairs/clients/sonar-client.js';

const log = createLogger('restaurant-enricher');

const BioSchema = z.object({
  bio: z
    .string()
    .min(20)
    .max(600)
    .describe(
      'A concise restaurant bio in 3-5 sentences. Cover cuisine style, location, and what makes this restaurant distinctive. Base it ONLY on the provided facts — do not invent history, awards, or menu items not listed.',
    ),
});

function buildKnownFacts(restaurant: Restaurant): string {
  const lines: string[] = [
    `Name: ${restaurant.name}`,
    `Cuisine: ${restaurant.cuisine ?? 'unspecified'}`,
    `Location: ${restaurant.location?.address ?? 'Hyderabad, India'}`,
  ];

  if (restaurant.chefSpecials?.length) {
    lines.push(`Chef specials: ${restaurant.chefSpecials.join(', ')}`);
  }

  if (restaurant.menu?.length) {
    const names = restaurant.menu.slice(0, 10).map(m => m.name);
    lines.push(`Selected menu items: ${names.join(', ')}`);
  }

  if (restaurant.priceRange) {
    lines.push(`Price range: ${restaurant.priceRange}`);
  }

  return lines.join('\n');
}

/**
 * Enrich restaurant.description if absent. Returns the generated bio or null
 * (when description was already present or generation failed gracefully).
 */
export async function enrichRestaurantBioIfNeeded(
  restaurant: Restaurant,
  llm: ILLMProvider,
): Promise<string | null> {
  if (restaurant.description) {
    log.debug({ restaurantId: restaurant.id }, 'Bio already present — skipping enrichment');
    return null;
  }

  const restaurantId = restaurant.id;
  log.info({ restaurantId, name: restaurant.name }, 'Generating restaurant bio');

  // 1. Try Perplexity Sonar for web-grounded facts (optional)
  let webContext = '';
  const perplexityKey = process.env.PERPLEXITY_API_KEY;
  if (perplexityKey) {
    try {
      const sonar = new SonarClient({ apiKey: perplexityKey, model: 'sonar' });
      const addressHint = (restaurant as any).location?.address ?? '';
      const query = `Tell me about the restaurant "${restaurant.name}" in ${addressHint || 'Hyderabad, India'}. What is their cuisine, history, and signature dishes? Provide only factual information found online.`;
      const result = await sonar.query(query);
      webContext = result.text;
      log.debug({ restaurantId }, 'Sonar returned web context for bio generation');
    } catch (err) {
      log.warn({ restaurantId, err }, 'Sonar query failed — using known facts only');
    }
  }

  // 2. Synthesize bio using Claude
  const knownFacts = buildKnownFacts(restaurant);

  const prompt = [
    `Write a short restaurant bio for ${restaurant.name}.`,
    ``,
    `Known facts (authoritative — always use these):`,
    knownFacts,
    webContext
      ? `\nAdditional context from the web (use ONLY verifiable claims; discard anything speculative):\n${webContext.slice(0, 1500)}`
      : '',
    ``,
    `Rules:`,
    `- 3-5 sentences maximum`,
    `- Do NOT invent dishes, history, awards, or facts not mentioned above`,
    `- If the web context contradicts the known facts, trust the known facts`,
    `- Write in a warm, factual tone suitable for a restaurant profile`,
  ].filter(Boolean).join('\n');

  try {
    const { object } = await llm.generateObject({
      model: 'haiku',
      system: 'You are a restaurant writer. Write accurate, concise bios based strictly on provided facts. Never invent information.',
      prompt,
      schema: BioSchema,
      telemetryAttributes: { operation: 'enrichBio', restaurantId },
    });

    // 3. Persist to DB
    await updateRestaurant(restaurantId, { description: object.bio });
    log.info({ restaurantId }, 'Restaurant bio saved');
    return object.bio;
  } catch (err) {
    log.error({ restaurantId, err }, 'Failed to generate restaurant bio — skipping');
    return null;
  }
}

