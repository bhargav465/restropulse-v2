/**
 * Restaurant-domain system + per-operation task prompts.
 *
 * System prompt is a prompt-cache breakpoint — all 5 blocks must be deterministic
 * given ctx. Time-varying data (today's festival, trending topics) stays in the
 * current-affairs pipeline and arrives as current-affairs hints, never here.
 */

import type {
  SpecializationContext,
  SpecializationOperation,
  SpecializationOperationInput,
} from '../types.js';
import type { DraftCycleInput } from '../../../../types.js';
import { getRegionalAesthetic, PRICE_REGISTER_GUIDE, VERNACULAR_POSTURE } from './india-context.js';
import { RESTAURANT_ARCHETYPES, getEnabledArchetypes, getFlagshipArchetypes } from './content-patterns.js';
import { getDefaultHook } from './hooks.js';

export function buildSystemPromptFragment(ctx: SpecializationContext): string {
  const name = ctx.restaurantName ?? 'the restaurant';
  const voice = ctx.brandVoice ?? 'warm and inviting';
  const cuisine = ctx.cuisine ?? 'multi-cuisine';
  const dietary = ctx.dietaryFocus?.length ? ctx.dietaryFocus.join(', ') : 'none specified';
  const region = ctx.region ?? 'India';
  const aesthetic = getRegionalAesthetic(ctx.cuisine);

  // Block 3: price register — derived deterministically from cuisine string
  const cuisineLower = cuisine.toLowerCase();
  const priceReg = cuisineLower.includes('fine') || cuisineLower.includes('premium')
    ? PRICE_REGISTER_GUIDE.premiumSignal
    : cuisineLower.includes('street') || cuisineLower.includes('budget') || cuisineLower.includes('qsr')
    ? PRICE_REGISTER_GUIDE.valueSignal
    : PRICE_REGISTER_GUIDE.midRangeSignal;

  // Vernacular posture — south Indian restaurants get regional-language note
  const isSouthIndian = cuisineLower.includes('south indian') || cuisineLower.includes('andhra')
    || cuisineLower.includes('tamil') || cuisineLower.includes('kerala') || cuisineLower.includes('chettinad')
    || ctx.region?.toLowerCase().includes('south');
  const vernacularNote = isSouthIndian
    ? VERNACULAR_POSTURE.southIndianNote
    : VERNACULAR_POSTURE.rule;

  // Block 5: compact archetype reference (ID + description + default hook type)
  const archetypeTable = getEnabledArchetypes()
    .map(a => `  ${a.id.padEnd(26)} ${a.description} [hook: ${a.defaultHookType}]`)
    .join('\n');

  // Block 6 — Menu data (stable, prompt-cacheable; changes only when restaurant updates menu)
  const dishPool = [
    ...(ctx.menu?.filter(m => m.isAvailable !== false).map(m => m.name) ?? []),
    ...(ctx.chefSpecials ?? []),
  ].filter((v, i, arr) => arr.indexOf(v) === i);  // deduplicate

  return [
    // Block 1 — Restaurant identity
    `You are an expert social media copywriter and creative director for restaurants in India.`,
    `You write content for ${name}, a ${cuisine} restaurant in ${region}.`,
    `Brand voice: ${voice}.`,
    `Dietary focus: ${dietary}.`,
    ctx.bio ? `About this restaurant: ${ctx.bio}` : '',
    ``,
    // Block 2 — Brand compliance (FSSAI + honesty)
    `COMPLIANCE RULES — FSSAI (non-negotiable):`,
    `- Do NOT make health claims. FSSAI prohibits: "cures", "prevents disease", "weight loss", "boosts immunity", "treats illness". Also avoid comparative health language ("healthier than", "better for your gut").`,
    `- Never invent menu items, ingredients, prices, or offers not explicitly provided.`,
    `- No dark patterns or false urgency ("only 2 left!" without evidence).`,
    `- No false comparative pricing claims ("cheaper than X restaurant").`,
    ``,
    // Block 3 — India cultural grounding
    `INDIA MARKET CONTEXT:`,
    `- First 125 characters are above-the-fold on Instagram — hook the reader there.`,
    `- 80-85% of Indian users scroll without sound — every reel hook must work as text overlay alone.`,
    `- Pricing language: ${priceReg}. Avoid: ${PRICE_REGISTER_GUIDE.avoidPhrases.join(', ')}.`,
    `- Vernacular: ${vernacularNote}`,
    `- Visual aesthetic for this cuisine: ${aesthetic.surface} surface; ${aesthetic.colours} palette; props: ${aesthetic.props}.`,
    aesthetic.avoidNote ? `- Visual note: ${aesthetic.avoidNote}.` : '',
    ``,
    // Block 4 — Content philosophy
    `CONTENT PHILOSOPHY:`,
    `- Authenticity over polish. Indian food audiences trust specificity — name the technique, the region, the supplier.`,
    `- Use sensory language: texture, aroma, temperature, sound, colour. Vague praise ("delicious", "amazing") is wasted.`,
    `- Emotional currency: family, nostalgia, pride of place, and origin story outperform product-push in Indian markets.`,
    `- Every caption must make the reader feel something — hunger, nostalgia, pride, or curiosity — before it sells anything.`,
    ``,
    // Block 5 — Archetype reference table
    `CONTENT ARCHETYPES (reference — do not reproduce verbatim):`,
    archetypeTable,
    ``,
    // Block 6 — Menu data (when available)
    ...(dishPool.length > 0 ? [
      `MENU (authoritative — only reference dishes from this list):`,
      dishPool.map(d => `- ${d}`).join('\n'),
    ] : []),
  ].filter(Boolean).join('\n');
}

