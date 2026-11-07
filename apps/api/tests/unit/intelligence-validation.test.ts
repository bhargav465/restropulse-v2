/**
 * Request validation on the Restaurant Intelligence POST routes. Auth, DB and
 * the scan/analysis services are mocked; these tests pin the 400/422 contract
 * the SPA relies on (status codes and error strings are unchanged from the
 * hand-written checks the zod schemas replaced).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mocks = vi.hoisted(() => ({
    findRestaurantById: vi.fn(),
    draftReviewReply: vi.fn(),
    recordZomatoManualEntry: vi.fn(),
    captureSnapshot: vi.fn(),
    resolveSelfPlaceId: vi.fn(),
}));

vi.mock('../../src/middleware/auth.js', () => ({
    requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
        req.user = { userId: 'u1', phone: '+910000000000', restaurantId: 'r-val', role: 'OWNER' } as never;
        next();
    },
}));
vi.mock('../../src/middleware/require-role.js', () => ({
    requireRole: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('../../src/middleware/require-entitlement.js', () => ({
    requireEntitlement: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock('@restropulse/db', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@restropulse/db')>()),
    findRestaurantById: mocks.findRestaurantById,
    getAllCities: vi.fn(async () => []),
}));
vi.mock('../../src/services/intelligence/analysis.js', () => ({ draftReviewReply: mocks.draftReviewReply }));
vi.mock('../../src/services/intelligence/zomato.js', () => ({ recordZomatoManualEntry: mocks.recordZomatoManualEntry }));
vi.mock('../../src/services/intelligence/snapshots.js', async (importOriginal) => ({
    ...(await importOriginal<object>()),
    captureSnapshot: mocks.captureSnapshot,
    resolveSelfPlaceId: mocks.resolveSelfPlaceId,
}));

const { default: intelligenceRoutes } = await import('../../src/routes/intelligence.js');

function app() {
    const a = express();
    a.use(express.json());
    a.use('/api/intelligence', intelligenceRoutes);
    return a;
}

beforeEach(() => {
    vi.clearAllMocks();
    mocks.findRestaurantById.mockResolvedValue({ name: 'Bawarchi', cuisine: 'Hyderabadi' });
});

describe('POST /api/intelligence/reviews/draft-reply', () => {
    it('400 "text is required" when text is missing, blank or not a string', async () => {
        for (const body of [{ rating: 4 }, { text: '   ', rating: 4 }, { text: 5, rating: 4 }]) {
            const res = await request(app()).post('/api/intelligence/reviews/draft-reply').send(body);
            expect(res.status).toBe(400);
            expect(res.body).toEqual({ success: false, error: 'text is required' });
        }
        expect(mocks.draftReviewReply).not.toHaveBeenCalled();
    });

    it('400 "rating (1-5) is required" for missing, string or out-of-range ratings', async () => {
        for (const rating of [undefined, '4', 0, 6]) {
            const res = await request(app()).post('/api/intelligence/reviews/draft-reply').send({ text: 'Great biryani', rating });
            expect(res.status).toBe(400);
            expect(res.body.error).toBe('rating (1-5) is required');
        }
    });

    it('passes trimmed text and author to the drafter', async () => {
        mocks.draftReviewReply.mockResolvedValue({ reply: 'Thank you!' });
        const res = await request(app())
            .post('/api/intelligence/reviews/draft-reply')
            .send({ text: '  Great biryani  ', rating: 5, author: ' Asha ' });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { reply: 'Thank you!' } });
        expect(mocks.draftReviewReply).toHaveBeenCalledWith({
            restaurantName: 'Bawarchi',
            review: { text: 'Great biryani', rating: 5, author: 'Asha' },
            voice: { cuisine: 'Hyderabadi' },
        });
    });

    it('drops a blank author instead of failing', async () => {
        mocks.draftReviewReply.mockResolvedValue({ reply: 'ok' });
        await request(app()).post('/api/intelligence/reviews/draft-reply').send({ text: 'Nice', rating: 3, author: '  ' });
        expect(mocks.draftReviewReply.mock.calls[0][0].review).toEqual({ text: 'Nice', rating: 3 });
    });
});

describe('POST /api/intelligence/scan', () => {
    it('400 when neither the body nor the profile supplies name and city', async () => {
        mocks.findRestaurantById.mockResolvedValue({});
        const res = await request(app()).post('/api/intelligence/scan').send({ name: 123, city: '  ' });
        expect(res.status).toBe(400);
        expect(res.body.success).toBe(false);
        expect(res.body.error).toMatch(/name and city are required/);
    });
});

describe('POST /api/intelligence/zomato-manual', () => {
    it.each([
        [{ rating: 6, reviewCount: 1, photoCount: 1 }, 'rating must be between 0 and 5'],
        [{ rating: 'abc', reviewCount: 1, photoCount: 1 }, 'rating must be between 0 and 5'],
        [{ reviewCount: 1, photoCount: 1 }, 'rating must be between 0 and 5'],
        [{ rating: 4, reviewCount: -1, photoCount: 1 }, 'reviewCount must be a non-negative integer'],
        [{ rating: 4, reviewCount: 1.5, photoCount: 1 }, 'reviewCount must be a non-negative integer'],
        [{ rating: 4, reviewCount: 1, photoCount: 'x' }, 'photoCount must be a non-negative integer'],
    ])('422 for %j', async (body, error) => {
        const res = await request(app()).post('/api/intelligence/zomato-manual').send(body);
        expect(res.status).toBe(422);
        expect(res.body).toEqual({ success: false, error });
        expect(mocks.recordZomatoManualEntry).not.toHaveBeenCalled();
    });

    it('coerces numeric strings and defaults target to self', async () => {
        mocks.resolveSelfPlaceId.mockResolvedValue('place-self');
        mocks.captureSnapshot.mockResolvedValue({ id: 's1' });
        const res = await request(app())
            .post('/api/intelligence/zomato-manual')
            .send({ rating: '4.2', reviewCount: '120', photoCount: 30 });
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ success: true, data: { snapshotWritten: true } });
        expect(mocks.recordZomatoManualEntry).toHaveBeenCalledWith('r-val', 'place-self', {
            rating: 4.2, reviewCount: 120, photoCount: 30,
        });
    });
});
