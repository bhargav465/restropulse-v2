/**
 * Publishing Service
 * Handles publishing posts to Instagram and Facebook via the Meta Graph API.
 * Supports IMAGE, CAROUSEL, REEL, STORY, and VIDEO post types.
 *
 * Instagram Content Publishing API flow:
 *   1. Create a media container (POST /{ig-user-id}/media)
 *   2. For video types: poll container status until FINISHED
 *   3. Publish the container (POST /{ig-user-id}/media_publish)
 *
 * Facebook Page Publishing API flow:
 *   - IMAGE: POST /{page-id}/photos (binary upload)
 *   - CAROUSEL: Upload unpublished photos, then POST /{page-id}/feed with attached_media
 *   - REEL: Two-phase upload via /{page-id}/video_reels
 *   - STORY: POST /{page-id}/photo_stories or /{page-id}/video_stories
 *   - VIDEO: POST /{page-id}/videos
 *
 * Platform routing is controlled by the post's `platform` field ('INSTAGRAM' or 'FACEBOOK').
 * A post targeting both platforms is represented as two separate Post documents upstream.
 *
 * See: https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing
 * See: https://developers.facebook.com/docs/pages-api/posts
 * See: https://developers.facebook.com/docs/video-api/guides/reels-publishing
 */

import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import { decrypt } from './encryption.js';
import { createLogger } from '@restropulse/telemetry/server';

const log = createLogger('publishing-service');

// API Configuration
const META_GRAPH_API = 'https://graph.facebook.com/v18.0';
const API_TIMEOUT_MS = 60000; // 60 seconds for media uploads
const VIDEO_POLL_INTERVAL_MS = 5000; // 5 seconds between status checks
const VIDEO_POLL_MAX_ATTEMPTS = 60; // 5 minutes max wait for video processing

// Create axios instance
const metaApi = axios.create({
    baseURL: META_GRAPH_API,
    timeout: API_TIMEOUT_MS
});

// -- Media Upload Helpers --

/**
 * Download an image from any URL (following redirects) and upload it to
 * Facebook Page storage as an unpublished photo.
 * Returns a Facebook CDN URL that Instagram's API can reliably fetch.
 *
 * This avoids issues with:
 *   - Redirect URLs (e.g. picsum.photos)
 *   - URLs without image file extensions
 *   - Slow or unreliable origin servers
 *
 * Flow:
 *   1. Download image binary from the source URL (follows redirects)
 *   2. POST /{page-id}/photos?published=false with binary source
 *   3. GET /{photo-id}?fields=images to retrieve CDN URLs
 *   4. Return the largest CDN image URL
 */
async function uploadImageToFacebook(
    imageUrl: string,
    pageId: string,
    accessToken: string
): Promise<string> {
    log.info({ imageUrl }, 'Uploading image to Facebook CDN');

    // Step 1: Download the image (following all redirects)
    const downloadResponse = await axios.get(imageUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 10,
        timeout: 30000,
        headers: { 'Accept': 'image/*' }
    });

    const imageBuffer = Buffer.from(downloadResponse.data);
    const contentType = downloadResponse.headers['content-type'] || 'image/jpeg';
    const fileSize = imageBuffer.length;

    log.info({ fileSize, contentType }, 'Downloaded image');

    // Determine file extension from content type
    const extMap: Record<string, string> = {
        'image/jpeg': 'jpg',
        'image/jpg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp'
    };
    const ext = extMap[contentType] || 'jpg';

    // Step 2: Upload to Facebook Page as an unpublished photo
    const formData = new FormData();
    formData.append('source', imageBuffer, {
        filename: `post_image.${ext}`,
        contentType: contentType
    });
    formData.append('published', 'false');
    formData.append('temporary', 'true'); // Mark as temporary so it auto-deletes
    formData.append('access_token', accessToken);

    const uploadResponse = await axios.post(
        `${META_GRAPH_API}/${pageId}/photos`,
        formData,
        {
            headers: formData.getHeaders(),
            timeout: API_TIMEOUT_MS,
            maxContentLength: 50 * 1024 * 1024 // 50 MB max
        }
    );

    const photoId = uploadResponse.data.id;
    if (!photoId) {
        throw new Error('No photo ID returned from Facebook upload');
    }

    log.info({ photoId }, 'Uploaded to Facebook as unpublished photo');

    // Step 3: Get the CDN URL from the uploaded photo
    const photoDetails = await metaApi.get(`/${photoId}`, {
        params: {
            fields: 'images',
            access_token: accessToken
        }
    });

    const images = photoDetails.data.images || [];
    if (images.length === 0) {
        throw new Error('No image URLs returned from Facebook CDN');
    }

    // Sort by size (largest first) and return the biggest
    images.sort((a: any, b: any) => (b.width * b.height) - (a.width * a.height));
    const cdnUrl = images[0].source;

    log.info('Facebook CDN URL ready');
    return cdnUrl;
}

