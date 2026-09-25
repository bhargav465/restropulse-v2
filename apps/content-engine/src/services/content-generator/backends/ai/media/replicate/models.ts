export const REPLICATE_MODELS = {
  fluxDev: 'black-forest-labs/flux-dev',
  klingStandard: 'kwaivgi/kling-v1.6-standard',
} as const;

export type ReplicateModelSlug = (typeof REPLICATE_MODELS)[keyof typeof REPLICATE_MODELS];
