import type { Platform, PostType } from '@restropulse/shared';

export interface PlatformTactics {
  aspectRatio: string;
  hashtagPosition: 'inline-end' | 'first-comment';
  hashtagCount: { min: number; max: number };
  captionLength: { aboveFoldChars: number; totalChars: number };
}

export function getPlatformTactics(platform: Platform, _postType: PostType): PlatformTactics {
  switch (platform) {
    case 'INSTAGRAM':
      return {
        aspectRatio: '1:1 (feed) / 9:16 (reel/story)',
        hashtagPosition: 'inline-end',
        hashtagCount: { min: 5, max: 8 },
        captionLength: { aboveFoldChars: 125, totalChars: 2200 },
      };
    case 'FACEBOOK':
      return {
        aspectRatio: '4:5 (feed) / 9:16 (reel)',
        hashtagPosition: 'inline-end',
        hashtagCount: { min: 1, max: 3 },
        captionLength: { aboveFoldChars: 250, totalChars: 5000 },
      };
    default:
      return {
        aspectRatio: '1:1',
        hashtagPosition: 'inline-end',
        hashtagCount: { min: 3, max: 8 },
        captionLength: { aboveFoldChars: 125, totalChars: 2200 },
      };
  }
}