/**
 * Upload an image to Facebook CDN, then return the CDN URL.
 * Errors are NOT silently swallowed -- they propagate to the caller
 * so that the publish attempt fails with a clear diagnostic message
 * instead of silently falling back to a broken redirect URL.
 */
async function getPublishableImageUrl(
    imageUrl: string,
    pageId: string,
    accessToken: string
): Promise<string> {
    // The publisher downloads the image binary locally then uploads it to
    // Facebook CDN. Instagram only ever sees the Facebook CDN URL — it never
    // fetches from the original URL. So localhost:3002 always works here
    // regardless of whether an ngrok tunnel is running.
    log.info({ imageUrl }, 'getPublishableImageUrl called');
    const cdnUrl = await uploadImageToFacebook(imageUrl, pageId, accessToken);
    log.info('getPublishableImageUrl success');
    return cdnUrl;
}

/**
 * Download video binary from any URL accessible to the publisher process.
 * Works with localhost since publisher and asset server share the same machine.
 */
async function downloadVideoBuffer(videoUrl: string): Promise<{ buffer: Buffer; contentType: string }> {
    log.info({ videoUrl }, 'Downloading video binary');
    const response = await axios.get(videoUrl, {
        responseType: 'arraybuffer',
        maxRedirects: 5,
        timeout: 120_000,
        headers: { Accept: 'video/*,*/*' },
    });
    return {
        buffer: Buffer.from(response.data),
        contentType: response.headers['content-type'] || 'video/mp4',
    };
}

/**
 * Upload a video to Instagram using the resumable upload API.
 * No public URL required — the publisher uploads binary directly to Meta.
 * Returns the Instagram container ID (pass to waitForContainerReady then media_publish).
 */
async function uploadVideoToInstagram(
    videoUrl: string,
    igUserId: string,
    accessToken: string,
    caption: string,
    mediaType: 'REELS' | 'STORIES',
): Promise<string> {
    const { buffer, contentType } = await downloadVideoBuffer(videoUrl);
    const fileSize = buffer.length;
    log.info({ fileSize, contentType, mediaType }, 'Starting Instagram resumable video upload');

    // Step 1: Initialize upload session
    const initParams: Record<string, string> = {
        media_type: mediaType,
        upload_type: 'resumable',
        access_token: accessToken,
    };
    if (mediaType === 'REELS' && caption) initParams.caption = caption;

    const initResponse = await metaApi.post(`/${igUserId}/media`, null, { params: initParams });
    const containerId: string = initResponse.data.id;
    const uploadUri: string = initResponse.data.uri;
    if (!containerId || !uploadUri) {
        throw new Error('Instagram resumable upload init returned no container ID or upload URI');
    }

    log.info({ containerId }, 'Instagram upload session created, uploading binary');

    // Step 2: Upload binary to the session URI
    await axios.put(uploadUri, buffer, {
        headers: {
            Authorization: `OAuth ${accessToken}`,
            'Content-Type': contentType,
            file_size: String(fileSize),
            offset: '0',
        },
        timeout: 120_000,
        maxContentLength: 100 * 1024 * 1024,
    });

    log.info({ containerId }, 'Instagram video binary upload complete');
    return containerId;
}

/**
 * Upload a video binary to a Facebook Page using multipart form upload.
 * Returns the Facebook video ID.
 */
