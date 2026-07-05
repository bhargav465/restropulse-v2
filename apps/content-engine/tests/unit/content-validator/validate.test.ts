import { describe, it, expect } from 'vitest';
import { validateGeneratedPost } from '../../../src/services/content-validator/validate.js';
import type { GeneratedPost } from '../../../src/services/content-generator/types.js';

// Minimal helper to build a GeneratedPost
function makePost(overrides: Partial<GeneratedPost> = {}): GeneratedPost {
  return {
    caption: 'Test caption',
    thumbnail: 'http://localhost:3002/images/food-01.jpg',
    ...overrides,
  };
}

describe('validateGeneratedPost', () => {
  it('returns empty array when platforms is empty', () => {
    const issues = validateGeneratedPost(makePost(), 'IMAGE', []);
    expect(issues).toHaveLength(0);
  });

  describe('allowedMimeTypes', () => {
    it('PNG thumbnail on INSTAGRAM IMAGE produces allowedMimeTypes error', () => {
      const post = makePost({ thumbnail: 'http://localhost:3002/images/food-01.png' });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      expect(issues).toHaveLength(1);
      expect(issues[0].rule).toBe('allowedMimeTypes');
      expect(issues[0].field).toBe('thumbnail');
      expect(issues[0].severity).toBe('error');
    });

    it('JPEG thumbnail on INSTAGRAM IMAGE passes allowedMimeTypes', () => {
      const post = makePost({ thumbnail: 'http://localhost:3002/images/food-01.jpg' });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const mimeIssues = issues.filter(i => i.rule === 'allowedMimeTypes');
      expect(mimeIssues).toHaveLength(0);
    });

    it('webm videoUrl on INSTAGRAM REEL produces allowedMimeTypes error', () => {
      const post = makePost({
        thumbnail: 'http://localhost:3002/videos/food-video-01-thumb.jpg',
        videoUrl: 'http://localhost:3002/videos/food-video.webm',
      });
      const issues = validateGeneratedPost(post, 'REEL', ['INSTAGRAM']);
      const mimeIssues = issues.filter(i => i.rule === 'allowedMimeTypes');
      expect(mimeIssues).toHaveLength(1);
      expect(mimeIssues[0].field).toBe('videoUrl');
    });

    it('url with unknown extension returns no mime issue', () => {
      // No recognizable extension -> mimeTypeFromUrl returns null -> skip check
      const post = makePost({ thumbnail: 'http://localhost:3002/images/food-01.unknownext' });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const mimeIssues = issues.filter(i => i.rule === 'allowedMimeTypes');
      expect(mimeIssues).toHaveLength(0);
    });
  });

  describe('required videoUrl', () => {
    it('REEL with no videoUrl produces required error', () => {
      const post = makePost();
      const issues = validateGeneratedPost(post, 'REEL', ['INSTAGRAM']);
      const reqIssues = issues.filter(i => i.rule === 'required');
      expect(reqIssues).toHaveLength(1);
      expect(reqIssues[0].field).toBe('videoUrl');
      expect(reqIssues[0].severity).toBe('error');
    });

    it('VIDEO with no videoUrl produces required error', () => {
      const post = makePost();
      const issues = validateGeneratedPost(post, 'VIDEO', ['INSTAGRAM']);
      const reqIssues = issues.filter(i => i.rule === 'required');
      expect(reqIssues).toHaveLength(1);
    });

    it('REEL with videoUrl does not produce required error', () => {
      const post = makePost({
        thumbnail: 'http://localhost:3002/videos/food-video-01-thumb.jpg',
        videoUrl: 'http://localhost:3002/videos/food-video-01.mp4',
      });
      const issues = validateGeneratedPost(post, 'REEL', ['INSTAGRAM']);
      const reqIssues = issues.filter(i => i.rule === 'required');
      expect(reqIssues).toHaveLength(0);
    });
  });

  describe('carousel item count', () => {
    it('CAROUSEL with 1 mediaUrl produces minCarouselItems error', () => {
      const post = makePost({ mediaUrls: ['http://localhost:3002/images/food-01.jpg'] });
      const issues = validateGeneratedPost(post, 'CAROUSEL', ['INSTAGRAM']);
      const countIssues = issues.filter(i => i.rule === 'minCarouselItems');
      expect(countIssues).toHaveLength(1);
      expect(countIssues[0].severity).toBe('error');
    });

    it('CAROUSEL with 11 mediaUrls produces maxCarouselItems error', () => {
      const urls = Array.from({ length: 11 }, (_, i) => `http://localhost:3002/images/food-0${(i % 5) + 1}.jpg`);
      const post = makePost({ thumbnail: urls[0], mediaUrls: urls });
      const issues = validateGeneratedPost(post, 'CAROUSEL', ['INSTAGRAM']);
      const countIssues = issues.filter(i => i.rule === 'maxCarouselItems');
      expect(countIssues).toHaveLength(1);
    });

    it('CAROUSEL with 3 mediaUrls passes count check', () => {
      const urls = [
        'http://localhost:3002/images/food-01.jpg',
        'http://localhost:3002/images/food-02.jpg',
        'http://localhost:3002/images/food-03.jpg',
      ];
      const post = makePost({ thumbnail: urls[0], mediaUrls: urls });
      const issues = validateGeneratedPost(post, 'CAROUSEL', ['INSTAGRAM']);
      const countIssues = issues.filter(i => i.rule === 'minCarouselItems' || i.rule === 'maxCarouselItems');
      expect(countIssues).toHaveLength(0);
    });

    it('CAROUSEL with no mediaUrls produces minCarouselItems error', () => {
      const post = makePost();
      const issues = validateGeneratedPost(post, 'CAROUSEL', ['INSTAGRAM']);
      const countIssues = issues.filter(i => i.rule === 'minCarouselItems');
      expect(countIssues).toHaveLength(1);
    });
  });

  describe('metadata duration checks', () => {
    it('VIDEO with durationSeconds 100 for INSTAGRAM STORY produces maxDurationSeconds error', () => {
      const post = makePost({ mediaMetadata: { durationSeconds: 100 } });
      const issues = validateGeneratedPost(post, 'STORY', ['INSTAGRAM']);
      const durIssues = issues.filter(i => i.rule === 'maxDurationSeconds');
      expect(durIssues).toHaveLength(1);
      expect(durIssues[0].field).toBe('mediaMetadata.durationSeconds');
    });

    it('REEL with durationSeconds 52 for INSTAGRAM does not produce duration error', () => {
      const post = makePost({
        thumbnail: 'http://localhost:3002/videos/food-video-01-thumb.jpg',
        videoUrl: 'http://localhost:3002/videos/food-video-01.mp4',
        mediaMetadata: { durationSeconds: 52 },
      });
      const issues = validateGeneratedPost(post, 'REEL', ['INSTAGRAM']);
      const durIssues = issues.filter(i => i.rule === 'minDurationSeconds' || i.rule === 'maxDurationSeconds');
      expect(durIssues).toHaveLength(0);
    });

    it('VIDEO with durationSeconds 1 produces minDurationSeconds error for INSTAGRAM VIDEO', () => {
      const post = makePost({
        videoUrl: 'http://localhost:3002/videos/food-video-01.mp4',
        mediaMetadata: { durationSeconds: 1 },
      });
      const issues = validateGeneratedPost(post, 'VIDEO', ['INSTAGRAM']);
      const durIssues = issues.filter(i => i.rule === 'minDurationSeconds');
      expect(durIssues).toHaveLength(1);
    });
  });

  describe('metadata dimension checks', () => {
    it('IMAGE with widthPx 800, heightPx 800 for INSTAGRAM IMAGE produces no error', () => {
      const post = makePost({ mediaMetadata: { widthPx: 800, heightPx: 800 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const dimIssues = issues.filter(i => ['minWidthPx', 'maxWidthPx', 'minHeightPx', 'maxHeightPx', 'minAspectRatio', 'maxAspectRatio'].includes(i.rule));
      expect(dimIssues).toHaveLength(0);
    });

    it('IMAGE with widthPx 100, heightPx 100 for INSTAGRAM IMAGE produces minWidthPx error', () => {
      const post = makePost({ mediaMetadata: { widthPx: 100, heightPx: 100 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const dimIssues = issues.filter(i => i.rule === 'minWidthPx');
      expect(dimIssues).toHaveLength(1);
      expect(dimIssues[0].severity).toBe('error');
    });

    it('IMAGE with widthPx 2000 for INSTAGRAM IMAGE produces maxWidthPx error', () => {
      const post = makePost({ mediaMetadata: { widthPx: 2000, heightPx: 800 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const dimIssues = issues.filter(i => i.rule === 'maxWidthPx');
      expect(dimIssues).toHaveLength(1);
    });

    it('IMAGE with very tall aspect ratio (1:5) for INSTAGRAM IMAGE produces minAspectRatio error', () => {
      // AR = 100/500 = 0.2, below min 0.8
      const post = makePost({ mediaMetadata: { widthPx: 100, heightPx: 500 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const arIssues = issues.filter(i => i.rule === 'minAspectRatio');
      expect(arIssues).toHaveLength(1);
    });

    it('IMAGE with very wide aspect ratio (4:1) for INSTAGRAM IMAGE produces maxAspectRatio error', () => {
      // AR = 400/100 = 4.0, above max 1.91
      const post = makePost({ mediaMetadata: { widthPx: 400, heightPx: 100 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const arIssues = issues.filter(i => i.rule === 'maxAspectRatio');
      expect(arIssues).toHaveLength(1);
    });

    it('REEL with height below FB minimum produces minHeightPx error', () => {
      const post = makePost({
        videoUrl: 'http://localhost:3002/videos/food-video-01.mp4',
        mediaMetadata: { widthPx: 540, heightPx: 480 },
      });
      const issues = validateGeneratedPost(post, 'REEL', ['FACEBOOK']);
      const heightIssues = issues.filter(i => i.rule === 'minHeightPx');
      expect(heightIssues).toHaveLength(1);
    });

    it('REEL with height exceeding FB maximum produces maxHeightPx error', () => {
      const post = makePost({
        videoUrl: 'http://localhost:3002/videos/food-video-01.mp4',
        mediaMetadata: { widthPx: 1080, heightPx: 2000 },
      });
      const issues = validateGeneratedPost(post, 'REEL', ['FACEBOOK']);
      const heightIssues = issues.filter(i => i.rule === 'maxHeightPx');
      expect(heightIssues).toHaveLength(1);
    });
  });

  describe('metadata file size check', () => {
    it('file size over 8MB for INSTAGRAM IMAGE produces maxFileSizeBytes error', () => {
      const post = makePost({ mediaMetadata: { fileSizeBytes: 10_000_000 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const sizeIssues = issues.filter(i => i.rule === 'maxFileSizeBytes');
      expect(sizeIssues).toHaveLength(1);
      expect(sizeIssues[0].message).toContain('MB');
    });

    it('file size within limit produces no size error', () => {
      const post = makePost({ mediaMetadata: { fileSizeBytes: 1_000_000 } });
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const sizeIssues = issues.filter(i => i.rule === 'maxFileSizeBytes');
      expect(sizeIssues).toHaveLength(0);
    });
  });

  describe('no metadata', () => {
    it('post without mediaMetadata skips all metadata checks', () => {
      const post = makePost();
      const issues = validateGeneratedPost(post, 'IMAGE', ['INSTAGRAM']);
      const metaIssues = issues.filter(i =>
        i.field.startsWith('mediaMetadata') ||
        ['minWidthPx', 'maxWidthPx', 'minDurationSeconds', 'maxDurationSeconds', 'maxFileSizeBytes'].includes(i.rule)
      );
      expect(metaIssues).toHaveLength(0);
    });
  });
});
