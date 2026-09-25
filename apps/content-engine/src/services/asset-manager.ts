/**
 * Asset Manager
 *
 * Selects placeholder assets from the local media catalog and constructs
 * full HTTP URLs using ASSET_SERVER_BASE_URL. Provides theme-aware random
 * selection with graceful fallback when no themed asset exists.
 *
 * All functions are pure (no side effects) and testable without a running server.
 */

import {
  IMAGE_ASSETS,
  CAROUSEL_SETS,
  VIDEO_ASSETS,
  CAPTION_TEMPLATES,
  type ImageAsset,
  type VideoAsset,
  type CarouselSet,
} from '../assets/media-catalog.js';
import type { MediaConstraints } from './content-validator/media-constraints.js';

// Always use the local asset server URL so Studio can display thumbnails without
// a running ngrok tunnel. The publisher rewrites these to a public URL at
// publish time via ASSET_SERVER_BASE_URL in the publisher/api process.
const BASE_URL = `http://localhost:${process.env.ASSET_SERVER_PORT ?? '3002'}`;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function filterByTheme<T extends { theme: string }>(arr: T[], theme?: string): T[] {
  if (!theme) return arr;
  const matches = arr.filter((a) => a.theme === theme);
  return matches.length > 0 ? matches : arr;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SelectedImage {
  url: string;
  asset: ImageAsset;
}

export interface SelectedVideo {
  videoUrl: string;
  thumbnail: string;
  asset: VideoAsset;
}

export interface SelectedCarousel {
  urls: string[];
  set: CarouselSet;
}

/** Pick a random image, preferring the given theme. Falls back to any image. */
export function getRandomImage(theme?: string): SelectedImage {
  const asset = pickRandom(filterByTheme(IMAGE_ASSETS, theme));
  return {
    url: `${BASE_URL}/images/${asset.filename}`,
    asset,
  };
}

/** Pick a random carousel set, preferring the given theme. Returns array of image URLs. */
export function getRandomCarousel(theme?: string): SelectedCarousel {
  const set = pickRandom(filterByTheme(CAROUSEL_SETS, theme));
  return {
    urls: set.filenames.map((f) => `${BASE_URL}/images/${f}`),
    set,
  };
}

/** Pick a random video, preferring the given theme. Returns video + thumbnail URLs. */
export function getRandomVideo(theme?: string): SelectedVideo {
  const asset = pickRandom(filterByTheme(VIDEO_ASSETS, theme));
  return {
    videoUrl:  `${BASE_URL}/videos/${asset.videoFilename}`,
    thumbnail: `${BASE_URL}/videos/${asset.thumbnailFilename}`,
    asset,
  };
}

/**
 * Pick a random image that satisfies the given constraints.
 * Returns null if no asset passes all constraint checks.
 */
export function getConstraintCompatibleImage(
  constraints: MediaConstraints,
  theme?: string,
): SelectedImage | null {
  const candidates = filterByTheme(IMAGE_ASSETS, theme);
  const compatible = candidates.filter((a) => {
    if (constraints.minWidthPx !== undefined && a.widthPx < constraints.minWidthPx) return false;
    if (constraints.maxWidthPx !== undefined && a.widthPx > constraints.maxWidthPx) return false;
    if (constraints.minHeightPx !== undefined && a.heightPx < constraints.minHeightPx) return false;
    if (constraints.maxHeightPx !== undefined && a.heightPx > constraints.maxHeightPx) return false;
    if (constraints.minAspectRatio !== undefined || constraints.maxAspectRatio !== undefined) {
      const ar = a.widthPx / a.heightPx;
      if (constraints.minAspectRatio !== undefined && ar < constraints.minAspectRatio - 0.001) return false;
      if (constraints.maxAspectRatio !== undefined && ar > constraints.maxAspectRatio + 0.001) return false;
    }
    return true;
  });
  if (compatible.length === 0) return null;
  const asset = pickRandom(compatible);
  return { url: `${BASE_URL}/images/${asset.filename}`, asset };
}

/**
 * Pick a random video that satisfies the given constraints.
 * Returns null if no asset passes all constraint checks.
 */
export function getConstraintCompatibleVideo(
  constraints: MediaConstraints,
  theme?: string,
): SelectedVideo | null {
  const candidates = filterByTheme(VIDEO_ASSETS, theme);
  const compatible = candidates.filter((a) => {
    if (constraints.minWidthPx !== undefined && a.widthPx < constraints.minWidthPx) return false;
    if (constraints.maxWidthPx !== undefined && a.widthPx > constraints.maxWidthPx) return false;
    if (constraints.minHeightPx !== undefined && a.heightPx < constraints.minHeightPx) return false;
    if (constraints.maxHeightPx !== undefined && a.heightPx > constraints.maxHeightPx) return false;
    if (constraints.minAspectRatio !== undefined || constraints.maxAspectRatio !== undefined) {
      const ar = a.widthPx / a.heightPx;
      if (constraints.minAspectRatio !== undefined && ar < constraints.minAspectRatio - 0.001) return false;
      if (constraints.maxAspectRatio !== undefined && ar > constraints.maxAspectRatio + 0.001) return false;
    }
    if (constraints.minDurationSeconds !== undefined && a.durationSeconds < constraints.minDurationSeconds) return false;
    if (constraints.maxDurationSeconds !== undefined && a.durationSeconds > constraints.maxDurationSeconds) return false;
    return true;
  });
  if (compatible.length === 0) return null;
  const asset = pickRandom(compatible);
  return {
    videoUrl:  `${BASE_URL}/videos/${asset.videoFilename}`,
    thumbnail: `${BASE_URL}/videos/${asset.thumbnailFilename}`,
    asset,
  };
}

/**
 * Build a themed caption by picking a random template for the theme,
 * then substituting {restaurant} and {concept} placeholders.
 */
export function buildCaption(concept: string, theme: string, restaurantName?: string): string {
  const templates = CAPTION_TEMPLATES[theme] ?? CAPTION_TEMPLATES['default'];
  const template = pickRandom(templates);
  return template
    .replace('{restaurant}', restaurantName ?? 'our restaurant')
    .replace('{concept}', concept || theme);
}
