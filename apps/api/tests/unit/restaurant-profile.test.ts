/**
 * Restaurant profile routes (Brief 04 / DESIGN-04).
 *
 * Covers the whitelist (blocked keys never persist), field validation (400s),
 * partial + null-unset semantics, the hardened PUT /:id (NEXT.md §10), and the
 * public GET /:id sanitization (no `instagramCredentials` leak — owner decision 3).
 * Uses the real in-memory Mongo (setup.ts) via createTestApp.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import { createTestApp, generateAuthToken } from '../helpers/testHelper.js';
import { getRestaurantsCollection } from '@restropulse/db';
import { RESTAURANT_PROFILE_FIELDS } from '@restropulse/shared';

const app = createTestApp();
const authToken = generateAuthToken(); // mockUser: restaurantId 'r1', role OWNER

/** Base restaurant doc with sensitive fields present, re-seeded before each test. */
const baseDoc = {
    name: 'The Spice Lounge',
    cuisine: 'Modern Indian',
    slug: 'spice-lounge',
    storeOpen: true,
    ordering: { taxRatePercent: 5, currency: 'INR', delivery: { enabled: true, flatFee: 40, minOrder: 199 } },
    integrations: { instagram: false },
    razorpayCustomerId: 'cust_SENSITIVE',
    location: { address: '12 Indiranagar', lat: 12.97, lng: 77.59, mapUrl: '' },
    accountManager: { name: 'AM', phone: '+910000000000', email: 'am@x.com', avatar: '' },
};

async function seedR1(extra: Record<string, unknown> = {}) {
    const col = getRestaurantsCollection();
    await col.updateOne({ _id: 'r1' as any }, { $set: { ...baseDoc, ...extra }, $unset: { instagramCredentials: '' } }, { upsert: true });
}

