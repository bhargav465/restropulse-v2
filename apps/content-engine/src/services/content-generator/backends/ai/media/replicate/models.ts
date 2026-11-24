export const REPLICATE_MODELS = {
  fluxDev: 'black-forest-labs/flux-dev',
  klingStandard: 'kwaivgi/kling-v1.6-standard',
  /**
   * Alternate video model (A3-1): used from the policy's alternate attempt
   * onward so one model's outage does not stall the video queue. A different
   * vendor from Kling on purpose.
   */
  minimaxVideo01: 'minimax/video-01',
} as const;

export type ReplicateModelSlug = (typeof REPLICATE_MODELS)[keyof typeof REPLICATE_MODELS];

export const PRIMARY_VIDEO_MODEL = REPLICATE_MODELS.klingStandard;
export const ALTERNATE_VIDEO_MODEL = REPLICATE_MODELS.minimaxVideo01;

/**
 * Model-specific prediction input for a video prompt. The two models take
 * different parameters: Kling exposes duration and aspect ratio, MiniMax
 * video-01 takes a prompt (and optimizes it server-side) with a fixed length.
 */
export function buildVideoPredictionInput(modelSlug: string, prompt: string): Record<string, unknown> {
  if (modelSlug === REPLICATE_MODELS.minimaxVideo01) {
    return { prompt, prompt_optimizer: true };
  }
  return { prompt, duration: 5, aspect_ratio: '16:9' };
}
