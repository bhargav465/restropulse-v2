/**
 * @deprecated Use hooks.ts instead. This file's exports are unused in the
 * pipeline. Retained for import compatibility only; will be removed in a
 * future major version.
 *
 * Original note: Buyer-psychology hook fragments. Superseded by the richer
 * HookTemplate library in hooks.ts which includes reel guidance, demographic
 * fit, archetype fit, and worked examples.
 */

export const PSYCHOLOGY_HOOKS = {
  SCARCITY: 'Limited servings each evening -- first come, first served.',
  SOCIAL_PROOF: 'Loved by diners who know their {cuisine}.',
  FOMO: 'Available only this week -- back in two months.',
  CURIOSITY: 'Three things even regulars do not know about this dish:',
  AUTHORITY: 'A 40-year-old family recipe, plated as we plate it for our own table.',
} as const;

export type PsychologyHookId = keyof typeof PSYCHOLOGY_HOOKS;