describe('Restaurant profile routes (Brief 04)', () => {
    beforeEach(async () => {
        await seedR1();
    });

    describe('GET /api/restaurant/profile', () => {
        it('returns the sanitized own profile for an OWNER', async () => {
            const res = await request(app).get('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`);
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(res.body.data.id).toBe('r1');
            expect(res.body.data.name).toBe('The Spice Lounge');
            // Read-only context is present
            expect(res.body.data.slug).toBe('spice-lounge');
            expect(res.body.data.ordering).toBeDefined();
            // Server-internal credential fields never leave the server
            expect(res.body.data).not.toHaveProperty('instagramCredentials');
            expect(res.body.data).not.toHaveProperty('razorpayCustomerId');
        });

        it('returns 401 without a token', async () => {
            const res = await request(app).get('/api/restaurant/profile');
            expect(res.status).toBe(401);
        });
    });

    describe('PATCH /api/restaurant/profile — whitelist', () => {
        it('persists only whitelisted fields; drops slug/ordering/credentials', async () => {
            const res = await request(app)
                .patch('/api/restaurant/profile')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    name: 'Renamed Kitchen',
                    slug: 'hax',
                    ordering: { taxRatePercent: 99 },
                    instagramCredentials: { accessToken: 'stolen' },
                    razorpayCustomerId: 'cust_HACK',
                    integrations: { instagram: true },
                });

            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Renamed Kitchen');

            const doc = await getRestaurantsCollection().findOne({ _id: 'r1' as any });
            expect(doc!.name).toBe('Renamed Kitchen');
            // None of the blocked keys were mutated
            expect(doc!.slug).toBe('spice-lounge');
            expect((doc!.ordering as any).taxRatePercent).toBe(5);
            expect(doc!.instagramCredentials).toBeUndefined();
            expect(doc!.razorpayCustomerId).toBe('cust_SENSITIVE');
            expect((doc!.integrations as any).instagram).toBe(false);
        });

        it('accepts a full set of new profile fields', async () => {
            const res = await request(app)
                .patch('/api/restaurant/profile')
                .set('Authorization', `Bearer ${authToken}`)
                .send({
                    legalName: 'Spice Lounge Pvt Ltd',
                    cuisineTags: ['North Indian', 'Biryani'],
                    email: 'hello@spice.com',
                    gstin: '29ABCDE1234F1Z5',
                    fssaiLicense: '12345678901234',
                    address: { line1: '12 Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038' },
                    logoUrl: '/api/assets/abc123',
                });
            expect(res.status).toBe(200);
            expect(res.body.data.legalName).toBe('Spice Lounge Pvt Ltd');
            expect(res.body.data.cuisineTags).toEqual(['North Indian', 'Biryani']);
            expect(res.body.data.gstin).toBe('29ABCDE1234F1Z5');
        });

        it('clears an optional field when passed null ($unset)', async () => {
            await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`).send({ legalName: 'Temp' });
            const res = await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`).send({ legalName: null });
            expect(res.status).toBe(200);
            const doc = await getRestaurantsCollection().findOne({ _id: 'r1' as any });
            expect(doc!.legalName).toBeUndefined();
        });

        it('rejects a bad pincode with a field-named 400', async () => {
            const res = await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`)
                .send({ address: { line1: 'x', city: 'y', state: 'z', pincode: '012345' } });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/pincode/i);
        });

        it('rejects a bad GSTIN with a 400', async () => {
            const res = await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`).send({ gstin: 'NOTAGST' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/gstin/i);
        });

        it('rejects a bad FSSAI licence with a 400', async () => {
            const res = await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`).send({ fssaiLicense: '123' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/fssai/i);
        });

        it('rejects a bad email with a 400', async () => {
            const res = await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`).send({ email: 'not-an-email' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/email/i);
        });

        it('returns 400 when no valid profile fields are present', async () => {
            const res = await request(app).patch('/api/restaurant/profile').set('Authorization', `Bearer ${authToken}`).send({ slug: 'x', foo: 'bar' });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/no valid profile fields/i);
        });
    });

    describe('PUT /api/restaurant/:id — hardened whitelist (NEXT.md §10)', () => {
        it('strips slug/ordering/credentials from a PUT body', async () => {
            const res = await request(app)
                .put('/api/restaurant/r1')
                .set('Authorization', `Bearer ${authToken}`)
                .send({ name: 'Via PUT', slug: 'hax', ordering: { taxRatePercent: 42 }, instagramCredentials: { accessToken: 'x' }, razorpayCustomerId: 'y' });
            expect(res.status).toBe(200);
            expect(res.body.data.name).toBe('Via PUT');

            const doc = await getRestaurantsCollection().findOne({ _id: 'r1' as any });
            expect(doc!.slug).toBe('spice-lounge');
            expect((doc!.ordering as any).taxRatePercent).toBe(5);
            expect(doc!.instagramCredentials).toBeUndefined();
            expect(doc!.razorpayCustomerId).toBe('cust_SENSITIVE');
        });
    });

    describe('GET /api/restaurant/:id — public sanitization (decision 3)', () => {
        it('never returns instagramCredentials on the public route', async () => {
            // Plant an encrypted-token credential on the doc.
            await getRestaurantsCollection().updateOne({ _id: 'r1' as any }, {
                $set: {
                    instagramCredentials: {
                        userId: 'ig1', username: '@spice', pageId: 'p1', pageName: 'Spice', accessToken: 'ENCRYPTED_SECRET',
                        tokenExpiresAt: new Date(Date.now() + 60 * 86400000), scopes: [], connectedAt: new Date(),
                    },
                },
            });

            const res = await request(app).get('/api/restaurant/r1'); // public, no auth
            expect(res.status).toBe(200);
            expect(res.body.data).not.toHaveProperty('instagramCredentials');
            expect(res.body.data).not.toHaveProperty('razorpayCustomerId');
            expect(JSON.stringify(res.body.data)).not.toContain('ENCRYPTED_SECRET');
            // Non-secret fields the admin dashboard/storefront need remain intact
            expect(res.body.data).toHaveProperty('integrations');
        });
    });

    describe('whitelist source of truth', () => {
        it('exports RESTAURANT_PROFILE_FIELDS from @restropulse/shared', () => {
            expect(RESTAURANT_PROFILE_FIELDS).toContain('name');
            expect(RESTAURANT_PROFILE_FIELDS).not.toContain('slug');
            expect(RESTAURANT_PROFILE_FIELDS).not.toContain('instagramCredentials');
        });
    });
});