async function uploadVideoToFacebookPage(
    videoUrl: string,
    pageId: string,
    accessToken: string,
    caption: string,
    published = true,
): Promise<string> {
    const { buffer, contentType } = await downloadVideoBuffer(videoUrl);
    log.info({ fileSize: buffer.length, contentType, published }, 'Uploading video binary to Facebook');

    const formData = new FormData();
    formData.append('source', buffer, { filename: 'video.mp4', contentType });
    formData.append('published', published ? 'true' : 'false');
    formData.append('description', caption);
    formData.append('access_token', accessToken);

    const response = await axios.post(
        `${META_GRAPH_API}/${pageId}/videos`,
        formData,
        {
            headers: formData.getHeaders(),
            timeout: 120_000,
            maxContentLength: 100 * 1024 * 1024,
        },
    );

    const videoId: string = response.data.id || response.data.video_id;
    if (!videoId) throw new Error('No video ID returned from Facebook binary video upload');
    log.info({ videoId }, 'Facebook video binary upload complete');
    return videoId;
}

/**
 * Resolve a video URL for use as Instagram's `video_url` parameter.
 *
 * Instagram needs a direct downloadable MP4, not a streaming URL.
 * In local dev, `post.videoUrl` is `http://localhost:PORT/videos/...`.
 * We rewrite it to the public ngrok URL via ASSET_SERVER_BASE_URL so
 * Instagram's CDN can fetch it directly — same approach as the API proxy.
 *
 * In staging/production, `post.videoUrl` is already a public HTTPS URL
 * so no rewrite is needed.
 */
function resolvePublicVideoUrl(videoUrl: string): string {
    const assetBaseUrl = process.env.ASSET_SERVER_BASE_URL;
    if (videoUrl.startsWith('http://localhost:') && assetBaseUrl) {
        try {
            const src = new URL(videoUrl);
            // Use the FULL base URL (not just origin) to preserve path prefix like /dev-assets
            const base = assetBaseUrl.replace(/\/$/, '');
            const rewritten = base + src.pathname + src.search;
            log.info({ original: videoUrl, rewritten }, 'Rewriting localhost video URL to public URL for Instagram');
            return rewritten;
        } catch {
            // fall through on parse error
        }
    }
    return videoUrl;
}

// -- Types --

export interface PublishablePost {
    id: string;
    type: 'IMAGE' | 'VIDEO' | 'CAROUSEL' | 'STORY' | 'REEL';
    caption: string;
    thumbnail: string;
    mediaUrls?: string[];
    videoUrl?: string;
    platform: 'INSTAGRAM' | 'FACEBOOK';
}

export interface InstagramCredentialsForPublishing {
    userId: string;       // Instagram User ID
    pageId: string;       // Facebook Page ID
    accessToken: string;  // Encrypted access token
}

export interface PublishResult {
    success: boolean;
    externalPostId?: string;
    error?: string;
    errorCode?: string;
    retryable: boolean;
}

interface ContainerStatusResult {
    ready: boolean;
    statusCode: string;
    error?: string;
}

// -- Error Helpers --

interface ParsedPublishError {
    message: string;
    code: string | null;
    subcode: string | null;
    fbtraceId: string | null;
    retryable: boolean;
}

function parsePublishError(error: unknown): ParsedPublishError {
    if (error instanceof AxiosError) {
        if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
            return { message: 'Request timed out', code: 'TIMEOUT', subcode: null, fbtraceId: null, retryable: true };
        }

        const metaError = error.response?.data?.error;
        if (metaError) {
            // Rate limit codes: 4 (app-level), 17 (user-level), 32 (page-level)
            const isRateLimit = [4, 17, 32].includes(metaError.code);
            // Transient errors flagged by Meta
            const isTransient = metaError.is_transient === true;
            // Media upload failures (2207xxx) can be caused by a temporarily
            // unreachable media URL (e.g. ngrok tunnel down). Always retry these
            // so a transient tunnel outage doesn't permanently fail the post.
            const isMediaUploadFailure = String(metaError.code ?? '').startsWith('2207');
            return {
                message: metaError.message || 'Unknown Meta API error',
                code: String(metaError.code),
                subcode: metaError.error_subcode != null ? String(metaError.error_subcode) : null,
                fbtraceId: metaError.fbtrace_id ?? null,
                retryable: isRateLimit || isTransient || isMediaUploadFailure
            };
        }

        return {
            message: error.message,
            code: error.response?.status ? String(error.response.status) : null,
            subcode: null,
            fbtraceId: null,
            retryable: error.response?.status === 429 || (error.response?.status ?? 0) >= 500
        };
    }

    return { message: String(error), code: null, subcode: null, fbtraceId: null, retryable: false };
}

// -- Container Creation --

/**
 * Create an image media container on Instagram.
 */
