/**
 * Content generator DI mirroring @restropulse/db's setDB() pattern.
 *
 * Tests inject a stub with setContentGenerator() + resetContentGenerator().
 * Production wiring calls setContentGenerator(new PlaceholderContentGenerator())
 * in worker.ts once during boot.
 */

import { ContentGenerationError, type IContentGenerator } from './types.js';

let activeGenerator: IContentGenerator | null = null;

export function setContentGenerator(generator: IContentGenerator): void {
  activeGenerator = generator;
}

export function getContentGenerator(): IContentGenerator {
  if (!activeGenerator) {
    throw new ContentGenerationError(
      'BACKEND_UNAVAILABLE',
      'No content generator registered. Call setContentGenerator() during boot.',
    );
  }
  return activeGenerator;
}

export function resetContentGenerator(): void {
  activeGenerator = null;
}
