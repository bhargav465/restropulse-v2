import type { Platform, PostType } from '@restropulse/shared';

export interface PlatformTactics {
  /** Clean ratio string usable directly as a media-provider parameter (e.g. '1:1', '9:16', '4:5'). */
  aspectRatio: string;
  /**
   * Practical caption length target, not a platform maximum -- the LLM is
   * prompted to land inside this range. (Instagram/Facebook's actual hard
   * limits are 2200/5000 chars; using those as the prompt target is what
   * produced overlong captions previously.)
   */
  captionLength: { aboveFoldChars: number; minChars: number; maxChars: number };
}

export function getPlatformTactics(platform: Platform, postType: PostType): PlatformTactics {
  const isVertical = postType === 'STORY' || postType === 'REEL' || postType === 'VIDEO';
  switch (platform) {
    case 'INSTAGRAM':
      return {
        aspectRatio: isVertical ? '9:16' : '1:1',
        captionLength: { aboveFoldChars: 125, minChars: 150, maxChars: 400 },
      };
    case 'FACEBOOK':
      return {
        aspectRatio: isVertical ? '9:16' : '4:5',
        captionLength: { aboveFoldChars: 250, minChars: 150, maxChars: 400 },
      };
    default:
      return {
        aspectRatio: isVertical ? '9:16' : '1:1',
        captionLength: { aboveFoldChars: 125, minChars: 150, maxChars: 400 },
      };
  }
}