async function createImageContainer(
    igUserId: string,
    accessToken: string,
    imageUrl: string,
    caption: string,
    isCarouselItem: boolean = false
): Promise<string> {
    const params: Record<string, string | boolean> = {
        image_url: imageUrl,
        access_token: accessToken
    };

    if (isCarouselItem) {
        params.is_carousel_item = true;
    } else {
        params.caption = caption;
    }

    const response = await metaApi.post(`/${igUserId}/media`, null, { params });
    const containerId = response.data.id;

    if (!containerId) {
        throw new Error('No container ID returned from Instagram API');
    }

    log.info({ containerId, isCarouselItem }, 'Created image container');
    return containerId;
}

/**
 * Create a video/reel media container on Instagram.
 */
async function createVideoContainer(
    igUserId: string,
    accessToken: string,
    videoUrl: string,
    caption: string,
    mediaType: 'REELS' | 'STORIES'
): Promise<string> {
    const params: Record<string, string> = {
        video_url: videoUrl,
        media_type: mediaType,
        access_token: accessToken
    };

    // Stories don't support captions via API
    if (mediaType !== 'STORIES') {
        params.caption = caption;
    }

    const response = await metaApi.post(`/${igUserId}/media`, null, { params });
    const containerId = response.data.id;

    if (!containerId) {
        throw new Error('No container ID returned from Instagram API');
    }

    log.info({ containerId, mediaType }, 'Created video container');
    return containerId;
}

/**
 * Create a carousel container with child media items.
 */
async function createCarouselContainer(
    igUserId: string,
    accessToken: string,
    childIds: string[],
    caption: string
): Promise<string> {
    const response = await metaApi.post(`/${igUserId}/media`, null, {
        params: {
            media_type: 'CAROUSEL',
            children: childIds.join(','),
            caption: caption,
            access_token: accessToken
        }
    });
    const containerId = response.data.id;

    if (!containerId) {
        throw new Error('No carousel container ID returned from Instagram API');
    }

    log.info({ containerId, childCount: childIds.length }, 'Created carousel container');
    return containerId;
}

// -- Container Status Polling --

/**
 * Poll the status of a media container until it is ready for publishing.
 * Required for video-based media types (REELS, STORIES with video).
 */
async function waitForContainerReady(containerId: string, accessToken: string): Promise<ContainerStatusResult> {
    log.info({ containerId }, 'Polling container status');

    for (let attempt = 0; attempt < VIDEO_POLL_MAX_ATTEMPTS; attempt++) {
        const response = await metaApi.get(`/${containerId}`, {
            params: {
                fields: 'status_code,status',
                access_token: accessToken
            }
        });

        const statusCode = response.data.status_code;
        log.info({ containerId, statusCode, attempt: attempt + 1 }, 'Container status check');

        if (statusCode === 'FINISHED') {
            return { ready: true, statusCode };
        }

        if (statusCode === 'ERROR') {
            // status field can be a string or an object with error_code/error_message
            const statusData = response.data.status;
            const errorMsg = typeof statusData === 'string'
                ? statusData
                : statusData?.error_message || statusData?.error_type || `Container processing failed (code: ${statusData?.error_code ?? 'unknown'})`;
            log.error({ containerId, statusData }, 'Instagram container processing failed');
            return { ready: false, statusCode, error: errorMsg };
        }

        // IN_PROGRESS - wait and try again
        await new Promise(resolve => setTimeout(resolve, VIDEO_POLL_INTERVAL_MS));
    }

    return {
        ready: false,
        statusCode: 'TIMEOUT',
        error: `Container processing timed out after ${VIDEO_POLL_MAX_ATTEMPTS * VIDEO_POLL_INTERVAL_MS / 1000} seconds`
    };
}

// -- Publishing --

/**
 * Publish a ready media container to Instagram.
 */
async function publishContainer(igUserId: string, accessToken: string, containerId: string): Promise<string> {
    const response = await metaApi.post(`/${igUserId}/media_publish`, null, {
        params: {
            creation_id: containerId,
            access_token: accessToken
        }
    });

    const mediaId = response.data.id;
    if (!mediaId) {
        throw new Error('No media ID returned from publish call');
    }

    log.info({ mediaId }, 'Published media');
    return mediaId;
}

// -- Post Type Handlers --

