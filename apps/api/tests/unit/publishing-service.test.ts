import { describe, test, expect, beforeEach } from 'vitest';
import type { Platform } from '@restropulse/shared';

// -- Mock Setup --

const mockPost = vi.fn();
const mockGet = vi.fn();

// Mock axios.create to return our mocked instance
// Also mock direct axios.post and axios.get calls
vi.mock('axios', () => {
    const mockAxiosInstance = {
        post: mockPost,
        get: mockGet,
        defaults: {},
        interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } }
    };

    return {
        __esModule: true,
        default: {
            create: vi.fn(() => mockAxiosInstance),
            // Direct axios calls (used for Facebook and image uploads)
            post: mockPost,
            get: mockGet,
            isAxiosError: (err: any) => err?.isAxiosError === true
        },
        AxiosError: class AxiosError extends Error {
            response: any;
            code: string | undefined;
            isAxiosError = true;
            constructor(message: string, code?: string, _config?: any, _request?: any, response?: any) {
                super(message);
                this.code = code;
                this.response = response;
            }
        }
    };
});

const mockDecrypt = vi.fn();

vi.mock('../../../../packages/publishing/dist/encryption.js', () => ({
    decrypt: mockDecrypt,
    encrypt: vi.fn((val: string) => `encrypted_${val}`),
    generateStateToken: vi.fn(() => 'mock-state-token')
}));

// Import subject after mocks
const { publishToInstagram, publishToFacebook, publishPost } = await import('@restropulse/publishing');