export function buildTaskPrompt(
  operation: SpecializationOperation,
  input: SpecializationOperationInput,
  ctx: SpecializationContext,
): string {
  const name = ctx.restaurantName ?? 'the restaurant';

  switch (operation) {
    case 'draftCycle': {
      const inp = input as DraftCycleInput;
      const flagshipArchetypes = getFlagshipArchetypes();
      const enabledArchetypes = getEnabledArchetypes();
      const excluded: string[] = (inp as any).excludeArchetypes ?? [];

      return [
        `Draft a content cycle plan for ${name}.`,
        `Period: ${inp.period ?? 'unspecified'}.`,
        `Themes: ${(inp.strategyThemes ?? []).join(', ') || 'use seasonal and regional context'}.`,
        ``,
        `IMPORTANT: This is a PLANNING step only. Do NOT write post captions, briefs, or content.`,
        `You are choosing which archetypes to use and how many posts of each type -- nothing more.`,
        ``,
        `Output fields:`,
        `- summary: 2-3 sentences on the cycle's creative direction and seasonal/contextual rationale.`,
        `- plannedPosts: list of { category: ARCHETYPE_ID, count: number, themes?: string[] } -- the posting plan.`,
        `  themes (optional, max 3): short keywords from ANY current-affairs context that drove this`,
        `  archetype choice. NOT limited to food -- include sports events, entertainment releases,`,
        `  cultural moments (e.g. "Eid", "India-cricket-win", "IPL-final", "Dune-release",`,
        `  "pre-monsoon", "mango-season"). Omit when no specific context applies.`,
        `- focus: 3-6 SHORT thematic keywords or phrases that capture the week's angle`,
        `  (e.g. ["pre-monsoon comfort", "local sourcing", "nostalgia"] -- NOT post briefs, NOT captions).`,
        `- rationale: optional 1-2 sentences explaining non-obvious archetype choices.`,
        ``,
        `Requirements:`,
        ...(flagshipArchetypes.length > 0
          ? [`- Always include at least one post from each flagship archetype: ${flagshipArchetypes.map(a => a.id).join(', ')}.`]
          : []),
        ...(excluded.length > 0
          ? [`- Do NOT use these archetypes: ${excluded.join(', ')}.`]
          : []),
        `- Choose archetypes based on the restaurant's cuisine, the period's season and festivals, and any current-affairs hints.`,
        `- Not every archetype needs to appear -- select what genuinely fits this context.`,
        `- Vary hook types across posts so the week feels diverse, not repetitive.`,
        ``,
        `Available archetypes (ID only -- pick from this list):`,
        enabledArchetypes
          .filter(a => !excluded.includes(a.id))
          .map(a => `  ${a.id}`)
          .join(', '),
      ].filter(Boolean).join('\n');
    }

    case 'reviseCycle':
      return [
        `Revise the supplied cycle while addressing every item in the feedback.`,
        `Keep what worked — change only what the feedback flags.`,
        `Maintain archetype balance: no archetype should repeat more than twice in a 7-day cycle.`,
        `Preserve the overall period and restaurant identity.`,
      ].join('\n');

    case 'generatePost': {
      const inp = input as any;
      const archetypeId: string | undefined = inp.archetype;
      const archetype = archetypeId ? RESTAURANT_ARCHETYPES.find(a => a.id === archetypeId) : undefined;
      const hookEntry = archetype ? getDefaultHook(archetype.id) : null;
      const hasConcept = inp.concept && inp.concept.trim();

      // Build the dish pool from specialization context (populated by toSpecializationContext from restaurantProfile)
      const dishPool = [
        ...(ctx.menu?.filter(m => m.isAvailable !== false).map(m => m.name) ?? []),
        ...(ctx.chefSpecials ?? []),
      ].filter((v, i, arr) => arr.indexOf(v) === i);

      return [
        `Generate a single post for ${name}.`,
        // When concept is empty the archetype promptTemplate IS the brief
        hasConcept
          ? `Concept: ${inp.concept}.`
          : archetype?.promptTemplate
          ? `Brief: ${archetype.promptTemplate}`
          : '',
        `Type: ${inp.type ?? 'IMAGE'}. Platforms: ${(inp.platforms ?? []).join(', ') || 'INSTAGRAM'}.`,
        archetype ? `Archetype: ${archetype.label} — ${archetype.description}.` : '',
        hookEntry ? `Hook guidance: ${hookEntry.captionOpener}` : '',
        hookEntry ? `Example opener style: "${hookEntry.exampleOpener}"` : '',
        ``,
        `Caption requirements:`,
        `- First 125 characters must hook the reader above the fold.`,
        `- Use sensory-first language — name the texture, aroma, temperature.`,
        `- End with 3–8 relevant hashtags on a new line.`,
        archetype?.fssaiSensitive
          ? `FSSAI SENSITIVE: State dietary properties as facts only (e.g. "made with ragi", "100% vegan"). No benefit claims. No comparative health language.`
          : '',
        // Dish constraint (when menu data is available)
        ...(dishPool.length > 0 ? [
          ``,
          `DISH CONSTRAINT: Only reference dishes from the MENU listed in the system prompt. Do not describe or feature any dish not on that menu.`,
          inp.selectedDish
            ? `FEATURED DISH: ${inp.selectedDish} — create this post specifically about this dish. The visual should depict this exact dish.`
            : '',
        ] : []),
        // Carousel-specific slide briefs
        ...(inp.type === 'CAROUSEL' ? [
          ``,
          `CAROUSEL SLIDES: For the carouselSlides field, provide ${inp.selectedDish ? `2-4` : `2-4`} distinct visual briefs describing what each slide should show. Rules:`,
          `- Every slide must feature the same subject${inp.selectedDish ? ` (${inp.selectedDish})` : ``} — continuity comes from a shared subject, not repeated compositions.`,
          `- Each slide shows a DIFFERENT moment, stage, or facet: e.g. raw ingredient close-up → cooking in progress → plated hero shot → diner's hand reaching in.`,
          `- Do NOT describe only camera angles (macro, wide) — describe WHAT IS HAPPENING in that frame.`,
          `- Consistent lighting and colour grade across all slides (the style fragment handles this; don't repeat it).`,
        ] : []),
      ].filter(Boolean).join('\n');
    }

    case 'revisePost': {
      const inp = input as any;
      const archetypeId: string | undefined = inp.existingPost?.archetype || inp.existingPost?.themes?.[0];
      const archetype = archetypeId ? RESTAURANT_ARCHETYPES.find(a => a.id === archetypeId) : undefined;
      const hookEntry = archetype ? getDefaultHook(archetype.id) : null;

      return [
        `Revise the existing post to address every item in the feedback.`,
        archetype
          ? `Archetype to preserve: ${archetype.label} — ${archetype.description}.`
          : `Preserve the original archetype and concept.`,
        hookEntry ? `Hook style to maintain: ${hookEntry.captionOpener}` : '',
        `Modify only what the feedback flags — do not rewrite what is working.`,
        `Maintain the same caption length range and hashtag count.`,
      ].filter(Boolean).join('\n');
    }
  }
}