/**
 * Publish a single image post to Instagram.
 * Uploads image to Facebook CDN first for reliable delivery.
 */
async function publishImagePost(
    igUserId: string,
    pageId: string,
    accessToken: string,
    post: PublishablePost
): Promise<PublishResult> {
    try {
        // Upload to Facebook CDN first, then use CDN URL for container
        const cdnUrl = await getPublishableImageUrl(post.thumbnail, pageId, accessToken);
        const containerId = await createImageContainer(igUserId, accessToken, cdnUrl, post.caption);
        const mediaId = await publishContainer(igUserId, accessToken, containerId);

        return { success: true, externalPostId: mediaId, retryable: false };
    } catch (error) {
        const parsed = parsePublishError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, retryable: parsed.retryable }, 'Image post failed');
        return { success: false, error: parsed.message, errorCode: parsed.code ?? undefined, retryable: parsed.retryable };
    }
}

/**
 * Publish a carousel post to Instagram.
 * Uploads each image to Facebook CDN first for reliable delivery.
 */
async function publishCarouselPost(
    igUserId: string,
    pageId: string,
    accessToken: string,
    post: PublishablePost
): Promise<PublishResult> {
    try {
        const mediaUrls = post.mediaUrls || [post.thumbnail];

        if (mediaUrls.length > 10) {
            return {
                success: false,
                error: 'Carousel posts support a maximum of 10 media items',
                errorCode: 'INVALID_CAROUSEL',
                retryable: false
            };
        }

        // Step 1: Upload each image to CDN and create child containers
        const childIds: string[] = [];
        for (const url of mediaUrls) {
            const cdnUrl = await getPublishableImageUrl(url, pageId, accessToken);
            const childId = await createImageContainer(igUserId, accessToken, cdnUrl, '', true);
            childIds.push(childId);
        }

        // Step 2: Create carousel container
        const carouselId = await createCarouselContainer(igUserId, accessToken, childIds, post.caption);

        // Step 3: Publish
        const mediaId = await publishContainer(igUserId, accessToken, carouselId);

        return { success: true, externalPostId: mediaId, retryable: false };
    } catch (error) {
        const parsed = parsePublishError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, retryable: parsed.retryable }, 'Carousel post failed');
        return { success: false, error: parsed.message, errorCode: parsed.code ?? undefined, retryable: parsed.retryable };
    }
}

/**
 * Publish a reel to Instagram.
 */
async function publishReelPost(
    igUserId: string,
    pageId: string,
    accessToken: string,
    post: PublishablePost
): Promise<PublishResult> {
    try {
        if (!post.videoUrl) {
            return publishImagePost(igUserId, pageId, accessToken, post);
        }

        // Resolve the video URL: rewrites localhost → ngrok for local dev;
        // in staging/prod the URL is already public so no rewrite occurs.
        // Instagram needs a direct progressive MP4 — the Facebook CDN approach
        // returns DASH URLs for HD video, which Instagram rejects.
        const publicVideoUrl = resolvePublicVideoUrl(post.videoUrl);
        const containerId = await createVideoContainer(igUserId, accessToken, publicVideoUrl, post.caption, 'REELS');

        // Step 2: Wait for video processing
        const status = await waitForContainerReady(containerId, accessToken);
        if (!status.ready) {
            return {
                success: false,
                error: status.error || 'Video processing failed',
                errorCode: status.statusCode,
                retryable: status.statusCode === 'TIMEOUT'
            };
        }

        // Step 3: Publish
        const mediaId = await publishContainer(igUserId, accessToken, containerId);

        return { success: true, externalPostId: mediaId, retryable: false };
    } catch (error) {
        const parsed = parsePublishError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, retryable: parsed.retryable }, 'Reel post failed');
        return { success: false, error: parsed.message, errorCode: parsed.code ?? undefined, retryable: parsed.retryable };
    }
}

/**
 * Publish a story to Instagram.
 * Image stories upload to Facebook CDN first.
 */
