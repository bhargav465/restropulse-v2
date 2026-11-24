import { describe, it, expect, beforeEach } from 'vitest';
import type { Platform } from '@restropulse/shared';

const mockPost = vi.fn();
const mockGet = vi.fn();

vi.mock('axios', () => {
    class AxiosError extends Error {
        response: any;
        code: string | undefined;
        isAxiosError = true;
        constructor(message: string, code?: string, _config?: any, _request?: any, response?: any) {
            super(message);
            this.code = code;
            this.response = response;
        }
    }
    const instance = { post: mockPost, get: mockGet, defaults: {}, interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } } };
    return {
        __esModule: true,
        default: { create: vi.fn(() => instance), post: mockPost, get: mockGet, isAxiosError: (e: any) => e?.isAxiosError === true },
        AxiosError,
    };
});

vi.mock('../../../../packages/publishing/dist/encryption.js', () => ({
    decrypt: vi.fn(() => 'decrypted-token'),
    encrypt: vi.fn((v: string) => `encrypted_${v}`),
    generateStateToken: vi.fn(() => 'state'),
}));

const { classifyMetaError, publishToInstagram } = await import('@restropulse/publishing');
const { AxiosError } = await import('axios');

describe('classifyMetaError', () => {
    it.each([
        [{ code: 190 }, 'reauth'],
        [{ code: 190, error_subcode: 463 }, 'reauth'],
        [{ code: '190', error_subcode: 460 }, 'reauth'],
        [{ code: 102 }, 'reauth'],
        [{ code: 200 }, 'reauth'],
        [{ code: 299 }, 'reauth'],
        [{ code: 4 }, 'retryable'],
        [{ code: 17 }, 'retryable'],
        [{ code: 32 }, 'retryable'],
        [{ code: 613 }, 'retryable'],
        [{ code: 1 }, 'retryable'],
        [{ code: 2 }, 'retryable'],
        [{ code: 9007, is_transient: true }, 'retryable'],
        [{ code: 2207026 }, 'retryable'],
        [{ code: 10 }, 'permanent'],
        [{ code: 100 }, 'permanent'],
        [{ code: 36003 }, 'permanent'],
        [{}, 'permanent'],
    ] as const)('%j -> %s', (err, expected) => {
        expect(classifyMetaError(err as any)).toBe(expected);
    });

    it('lets reauth win over is_transient', () => {
        expect(classifyMetaError({ code: 190, is_transient: true })).toBe('reauth');
    });
});

describe('publish results carry the failure class', () => {
    const creds = { userId: 'ig-user', pageId: 'page', accessToken: 'enc' };
    const post = { id: 'p1', type: 'IMAGE' as const, caption: 'c', thumbnail: 'https://example.com/a.jpg', platform: 'INSTAGRAM' as Platform };

    beforeEach(() => {
        vi.clearAllMocks();
        // Image download for the CDN upload succeeds; the upload call to Meta fails.
        mockGet.mockResolvedValue({ data: Buffer.from('img'), headers: { 'content-type': 'image/jpeg' } });
    });

    it('marks an expired token as reauth and not retryable', async () => {
        mockPost.mockRejectedValue(new (AxiosError as any)('fail', undefined, undefined, undefined, {
            status: 400, data: { error: { code: 190, error_subcode: 463, message: 'Session has expired' } },
        }));

        const result = await publishToInstagram(post, creds);

        expect(result.success).toBe(false);
        expect(result.failureClass).toBe('reauth');
        expect(result.retryable).toBe(false);
        expect(result.errorCode).toBe('190');
    });

    it('marks a Meta outage as retryable', async () => {
        mockPost.mockRejectedValue(new (AxiosError as any)('fail', undefined, undefined, undefined, {
            status: 500, data: { error: { code: 2, message: 'Service temporarily unavailable' } },
        }));

        const result = await publishToInstagram(post, creds);

        expect(result.failureClass).toBe('retryable');
        expect(result.retryable).toBe(true);
    });

    it('treats a dropped connection with no response as retryable', async () => {
        mockPost.mockRejectedValue(new (AxiosError as any)('socket hang up', 'ECONNRESET'));

        const result = await publishToInstagram(post, creds);

        expect(result.failureClass).toBe('retryable');
    });

    it('treats an HTTP 401 without a Meta body as reauth', async () => {
        mockPost.mockRejectedValue(new (AxiosError as any)('unauthorized', undefined, undefined, undefined, { status: 401, data: {} }));

        const result = await publishToInstagram(post, creds);

        expect(result.failureClass).toBe('reauth');
    });

    it('treats a plain 400 without a Meta body as permanent', async () => {
        mockPost.mockRejectedValue(new (AxiosError as any)('bad', undefined, undefined, undefined, { status: 400, data: {} }));

        const result = await publishToInstagram(post, creds);

        expect(result.failureClass).toBe('permanent');
        expect(result.retryable).toBe(false);
    });
});
