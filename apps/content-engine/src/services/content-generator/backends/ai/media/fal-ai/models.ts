/**
 * fal.ai model identifiers used by FalAIMediaGenerator.
 *
 * Phase 4: text-to-image (Flux dev) + image-to-image (Flux dev img2img).
 * Phase 5 will add video models alongside these.
 */

export const FAL_MODELS = {
  fluxDev: 'fal-ai/flux/dev',
  fluxImg2Img: 'fal-ai/flux/dev/image-to-image',
  klingVideo: 'fal-ai/kling-video/v1.6/standard/text-to-video',
  minimaxVideo: 'fal-ai/minimax-video/text-to-video',
} as const;

export type FalModelId = (typeof FAL_MODELS)[keyof typeof FAL_MODELS];
