/**
 * Visual direction fragment for image/video generation prompts.
 * Called from generate-post.ts pipeline; signature must not change.
 *
 * Safe-zone pixel guidance from Instagram's official 2026 Reels spec:
 *   top ~270px (14%), bottom ~385px (20%), left/right ~65px (6%)
 * Grid safe zone (post-3:4 grid update, late 2025): centre 1012 × 1350px.
 */

import type { ImageGenInput, SpecializationContext } from '../types.js';
import { getRegionalAesthetic } from './india-context.js';

/** Per-aspect-ratio safe zone and text placement guidance. */
const SAFE_ZONES: Record<string, string> = {
  '1:1':  'Centre 80% is active area. Outer 10% each side is bleed-safe but not text-safe. Instagram grid (3:4 crop) keeps centre 1012 × 1350px — keep dish and any text inside that zone.',
  '4:5':  'Top 15% and bottom 15% risk platform chrome. Keep subject in middle 70%. Text-safe area: centre 70% vertically.',
  '9:16': 'Top 14% (~270px) = status bar / profile handle risk. Bottom 20–25% (~385–480px) = caption text, audio strip, Like/Comment/Share buttons. Left/right 6% (~65px) = thumb-safe margins. Place hero subject and all text burns inside the central 88% × 65% zone.',
};

function pickAspectRatioGuidance(postType: string): string {
  if (postType === 'REEL' || postType === 'VIDEO') return SAFE_ZONES['9:16'];
  if (postType === 'STORY') return SAFE_ZONES['9:16'];
  if (postType === 'CAROUSEL') return SAFE_ZONES['4:5'];
  return SAFE_ZONES['1:1'];
}

function pickAngle(postType: string): string {
  switch (postType) {
    case 'STORY':
    case 'REEL':
    case 'VIDEO':
      return 'portrait 9:16 framing; centred subject; macro close-up of texture for the first frame; leave bottom 20% completely clear of food';
    case 'CAROUSEL':
      return 'consistent lighting and colour grade across all frames — the slides form a visual set, not isolated images. Each frame has its own subject and composition; the per-slide brief drives what is shown, not this fragment.';
    default:
      return '45-degree angle for plated dishes — shows both surface and depth. AVOID overhead (flat-lay) for biryani, curry, and dal: it erases height and makes the dish look flat. Use overhead only for thali, chaat, or dosa spreads where the spatial layout is the visual point.';
  }
}

export function buildImagePromptFragment(input: ImageGenInput, ctx: SpecializationContext): string {
  const aesthetic = getRegionalAesthetic(ctx.cuisine);
  const safeZone = pickAspectRatioGuidance(input.postType);
  const angle = pickAngle(input.postType);
  const needsCaptionZone = ['REEL', 'VIDEO', 'STORY', 'CAROUSEL'].includes(input.postType);

  return [
    // Block 1 — Base aesthetic
    `Style: appetising food photography for an Indian restaurant. Warm natural lighting (golden-hour quality), honest food — not artificially glossy or over-retouched.`,
    ``,
    // Block 2 — Angle and framing
    `Angle: ${angle}.`,
    ``,
    // Block 3 — Surface, props, and colour palette
    `Surface: ${aesthetic.surface}.`,
    `Props: ${aesthetic.props}.`,
    `Colour palette: ${aesthetic.colours}.`,
    aesthetic.avoidNote ? `Surface note: ${aesthetic.avoidNote}.` : '',
    ``,
    // Block 4 — Aspect-ratio safe zones
    `Safe zone for text overlays: ${safeZone}`,
    needsCaptionZone ? `Caption zone: leave the lower-third free of key subject matter — platform UI overlaps there.` : '',
    ``,
    // Block 5 — Human-in-frame composition
    `If a person appears in frame: position them at a rule-of-thirds intersection, not centre. Their eyeline should face INTO the frame (look room / nose room principle) — leave the side they face toward free for the dish or negative space. Hands and forearms (pouring, tearing, ladling) outperform full-body shots for food engagement — they direct attention to the food without splitting focus on a face. Never shoot a full-face open-mouth mid-chew for branded content; hands or a partial profile are more elegant.`,
    ``,
    // Block 6 — Negative space for text
    `Negative space: leave 30–40% of the frame as intentional negative space on at least one side so caption text or price overlays can sit cleanly without a semi-transparent box obscuring the food.`,
    ``,
    // Block 7 — Deny list
    `Avoid: heavy colour grading that misrepresents food colour; artificial shine or Vaseline-effect gloss; plastic-looking food; stock-photo-style perfect garnish; fingers in frame unless intentional; text or watermarks embedded in the image; flat overhead angle for curries or biryani.`,
  ].filter(Boolean).join('\n');
}
