import { describe, it, expect, vi, beforeEach } from 'vitest';

// The api test setup mocks '@restropulse/telemetry/server' (the barrel); this
// suite loads the real events module from the built package instead.
const mockEmit = vi.fn();
vi.mock('@opentelemetry/api-logs', () => ({
    logs: { getLogger: vi.fn(() => ({ emit: mockEmit })) },
    SeverityNumber: { INFO: 9 },
}));

const { trackEvent, CUSTOM_EVENT_NAME_ATTRIBUTE } = await import('../../../../packages/telemetry/dist/server/events.js');
const { sanitizeEventProperties } = await import('../../../../packages/telemetry/dist/privacy.js');

describe('trackEvent', () => {
    beforeEach(() => mockEmit.mockReset());

    it('emits a log record routed to Application Insights customEvents', () => {
        trackEvent('post.publish_dead_lettered', { postId: 'p1', failureClass: 'permanent' });

        expect(mockEmit).toHaveBeenCalledTimes(1);
        const record = mockEmit.mock.calls[0][0];
        expect(CUSTOM_EVENT_NAME_ATTRIBUTE).toBe('microsoft.custom_event.name');
        expect(record.body).toBe('post.publish_dead_lettered');
        expect(record.attributes).toEqual({
            postId: 'p1',
            failureClass: 'permanent',
            'microsoft.custom_event.name': 'post.publish_dead_lettered',
        });
    });

    it('works with no properties', () => {
        trackEvent('worker.started');
        expect(mockEmit.mock.calls[0][0].attributes).toEqual({ 'microsoft.custom_event.name': 'worker.started' });
    });

    it('never throws when the exporter does', () => {
        mockEmit.mockImplementationOnce(() => { throw new Error('exporter down'); });
        let threw = false;
        try { trackEvent('x', { a: 'b' }); } catch { threw = true; }
        expect(threw).toBe(false);
        expect(mockEmit).toHaveBeenCalledTimes(1);
    });
});

describe('sanitizeEventProperties', () => {
    it('redacts sensitive keys and email/token values', () => {
        const out = sanitizeEventProperties({
            phone: '+919876543210',
            note: 'mail me at owner@example.com',
            auth: 'Bearer abc.def',
            jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0',
        });
        expect(out.phone).toBe('[REDACTED]');
        expect(out.note).toBe('mail me at [EMAIL]');
        expect(out.auth).toBe('Bearer [REDACTED]');
        expect(out.jwt).toBe('[TOKEN]');
    });

    it('leaves ids, counts and costs intact', () => {
        const props = { restaurantId: '6741234567890abcdef12345', costUsd: '0.000123456', inputTokens: '12345678' };
        expect(sanitizeEventProperties(props)).toEqual(props);
    });
});

describe('tracedCronJob heartbeat', () => {
    beforeEach(() => mockEmit.mockReset());

    it('emits cron.job.completed with status ok', async () => {
        const { tracedCronJob } = await import('../../../../packages/telemetry/dist/server/cron.js');
        await expect(tracedCronJob('publishing-job', async () => 42)).resolves.toBe(42);

        const record = mockEmit.mock.calls.map((c) => c[0]).find((r) => r.body === 'cron.job.completed');
        expect(record.attributes).toEqual(expect.objectContaining({ job: 'publishing-job', status: 'ok' }));
    });

    it('emits status error and rethrows when the job fails', async () => {
        const { tracedCronJob } = await import('../../../../packages/telemetry/dist/server/cron.js');
        await expect(tracedCronJob('publishing-job', async () => { throw new Error('boom'); })).rejects.toThrow('boom');

        const record = mockEmit.mock.calls.map((c) => c[0]).find((r) => r.body === 'cron.job.completed');
        expect(record.attributes).toEqual(expect.objectContaining({ job: 'publishing-job', status: 'error' }));
    });
});