async function publishStoryPost(
    igUserId: string,
    pageId: string,
    accessToken: string,
    post: PublishablePost
): Promise<PublishResult> {
    try {
        const isVideo = !!post.videoUrl;

        // Step 1: Create story container
        let containerId: string;
        if (isVideo) {
            const publicVideoUrl = resolvePublicVideoUrl(post.videoUrl!);
            containerId = await createVideoContainer(igUserId, accessToken, publicVideoUrl, '', 'STORIES');

            // Step 2: Wait for video processing
            const status = await waitForContainerReady(containerId, accessToken);
            if (!status.ready) {
                return {
                    success: false,
                    error: status.error || 'Story video processing failed',
                    errorCode: status.statusCode,
                    retryable: status.statusCode === 'TIMEOUT'
                };
            }
        } else {
            // Image stories: upload to CDN first
            const cdnUrl = await getPublishableImageUrl(post.thumbnail, pageId, accessToken);
            const response = await metaApi.post(`/${igUserId}/media`, null, {
                params: {
                    image_url: cdnUrl,
                    media_type: 'STORIES',
                    access_token: accessToken
                }
            });
            containerId = response.data.id;
            if (!containerId) {
                throw new Error('No container ID returned for story');
            }
        }

        // Step 3: Publish
        const mediaId = await publishContainer(igUserId, accessToken, containerId);

        return { success: true, externalPostId: mediaId, retryable: false };
    } catch (error) {
        const parsed = parsePublishError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, retryable: parsed.retryable }, 'Story post failed');
        return { success: false, error: parsed.message, errorCode: parsed.code ?? undefined, retryable: parsed.retryable };
    }
}

// -- Main Entry Point --

/**
 * Publish a post to Instagram.
 * Decrypts the stored access token and routes to the correct handler based on post type.
 *
 * @param post - The post to publish
 * @param credentials - The restaurant's Instagram credentials (with encrypted token)
 * @returns PublishResult with success/failure details
 */
export async function publishToInstagram(
    post: PublishablePost,
    credentials: InstagramCredentialsForPublishing
): Promise<PublishResult> {
    log.info({ postId: post.id, postType: post.type, platform: 'Instagram' }, 'Starting publish to Instagram');

    // Decrypt access token
    const accessToken = decrypt(credentials.accessToken);
    if (!accessToken) {
        return {
            success: false,
            error: 'Failed to decrypt Instagram access token. Re-authentication may be required.',
            errorCode: 'TOKEN_DECRYPT_FAILED',
            retryable: false
        };
    }

    const igUserId = credentials.userId;
    const pageId = credentials.pageId;

    switch (post.type) {
        case 'IMAGE':
            return publishImagePost(igUserId, pageId, accessToken, post);
        case 'CAROUSEL':
            return publishCarouselPost(igUserId, pageId, accessToken, post);
        case 'REEL':
            return publishReelPost(igUserId, pageId, accessToken, post);
        case 'STORY':
            return publishStoryPost(igUserId, pageId, accessToken, post);
        case 'VIDEO':
            // VIDEO type uses the reel flow (Instagram deprecated standalone video posts in favor of reels)
            log.info('VIDEO type will be published as a Reel');
            return publishReelPost(igUserId, pageId, accessToken, post);
        default:
            return {
                success: false,
                error: `Unsupported post type: ${post.type}`,
                errorCode: 'UNSUPPORTED_TYPE',
                retryable: false
            };
    }
}

/**
 * Publish a post to Facebook Page.
 * Uses the Facebook Graph API to publish photos, videos, reels, and stories to a Facebook Page.
 *
 * Supported types:
 *   - IMAGE: POST /{page-id}/photos
 *   - CAROUSEL: POST /{page-id}/photos (multiple)
 *   - VIDEO: POST /{page-id}/videos
 *   - REEL: POST /{page-id}/video_reels (two-phase upload)
 *   - STORY: POST /{page-id}/photo_stories or /{page-id}/video_stories
 *
 * See: https://developers.facebook.com/docs/pages-api/posts
 * See: https://developers.facebook.com/docs/video-api/guides/reels-publishing
 */
