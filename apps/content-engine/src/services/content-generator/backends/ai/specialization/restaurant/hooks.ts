/**
 * Typed hook template library for restaurant content generation.
 * Consumed by prompts.ts to inject appropriate hook guidance into task prompts.
 * Designed as pure data so Phase 2 can wrap these as Vercel AI SDK tool handlers
 * without changing the data structure.
 *
 * @see psychology.ts (deprecated) -- replaced by this file with richer structure
 */

import type { RestaurantArchetypeId } from './content-patterns.js';

export type HookType =
  | 'UNEXPECTED_FACT'
  | 'CURIOSITY_GAP'
  | 'TRANSFORMATION_REVEAL'
  | 'PROCESS_REVEAL'
  | 'BEHIND_THE_SCENES'
  | 'PATTERN_INTERRUPT'
  | 'SOCIAL_PROOF_OPEN'
  | 'PRICE_ANCHOR'
  | 'FESTIVAL_MOMENT'
  | 'REGIONAL_PRIDE'
  | 'ENGAGEMENT_PROMPT';

export type DemographicSignal =
  | 'family-dining'
  | 'young-urban'
  | 'office-lunch'
  | 'occasion-dining'
  | 'food-enthusiast';

export interface HookTemplate {
  type: HookType;
  /** Instruction for the cold-open (first 0-1.5s of a reel or above-the-fold caption line). */
  captionOpener: string;
  /** For reels: what to show/say in the first 1.5 seconds. */
  reelOpenInstruction: string;
  /** Where the reel should visually or narratively loop back for replay. */
  loopPointDesign: string;
  /** How this hook works without audio (text-on-screen fallback). */
  soundOffStrategy: string;
  fitsByArchetype: RestaurantArchetypeId[];
  fitsByDemographic: DemographicSignal[];
  /** A worked example caption opening (generic restaurant, not tied to a real brand). */
  exampleOpener: string;
  /** When NOT to use this hook. */
  avoidWhen: string;
}