describe('Publishing Service', () => {
    beforeEach(() => {
        // resetAllMocks clears queued mockResolvedValueOnce values too;
        // clearAllMocks only clears call history, not the implementation queue.
        vi.resetAllMocks();
        mockDecrypt.mockReturnValue('decrypted-access-token');
    });

    const mockCredentials = {
        userId: 'ig-user-123',
        pageId: 'page-456',
        accessToken: 'encrypted:token'
    };

    describe('publishToInstagram', () => {
        describe('IMAGE posts', () => {
            const imagePost = {
                id: 'post-1',
                type: 'IMAGE' as const,
                caption: 'Delicious food!',
                thumbnail: 'https://example.com/food.jpg',
                platform: 'INSTAGRAM' as Platform
            };

            it('should publish an image post successfully', async () => {
                // Step 1: Download image for upload to Facebook CDN
                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                // Step 2: Upload to Facebook Page (get CDN URL)
                mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-123' } });
                // Step 3: Get CDN URLs from uploaded photo
                mockGet.mockResolvedValueOnce({
                    data: {
                        images: [{ source: 'https://fbcdn.net/image.jpg' }]
                    }
                });
                // Step 4: Create Instagram container with CDN URL
                mockPost.mockResolvedValueOnce({ data: { id: 'container-789' } });
                // Step 5: Publish container
                mockPost.mockResolvedValueOnce({ data: { id: 'media-999' } });

                const result = await publishToInstagram(imagePost, mockCredentials);

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-999');
                expect(result.retryable).toBe(false);

                // Verify the flow: download -> upload -> get CDN -> create container -> publish
                expect(mockGet).toHaveBeenCalledTimes(2); // download + get CDN URLs
                expect(mockPost).toHaveBeenCalledTimes(3); // upload + create container + publish

                // Verify Instagram container creation used CDN URL
                const containerCall = mockPost.mock.calls.find((call: any) =>
                    call[0]?.includes('/media') && !call[0]?.includes('media_publish')
                );
                expect(containerCall).toBeDefined();
            });

            it('should return error when container creation fails', async () => {
                // Mock successful image download/upload/CDN flow
                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-123' } });
                mockGet.mockResolvedValueOnce({
                    data: { images: [{ source: 'https://fbcdn.net/image.jpg' }] }
                });
                // Then fail on container creation
                mockPost.mockRejectedValueOnce(new Error('API error'));

                const result = await publishToInstagram(imagePost, mockCredentials);

                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            });

            it('should handle no container ID returned', async () => {
                // Mock successful image download/upload/CDN flow
                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-123' } });
                mockGet.mockResolvedValueOnce({
                    data: { images: [{ source: 'https://fbcdn.net/image.jpg' }] }
                });
                // Container creation returns no ID
                mockPost.mockResolvedValueOnce({ data: {} });

                const result = await publishToInstagram(imagePost, mockCredentials);

                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            });
        });

        describe('CAROUSEL posts', () => {
            const carouselPost = {
                id: 'post-2',
                type: 'CAROUSEL' as const,
                caption: 'Multi-photo post!',
                thumbnail: 'https://example.com/img1.jpg',
                mediaUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg', 'https://example.com/img3.jpg'],
                platform: 'INSTAGRAM' as Platform
            };

            it('should publish a carousel post successfully', async () => {
                // For each of 3 images: download -> upload to FB -> get CDN URL
                for (let i = 0; i < 3; i++) {
                    mockGet.mockResolvedValueOnce({
                        data: Buffer.from('fake-image-data'),
                        headers: { 'content-type': 'image/jpeg' }
                    });
                    mockPost.mockResolvedValueOnce({ data: { id: `fb-photo-${i}` } });
                    mockGet.mockResolvedValueOnce({
                        data: { images: [{ source: `https://fbcdn.net/image${i}.jpg` }] }
                    });
                }
                // Create child containers (3 images)
                mockPost.mockResolvedValueOnce({ data: { id: 'child-1' } });
                mockPost.mockResolvedValueOnce({ data: { id: 'child-2' } });
                mockPost.mockResolvedValueOnce({ data: { id: 'child-3' } });
                // Create carousel container
                mockPost.mockResolvedValueOnce({ data: { id: 'carousel-container' } });
                // Publish
                mockPost.mockResolvedValueOnce({ data: { id: 'media-carousel' } });

                const result = await publishToInstagram(carouselPost, mockCredentials);

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-carousel');
            });

            it('should publish carousel with a single item', async () => {
                const singleItemCarousel = {
                    ...carouselPost,
                    mediaUrls: ['https://example.com/img1.jpg']
                };

                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-1' } });
                mockGet.mockResolvedValueOnce({
                    data: { images: [{ source: 'https://fbcdn.net/image1.jpg' }] }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'child-1' } });
                mockPost.mockResolvedValueOnce({ data: { id: 'carousel-container' } });
                mockPost.mockResolvedValueOnce({ data: { id: 'media-carousel' } });

                const result = await publishToInstagram(singleItemCarousel, mockCredentials);

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-carousel');
            });

            it('should reject carousel with more than 10 items', async () => {
                const tooManyItems = {
                    ...carouselPost,
                    mediaUrls: Array.from({ length: 11 }, (_, i) => `https://example.com/img${i}.jpg`)
                };

                const result = await publishToInstagram(tooManyItems, mockCredentials);

                expect(result.success).toBe(false);
                expect(result.errorCode).toBe('INVALID_CAROUSEL');
                expect(result.retryable).toBe(false);
            });
        });

        describe('REEL posts', () => {
            const reelPost = {
                id: 'post-3',
                type: 'REEL' as const,
                caption: 'Check out this reel!',
                thumbnail: 'https://example.com/thumb.jpg',
                videoUrl: 'https://example.com/reel.mp4',
                platform: 'INSTAGRAM' as Platform
            };

            it('should publish a reel successfully', async () => {
                vi.useFakeTimers();

                // Step 1: Create video container
                mockPost.mockResolvedValueOnce({ data: { id: 'reel-container' } });
                // Step 2: Poll status - first IN_PROGRESS, then FINISHED
                mockGet.mockResolvedValueOnce({ data: { status_code: 'IN_PROGRESS' } });
                mockGet.mockResolvedValueOnce({ data: { status_code: 'FINISHED' } });
                // Step 3: Publish
                mockPost.mockResolvedValueOnce({ data: { id: 'media-999' } });

                const resultPromise = publishToInstagram(reelPost, mockCredentials);

                // Advance past the 5-second poll interval to avoid a real timer handle
                await vi.advanceTimersByTimeAsync(5000);

                const result = await resultPromise;

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-999');

                // Verify video container creation
                expect((mockPost.mock.calls[0] as any[])[2].params.video_url).toBe('https://example.com/reel.mp4');
                expect((mockPost.mock.calls[0] as any[])[2].params.media_type).toBe('REELS');

                vi.useRealTimers();
            });

            it('should fallback to image publish when reel has no videoUrl', async () => {
                const noVideoReel = { ...reelPost, videoUrl: undefined };

                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-123' } });
                mockGet.mockResolvedValueOnce({
                    data: { images: [{ source: 'https://fbcdn.net/image.jpg' }] }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'container-789' } });
                mockPost.mockResolvedValueOnce({ data: { id: 'media-999' } });

                const result = await publishToInstagram(noVideoReel, mockCredentials);

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-999');
            });

            it('should fail when video processing errors out', async () => {
                mockPost.mockResolvedValueOnce({ data: { id: 'reel-container' } });
                mockGet.mockResolvedValueOnce({ data: { status_code: 'ERROR' } });

                const result = await publishToInstagram(reelPost, mockCredentials);

                expect(result.success).toBe(false);
                expect(result.error).toBeDefined();
            });
        });

        describe('STORY posts', () => {
            it('should publish an image story successfully', async () => {
                const storyPost = {
                    id: 'post-4',
                    type: 'STORY' as const,
                    caption: '',
                    thumbnail: 'https://example.com/story.jpg',
                    platform: 'INSTAGRAM' as Platform
                };

                // CDN upload flow for story image
                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-story' } });
                mockGet.mockResolvedValueOnce({
                    data: { images: [{ source: 'https://fbcdn.net/story.jpg' }] }
                });
                // Create story container
                mockPost.mockResolvedValueOnce({ data: { id: 'story-container' } });
                // Publish
                mockPost.mockResolvedValueOnce({ data: { id: 'media-story' } });

                const result = await publishToInstagram(storyPost, mockCredentials);

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-story');
            });

            it('should publish a video story successfully', async () => {
                const videoStory = {
                    id: 'post-5',
                    type: 'STORY' as const,
                    caption: '',
                    thumbnail: 'https://example.com/thumb.jpg',
                    videoUrl: 'https://example.com/story.mp4',
                    platform: 'INSTAGRAM' as Platform
                };

                // Create video story container
                mockPost.mockResolvedValueOnce({ data: { id: 'video-story-container' } });
                // Poll status
                mockGet.mockResolvedValueOnce({ data: { status_code: 'FINISHED' } });
                // Publish
                mockPost.mockResolvedValueOnce({ data: { id: 'media-999' } });

                const result = await publishToInstagram(videoStory, mockCredentials);

                expect(result.success).toBe(true);
                expect(result.externalPostId).toBe('media-999');
            });
        });

        describe('VIDEO posts (published as Reels)', () => {
            it('should route VIDEO type to reel handler', async () => {
                const videoPost = {
                    id: 'post-6',
                    type: 'VIDEO' as const,
                    caption: 'Video post',
                    thumbnail: 'https://example.com/thumb.jpg',
                    videoUrl: 'https://example.com/video.mp4',
                    platform: 'INSTAGRAM' as Platform
                };

                mockPost.mockResolvedValueOnce({ data: { id: 'video-container' } });
                mockGet.mockResolvedValueOnce({ data: { status_code: 'FINISHED' } });
                mockPost.mockResolvedValueOnce({ data: { id: 'media-999' } });

                const result = await publishToInstagram(videoPost, mockCredentials);

                expect(result.success).toBe(true);
                expect((mockPost.mock.calls[0] as any[])[2].params.media_type).toBe('REELS');
            });
        });

        describe('Token decryption', () => {
            it('should fail when token decryption fails', async () => {
                mockDecrypt.mockReturnValue(null);

                const post = {
                    id: 'post-7',
                    type: 'IMAGE' as const,
                    caption: 'Test',
                    thumbnail: 'https://example.com/img.jpg',
                    platform: 'INSTAGRAM' as Platform
                };

                const result = await publishToInstagram(post, mockCredentials);

                expect(result.success).toBe(false);
                expect(result.errorCode).toBe('TOKEN_DECRYPT_FAILED');
                expect(result.retryable).toBe(false);
                expect(mockPost).not.toHaveBeenCalled();
            });
        });
    });

    describe('publishPost (platform routing)', () => {
        it('should publish to Instagram only for INSTAGRAM platform', async () => {
            const post = {
                id: 'post-ig',
                type: 'IMAGE' as const,
                caption: 'IG only',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'INSTAGRAM' as Platform
            };

            // CDN upload flow
            mockGet.mockResolvedValueOnce({
                data: Buffer.from('fake-image-data'),
                headers: { 'content-type': 'image/jpeg' }
            });
            mockPost.mockResolvedValueOnce({ data: { id: 'fb-photo-1' } });
            mockGet.mockResolvedValueOnce({
                data: { images: [{ source: 'https://fbcdn.net/img.jpg' }] }
            });
            // Instagram container + publish
            mockPost.mockResolvedValueOnce({ data: { id: 'container-1' } });
            mockPost.mockResolvedValueOnce({ data: { id: 'media-1' } });

            const result = await publishPost(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('media-1');
        });

        it('should publish to Facebook only for FACEBOOK platform', async () => {
            const post = {
                id: 'post-fb',
                type: 'IMAGE' as const,
                caption: 'FB only',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'FACEBOOK' as Platform
            };

            // Facebook image download and upload
            mockGet.mockResolvedValueOnce({
                data: Buffer.from('fake-image-data'),
                headers: { 'content-type': 'image/jpeg' }
            });
            mockPost.mockResolvedValueOnce({ data: { post_id: 'fb-post-1' } });

            const result = await publishPost(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('fb-post-1');
        });
    });

    describe('publishToFacebook', () => {
        it('should publish image to Facebook page', async () => {
            const post = {
                id: 'post-fb-img',
                type: 'IMAGE' as const,
                caption: 'FB image',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'FACEBOOK' as Platform
            };

            // Download image
            mockGet.mockResolvedValueOnce({
                data: Buffer.from('fake-image-data'),
                headers: { 'content-type': 'image/jpeg' }
            });
            // Upload to Facebook
            mockPost.mockResolvedValueOnce({ data: { post_id: 'fb-123' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('fb-123');
        });

        it('should publish carousel with multiple photos to Facebook', async () => {
            const post = {
                id: 'post-fb-carousel',
                type: 'CAROUSEL' as const,
                caption: 'FB carousel',
                thumbnail: 'https://example.com/img1.jpg',
                mediaUrls: ['https://example.com/img1.jpg', 'https://example.com/img2.jpg', 'https://example.com/img3.jpg'],
                platform: 'FACEBOOK' as Platform
            };

            // Download each image and upload as unpublished photo
            for (let i = 0; i < 3; i++) {
                mockGet.mockResolvedValueOnce({
                    data: Buffer.from('fake-image-data'),
                    headers: { 'content-type': 'image/jpeg' }
                });
                mockPost.mockResolvedValueOnce({ data: { id: `photo-${i + 1}` } });
            }
            // Multi-photo feed post
            mockPost.mockResolvedValueOnce({ data: { id: 'feed-post-1' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('feed-post-1');
        });

        it('should publish single-image carousel as regular photo', async () => {
            const post = {
                id: 'post-fb-single-carousel',
                type: 'CAROUSEL' as const,
                caption: 'Single carousel',
                thumbnail: 'https://example.com/img1.jpg',
                mediaUrls: ['https://example.com/img1.jpg'],
                platform: 'FACEBOOK' as Platform
            };

            // Download and upload as regular photo
            mockGet.mockResolvedValueOnce({
                data: Buffer.from('fake-image-data'),
                headers: { 'content-type': 'image/jpeg' }
            });
            mockPost.mockResolvedValueOnce({ data: { post_id: 'fb-single-123' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('fb-single-123');
        });

        it('should publish video to Facebook page', async () => {
            const post = {
                id: 'post-fb-vid',
                type: 'VIDEO' as const,
                caption: 'FB video',
                thumbnail: 'https://example.com/thumb.jpg',
                videoUrl: 'https://example.com/video.mp4',
                platform: 'FACEBOOK' as Platform
            };

            // downloadVideoBuffer: fetch video binary
            mockGet.mockResolvedValueOnce({ data: Buffer.from('fake-video-data'), headers: { 'content-type': 'video/mp4' } });
            // uploadVideoToFacebookPage: binary upload to /videos
            mockPost.mockResolvedValueOnce({ data: { id: 'fb-vid-123' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('fb-vid-123');
            expect(mockPost.mock.calls[0][0]).toBe('https://graph.facebook.com/v18.0/page-456/videos');
        });

        it('should publish reel to Facebook page', async () => {
            const post = {
                id: 'post-fb-reel',
                type: 'REEL' as const,
                caption: 'FB reel',
                thumbnail: 'https://example.com/thumb.jpg',
                videoUrl: 'https://example.com/reel.mp4',  // already public — no rewrite
                platform: 'FACEBOOK' as Platform
            };

            // Phase 1: start upload → returns video_id
            mockPost.mockResolvedValueOnce({ data: { video_id: 'reel-vid-1' } });
            // Phase 2: finish upload
            mockPost.mockResolvedValueOnce({ data: {} });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('reel-vid-1');
            expect(mockPost.mock.calls[0][0]).toBe('/page-456/video_reels');
        });

        it('should fallback reel to image post when videoUrl is missing but thumbnail exists', async () => {
            const post = {
                id: 'post-fb-reel-fallback',
                type: 'REEL' as const,
                caption: 'FB reel fallback',
                thumbnail: 'https://example.com/fallback.jpg',
                platform: 'FACEBOOK' as Platform
            };

            // uploadImageToFacebook: download image
            mockGet.mockResolvedValueOnce({
                data: Buffer.from('fake-image-data'),
                headers: { 'content-type': 'image/jpeg' }
            });
            // uploadImageToFacebook: upload as unpublished photo
            mockPost.mockResolvedValueOnce({ data: { id: 'temp-photo-fallback' } });
            // uploadImageToFacebook: get CDN URL
            mockGet.mockResolvedValueOnce({
                data: { images: [{ source: 'https://cdn.fb.com/fallback.jpg', width: 1080, height: 1080 }] }
            });
            // Final fallback post to photos endpoint
            mockPost.mockResolvedValueOnce({ data: { post_id: 'fb-fallback-1' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('fb-fallback-1');
            expect(mockPost.mock.calls.some((call) => String(call[0]).includes('/photos'))).toBe(true);
        });

        it('should fail when video type has no videoUrl', async () => {
            const post = {
                id: 'post-fb-no-vid',
                type: 'VIDEO' as const,
                caption: 'FB video no url',
                thumbnail: 'https://example.com/thumb.jpg',
                platform: 'FACEBOOK' as Platform
            };

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('MISSING_VIDEO');
        });

        it('should publish photo story to Facebook page', async () => {
            const post = {
                id: 'post-fb-story',
                type: 'STORY' as const,
                caption: '',
                thumbnail: 'https://example.com/story.jpg',
                platform: 'FACEBOOK' as Platform
            };

            // uploadImageToFacebook: download image
            mockGet.mockResolvedValueOnce({
                data: Buffer.from('fake-image-data'),
                headers: { 'content-type': 'image/jpeg' }
            });
            // uploadImageToFacebook: upload as unpublished photo
            mockPost.mockResolvedValueOnce({ data: { id: 'temp-photo-1' } });
            // uploadImageToFacebook: get CDN URL
            mockGet.mockResolvedValueOnce({
                data: { images: [{ source: 'https://cdn.fb.com/story.jpg', width: 1080, height: 1920 }] }
            });
            // Post photo story
            mockPost.mockResolvedValueOnce({ data: { id: 'story-fb-1' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('story-fb-1');
        });

        it('should publish video story to Facebook page', async () => {
            const post = {
                id: 'post-fb-video-story',
                type: 'STORY' as const,
                caption: 'Video story',
                thumbnail: 'https://example.com/story-thumb.jpg',
                videoUrl: 'https://example.com/story.mp4',  // already public — no rewrite
                platform: 'FACEBOOK' as Platform
            };

            // video_stories endpoint: POST with file_url (no binary download needed)
            mockPost.mockResolvedValueOnce({ data: { id: 'story-video-fb-1' } });

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(true);
            expect(result.externalPostId).toBe('story-video-fb-1');
            expect(mockPost.mock.calls[0][0]).toBe('/page-456/video_stories');
        });

        it('should fail when pageId is missing', async () => {
            const post = {
                id: 'post-fb-no-page',
                type: 'IMAGE' as const,
                caption: 'No page',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'FACEBOOK' as Platform
            };

            const noPageCredentials = {
                userId: 'ig-user-123',
                pageId: '',
                accessToken: 'encrypted:token'
            };

            const result = await publishToFacebook(post, noPageCredentials);

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('MISSING_PAGE_ID');
        });

        it('should fail when token decryption fails', async () => {
            mockDecrypt.mockReturnValue(null);

            const post = {
                id: 'post-fb-fail',
                type: 'IMAGE' as const,
                caption: 'Test',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'FACEBOOK' as Platform
            };

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('TOKEN_DECRYPT_FAILED');
        });

        it('should handle API error during Facebook publish', async () => {
            const post = {
                id: 'post-fb-err',
                type: 'IMAGE' as const,
                caption: 'Error test',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'FACEBOOK' as Platform
            };

            // Download fails
            mockGet.mockRejectedValueOnce(new Error('Network error'));

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
        });

        it('should return error for unsupported post type', async () => {
            const post = {
                id: 'post-fb-unknown',
                type: 'UNKNOWN' as any,
                caption: 'Unknown type',
                thumbnail: 'https://example.com/img.jpg',
                platform: 'FACEBOOK' as Platform
            };

            const result = await publishToFacebook(post, mockCredentials);

            expect(result.success).toBe(false);
            expect(result.errorCode).toBe('UNSUPPORTED_TYPE');
        });
    });
});