export async function publishToFacebook(
    post: PublishablePost,
    credentials: InstagramCredentialsForPublishing
): Promise<PublishResult> {
    log.info({ postId: post.id, postType: post.type, platform: 'Facebook' }, 'Starting publish to Facebook');

    const accessToken = decrypt(credentials.accessToken);
    if (!accessToken) {
        return {
            success: false,
            error: 'Failed to decrypt access token',
            errorCode: 'TOKEN_DECRYPT_FAILED',
            retryable: false
        };
    }

    try {
        const pageId = credentials.pageId;

        if (!pageId) {
            return {
                success: false,
                error: 'No Facebook Page ID configured. Please reconnect Instagram/Facebook in Settings.',
                errorCode: 'MISSING_PAGE_ID',
                retryable: false
            };
        }

        // For single images, download and upload binary directly
        if (post.type === 'IMAGE') {
            // Download image first, then upload as binary
            const downloadResponse = await axios.get(post.thumbnail, {
                responseType: 'arraybuffer',
                maxRedirects: 10,
                timeout: 30000
            });
            const imageBuffer = Buffer.from(downloadResponse.data);
            const contentType = downloadResponse.headers['content-type'] || 'image/jpeg';

            const formData = new FormData();
            formData.append('source', imageBuffer, {
                filename: 'post_image.jpg',
                contentType: contentType
            });
            formData.append('message', post.caption);
            formData.append('access_token', accessToken);

            const response = await axios.post(
                `${META_GRAPH_API}/${pageId}/photos`,
                formData,
                { headers: formData.getHeaders(), timeout: API_TIMEOUT_MS }
            );

            log.info({ facebookPostId: response.data.post_id || response.data.id }, 'Facebook photo posted');
            return {
                success: true,
                externalPostId: response.data.post_id || response.data.id,
                retryable: false
            };
        }

        // For carousels, post each image as unpublished, then create a multi-photo post
        if (post.type === 'CAROUSEL') {
            const mediaUrls = post.mediaUrls || [post.thumbnail];

            if (mediaUrls.length === 1) {
                // Single image fallback - download and upload binary
                const dlRes = await axios.get(mediaUrls[0], {
                    responseType: 'arraybuffer',
                    maxRedirects: 10,
                    timeout: 30000
                });
                const buf = Buffer.from(dlRes.data);
                const ct = dlRes.headers['content-type'] || 'image/jpeg';

                const fd = new FormData();
                fd.append('source', buf, { filename: 'post_image.jpg', contentType: ct });
                fd.append('message', post.caption);
                fd.append('access_token', accessToken);

                const response = await axios.post(
                    `${META_GRAPH_API}/${pageId}/photos`,
                    fd,
                    { headers: fd.getHeaders(), timeout: API_TIMEOUT_MS }
                );

                log.info({ facebookPostId: response.data.post_id || response.data.id }, 'Facebook single-photo carousel posted');
                return {
                    success: true,
                    externalPostId: response.data.post_id || response.data.id,
                    retryable: false
                };
            }

            // Upload each photo as unpublished (binary upload)
            const photoIds: string[] = [];
            for (const url of mediaUrls) {
                const dlRes = await axios.get(url, {
                    responseType: 'arraybuffer',
                    maxRedirects: 10,
                    timeout: 30000
                });
                const buf = Buffer.from(dlRes.data);
                const ct = dlRes.headers['content-type'] || 'image/jpeg';

                const fd = new FormData();
                fd.append('source', buf, { filename: 'carousel_image.jpg', contentType: ct });
                fd.append('published', 'false');
                fd.append('access_token', accessToken);

                const photoResponse = await axios.post(
                    `${META_GRAPH_API}/${pageId}/photos`,
                    fd,
                    { headers: fd.getHeaders(), timeout: API_TIMEOUT_MS }
                );
                photoIds.push(photoResponse.data.id);
            }

            // Create multi-photo post using the feed endpoint
            // Facebook requires attached_media as URL parameters with specific format
            const params = new URLSearchParams({
                message: post.caption,
                access_token: accessToken
            });

            // Add each photo as attached_media[index]
            photoIds.forEach((id, index) => {
                params.append(`attached_media[${index}]`, JSON.stringify({ media_fbid: id }));
            });

            const feedResponse = await axios.post(
                `${META_GRAPH_API}/${pageId}/feed`,
                params.toString(),
                {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    timeout: API_TIMEOUT_MS
                }
            );

            log.info({ facebookPostId: feedResponse.data.id }, 'Facebook multi-photo carousel posted');
            return {
                success: true,
                externalPostId: feedResponse.data.id,
                retryable: false
            };
        }

        // Facebook Reels - use video_reels endpoint
        if (post.type === 'REEL') {
            if (!post.videoUrl) {
                // Graceful fallback: If no video but has thumbnail, post as image instead
                if (post.thumbnail) {
                    log.info({ postId: post.id }, 'REEL has no videoUrl, falling back to IMAGE for Facebook');
                    const fbImageUrl = await uploadImageToFacebook(post.thumbnail, pageId, accessToken);

                    const response = await metaApi.post(`/${pageId}/photos`, null, {
                        params: {
                            url: fbImageUrl,
                            message: post.caption,
                            access_token: accessToken
                        }
                    });

                    log.info({ facebookPostId: response.data.post_id || response.data.id }, 'Facebook photo posted (REEL fallback)');
                    return {
                        success: true,
                        externalPostId: response.data.post_id || response.data.id,
                        retryable: false
                    };
                }

                return {
                    success: false,
                    error: 'Reel posts require a videoUrl',
                    errorCode: 'MISSING_VIDEO',
                    retryable: false
                };
            }

            // Two-phase upload to the dedicated Reels endpoint.
            // Rewrites localhost → ngrok URL; in staging/prod the URL is already public.
            const publicVideoUrl = resolvePublicVideoUrl(post.videoUrl!);

            const startResponse = await metaApi.post(`/${pageId}/video_reels`, null, {
                params: { upload_phase: 'start', access_token: accessToken }
            });
            const videoId: string = startResponse.data.video_id;
            if (!videoId) throw new Error('No video_id returned from Facebook Reels start phase');

            await metaApi.post(`/${videoId}`, null, {
                params: {
                    file_url: publicVideoUrl,
                    upload_phase: 'finish',
                    video_state: 'PUBLISHED',
                    description: post.caption,
                    access_token: accessToken
                }
            });

            log.info({ facebookPostId: videoId }, 'Facebook Reel posted');
            return {
                success: true,
                externalPostId: videoId,
                retryable: false
            };
        }

        // Facebook Stories
        if (post.type === 'STORY') {
            // Stories can be either photo or video
            if (post.videoUrl) {
                // Facebook video_stories requires a publicly accessible file_url.
                // Rewrite localhost → ngrok URL; in staging/prod the URL is already public.
                const publicVideoUrl = resolvePublicVideoUrl(post.videoUrl);
                const response = await metaApi.post(`/${pageId}/video_stories`, null, {
                    params: {
                        file_url: publicVideoUrl,
                        access_token: accessToken,
                    },
                });

                log.info({ facebookPostId: response.data.id }, 'Facebook video story posted');
                return {
                    success: true,
                    externalPostId: response.data.id,
                    retryable: false
                };
            } else {
                // Photo story - upload image first
                const fbImageUrl = await uploadImageToFacebook(post.thumbnail, pageId, accessToken);

                const response = await metaApi.post(`/${pageId}/photo_stories`, null, {
                    params: {
                        photo_url: fbImageUrl,
                        access_token: accessToken
                    }
                });

                log.info({ facebookPostId: response.data.id }, 'Facebook photo story posted');
                return {
                    success: true,
                    externalPostId: response.data.id,
                    retryable: false
                };
            }
        }

        // For regular video posts, use the page videos endpoint
        if (post.type === 'VIDEO') {
            if (!post.videoUrl) {
                return {
                    success: false,
                    error: 'Video posts require a videoUrl',
                    errorCode: 'MISSING_VIDEO',
                    retryable: false
                };
            }

            // Binary upload — no public URL required
            const videoId = await uploadVideoToFacebookPage(post.videoUrl, pageId, accessToken, post.caption);

            log.info({ facebookPostId: videoId }, 'Facebook video posted');
            return {
                success: true,
                externalPostId: videoId,
                retryable: false
            };
        }

        return {
            success: false,
            error: `Unsupported post type for Facebook: ${post.type}`,
            errorCode: 'UNSUPPORTED_TYPE',
            retryable: false
        };
    } catch (error) {
        const parsed = parsePublishError(error);
        log.error({ error: parsed.message, code: parsed.code, subcode: parsed.subcode, fbtraceId: parsed.fbtraceId, retryable: parsed.retryable }, 'Facebook publish failed');
        return { success: false, error: parsed.message, errorCode: parsed.code ?? undefined, retryable: parsed.retryable };
    }
}

/**
 * Main entry point: publish a post to its configured platform.
 */
export async function publishPost(
    post: PublishablePost,
    credentials: InstagramCredentialsForPublishing
): Promise<PublishResult> {
    return post.platform === 'INSTAGRAM'
        ? publishToInstagram(post, credentials)
        : publishToFacebook(post, credentials);
}