export const HOOK_TEMPLATES: HookTemplate[] = [
  {
    type: 'UNEXPECTED_FACT',
    captionOpener: 'Lead with a genuinely surprising fact about the dish, ingredient, or cuisine that most diners do not know.',
    reelOpenInstruction: 'Open with bold text card: "[Fact]" -- e.g. "This dish takes 8 hours to make." Cut immediately to the dish being plated.',
    loopPointDesign: 'End on the same bold text card, this time with the answer -- creates a satisfying reveal loop.',
    soundOffStrategy: 'Text overlay carries the full fact. Visual is secondary.',
    fitsByArchetype: ['CUISINE_EDUCATION', 'ORIGIN_STORY', 'CHEFS_PICK', 'ANATOMY_OF_A_DISH', 'INGREDIENT_DEEP_DIVE', 'MYTH_BUSTING'],
    fitsByDemographic: ['food-enthusiast', 'young-urban'],
    exampleOpener: 'Most people have never tasted biryani the way it was meant to be eaten -- with the sealed dum crust broken at the table.',
    avoidWhen: 'The fact is too niche or requires insider knowledge. If it needs explanation, it is not a hook.',
  },
  {
    type: 'CURIOSITY_GAP',
    captionOpener: 'Open a question or tension that the rest of the caption (or reel) resolves. Do not answer in the first line.',
    reelOpenInstruction: 'Open with a question text card or a dramatic close-up that does not yet reveal what the dish is. Hold 1.5s before showing.',
    loopPointDesign: 'End just before the resolution -- viewer replays to catch what they missed.',
    soundOffStrategy: 'Question text card works completely without sound.',
    fitsByArchetype: ['CHEFS_PICK', 'BEHIND_THE_SCENES', 'CUISINE_EDUCATION', 'THE_GUESSING_GAME', 'OCCASION_SPOTLIGHT'],
    fitsByDemographic: ['young-urban', 'food-enthusiast', 'occasion-dining'],
    exampleOpener: 'We have been asked to keep this recipe secret for 30 years. Today, we are making an exception.',
    avoidWhen: 'The gap is forced or the answer is obvious from the thumbnail. Never tease something you will not deliver in the caption.',
  },
  {
    type: 'TRANSFORMATION_REVEAL',
    captionOpener: 'Show the before->after journey: raw ingredient to plated dish, empty table to feast, rushed lunch to peaceful meal.',
    reelOpenInstruction: 'Open on the raw/unfinished state (raw meat, unsliced bread, empty pot). Fast-cut to the finished dish. Total under 3 seconds.',
    loopPointDesign: 'Loop back to the raw state -- the contrast is the entertainment.',
    soundOffStrategy: 'The visual contrast is the entire story. Sound is enhancement, not requirement.',
    fitsByArchetype: ['BEHIND_THE_SCENES', 'CHEFS_PICK', 'ORIGIN_STORY', 'CRAVING_CUE', 'TIMELAPSE_STORY'],
    fitsByDemographic: ['food-enthusiast', 'young-urban'],
    exampleOpener: 'From whole spices to dum biryani in 6 hours. Watch what patience looks like.',
    avoidWhen: 'The before state is unappealing enough to put viewers off (raw chicken close-ups, etc.). Keep the before state intriguing, not off-putting.',
  },
  {
    type: 'PROCESS_REVEAL',
    captionOpener: 'Take the viewer inside a step of the cooking or preparation process they have never seen.',
    reelOpenInstruction: 'Open mid-action: rolling pin in motion, tadka sizzle in close-up, hand layering dough. The action should be immediately engaging.',
    loopPointDesign: 'End on the satisfying completion of the action -- sealing a paratha, ladling biryani -- so replay is enjoyable.',
    soundOffStrategy: 'Add text to name the technique. The visual action is primary.',
    fitsByArchetype: ['BEHIND_THE_SCENES', 'CUISINE_EDUCATION', 'CHEFS_PICK', 'RECIPE_REVEAL', 'SOUND_OF_THE_KITCHEN'],
    fitsByDemographic: ['food-enthusiast', 'young-urban', 'office-lunch'],
    exampleOpener: 'The secret is in the tadka. Three spices, one minute, the difference between ordinary and unforgettable.',
    avoidWhen: 'The process looks unhygienic or unsafe on camera. Food safety optics matter more than authenticity here.',
  },
  {
    type: 'BEHIND_THE_SCENES',
    captionOpener: 'Reveal something about the people, the sourcing, or the preparation that customers never see from their table.',
    reelOpenInstruction: 'Open in the kitchen, storage room, or supplier visit -- not the dining room. Immediacy of being "backstage" is the hook.',
    loopPointDesign: 'End on the finished dish arriving at a table -- completing the journey from back to front.',
    soundOffStrategy: 'Text overlay names the "backstage" element -- "Our 4am market run" or "Meet the baker".',
    fitsByArchetype: ['BEHIND_THE_SCENES', 'ORIGIN_STORY', 'STAFF_SPOTLIGHT', 'SUSTAINABILITY', 'SUPPLIER_SHOUTOUT', 'WASTE_NOT'],
    fitsByDemographic: ['food-enthusiast', 'young-urban', 'family-dining'],
    exampleOpener: 'Every morning at 4am, before you arrive for breakfast, this is already happening.',
    avoidWhen: 'The kitchen does not look its best. Always ensure hygiene and cleanliness are visually apparent.',
  },
  {
    type: 'PATTERN_INTERRUPT',
    captionOpener: "Start with something unexpected that breaks the viewer's scroll-pattern: a bold statement, an unexpected visual, or a counter-intuitive claim.",
    reelOpenInstruction: 'First frame must be unusual -- extreme close-up of texture, an unexpected colour, an action happening in reverse. Anything that does not look like a typical food post.',
    loopPointDesign: 'End on the "normal" payoff -- the beautiful dish -- making the loop jarring in a satisfying way.',
    soundOffStrategy: 'The visual interrupt is primary. Text adds context after the viewer has stopped scrolling.',
    fitsByArchetype: ['CHEFS_PICK', 'BEHIND_THE_SCENES', 'SOCIAL_PROOF', 'VIBE_CHECK', 'MEME_CULTURE', 'CHALLENGE_TREND', 'THE_PERFECT_SITUATION', 'THE_REJECTS', 'INSTAGRAMMABLE_MOMENT'],
    fitsByDemographic: ['young-urban'],
    exampleOpener: 'We do not do "fusion". We do something much older than that.',
    avoidWhen: 'The interrupt is confusing to the point where the viewer cannot identify what is being sold. Clarity after 2 seconds is non-negotiable.',
  },
  {
    type: 'SOCIAL_PROOF_OPEN',
    captionOpener: 'Open with what others say, not what the restaurant claims. Specific praise beats generic endorsement.',
    reelOpenInstruction: 'Open on a customer quote (text overlay) or reaction shot. Never open on your own logo or name.',
    loopPointDesign: 'End on the dish that earned the praise -- connecting the emotion to the product.',
    soundOffStrategy: 'Text-on-screen quote carries the full hook.',
    fitsByArchetype: ['SOCIAL_PROOF', 'OFFER_PROMO', 'CUSTOMER_SPOTLIGHT', 'USER_GENERATED_CONTENT', 'AWARDS_RECOGNITION'],
    fitsByDemographic: ['family-dining', 'office-lunch', 'occasion-dining', 'young-urban', 'food-enthusiast'],
    exampleOpener: '"I have eaten biryani in three cities. This is the only one I drive 40 minutes for." -- a regular.',
    avoidWhen: 'The review is generic ("great food, great service"). Specific details are what create believability.',
  },
  {
    type: 'PRICE_ANCHOR',
    captionOpener: 'Make the price feel like a discovery, not a transaction. Anchor it to value, not to cheapness.',
    reelOpenInstruction: 'Open on the dish. Add a text reveal at 1.5s: "Rs. [price]". The visual quality must justify the anchor -- show before you tell.',
    loopPointDesign: 'Loop back to the dish reveal -- reinforces value on replay.',
    soundOffStrategy: 'Text overlay with price is essential. Visual quality does the persuasion work.',
    fitsByArchetype: ['OFFER_PROMO', 'CHEFS_PICK'],
    fitsByDemographic: ['family-dining', 'office-lunch', 'young-urban'],
    exampleOpener: 'A full thali that feeds two, with chai. Rs. 280. And they say good food is expensive.',
    avoidWhen: 'The price is genuinely high for the target demographic. Price anchoring only works when the price creates positive surprise. Do not anchor upward.',
  },
  {
    type: 'FESTIVAL_MOMENT',
    captionOpener: 'Connect the dish to the emotional core of the festival -- not just the name of the festival.',
    reelOpenInstruction: 'Open with the festival atmosphere or a cultural cue (diyas for Diwali, colour for Holi), then reveal the food within 1.5s.',
    loopPointDesign: 'End on the gathering/family moment -- food as occasion, not product.',
    soundOffStrategy: 'Festival name and cultural cue in text overlay. Visual must signal the festival unmistakably.',
    fitsByArchetype: ['FESTIVAL_TIE_IN', 'EVENT_ANNOUNCEMENT'],
    fitsByDemographic: ['family-dining', 'occasion-dining'],
    exampleOpener: 'Diwali does not taste like mithai everywhere. Ours tastes like the way your grandmother made it.',
    avoidWhen: 'The festival has high promotional sensitivity (Shravan, Pitru Paksha, Navratri for non-veg content). Never use festive framing during mourning periods.',
  },
  {
    type: 'REGIONAL_PRIDE',
    captionOpener: 'Invoke pride of place -- the region, the city, the neighbourhood. Makes locals feel seen.',
    reelOpenInstruction: 'Open with a visual cue of the region: skyline, landmark, or a distinctly local ingredient. Follow with the dish.',
    loopPointDesign: 'End on the dish with a regional signifier -- a local landmark photo, a map outline, a regional flag colour.',
    soundOffStrategy: 'Regional reference in text overlay. Works strongly in localised markets.',
    fitsByArchetype: ['CUISINE_EDUCATION', 'ORIGIN_STORY', 'CHEFS_PICK'],
    fitsByDemographic: ['food-enthusiast', 'young-urban', 'family-dining'],
    exampleOpener: 'Hyderabad did not invent biryani. But it perfected it. And we learnt from the best.',
    avoidWhen: 'The restaurant is not genuinely connected to the region being invoked. Regional pride claims must be earned, not borrowed.',
  },
  {
    type: 'ENGAGEMENT_PROMPT',
    captionOpener: 'Open with a direct binary question or choice -- the reader should be unable to resist answering.',
    reelOpenInstruction: 'Open with the question in bold text overlay. The question IS the hook. Show two options side by side if visual.',
    loopPointDesign: 'End on the two options displayed visually -- replaying to re-read the question is natural.',
    soundOffStrategy: 'Text question works entirely without sound. Keep the visual simple and text large.',
    fitsByArchetype: ['COMMUNITY_POLL', 'THIS_OR_THAT'],
    fitsByDemographic: ['young-urban', 'food-enthusiast', 'family-dining'],
    exampleOpener: 'The eternal Sunday debate: masala dosa or idli vada? Pick your side.',
    avoidWhen: 'The question has an obvious correct answer or is not genuinely divisive. Split opinion is the whole mechanism.',
  },
];

export function getHooksByArchetype(archetype: RestaurantArchetypeId): HookTemplate[] {
  return HOOK_TEMPLATES.filter(h => h.fitsByArchetype.includes(archetype));
}

export function getHooksByDemographic(demographic: DemographicSignal): HookTemplate[] {
  return HOOK_TEMPLATES.filter(h => h.fitsByDemographic.includes(demographic));
}

export function getDefaultHook(archetype: RestaurantArchetypeId): HookTemplate {
  return getHooksByArchetype(archetype)[0] ?? HOOK_TEMPLATES[0];
}
