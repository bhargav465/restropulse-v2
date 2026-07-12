/**
 * Deep-link resolver tests — the "Act on this" buttons must point at the right
 * in-app destinations (CLAUDE.md §6 definition of done: ≥1 each into Content
 * Engine, Campaigns, Get-started).
 */
import { describe, test, expect } from 'vitest';
import { resolveDeepLink, resolveActionHref } from '../components/v2/intelligence/deep-links';

describe('resolveDeepLink', () => {
    test('content gaps → Content Engine', () => {
        const t = resolveDeepLink({ bucket: 'content', params: { brief: 'x' } });
        expect(t.bucket).toBe('CONTENT');
        expect(t.href).toBe('/admin-v2/content');
        expect(t.params).toEqual({ brief: 'x' });
    });

    test('retention/win-back → Campaigns (Ordering › Campaigns sub-tab)', () => {
        const t = resolveDeepLink({ bucket: 'campaigns', params: { cohort: 'lapsed_30d' } });
        expect(t.bucket).toBe('ORDERING');
        expect(t.orderingTab).toBe('CAMPAIGNS');
        expect(t.href).toBe('/admin-v2/ordering/campaigns');
    });

    test('profile fixes → Get-started', () => {
        const t = resolveDeepLink({ bucket: 'get-started', params: { task: 'review-replies' } });
        expect(t.bucket).toBe('GET_STARTED');
        expect(t.href).toBe('/admin-v2/get-started');
    });

    test('website foundation → Online Ordering', () => {
        const t = resolveDeepLink({ bucket: 'ordering' });
        expect(t.bucket).toBe('ORDERING');
        expect(t.orderingTab).toBe('OVERVIEW');
        expect(t.href).toBe('/admin-v2/ordering');
    });

    test('missing deep link falls back to Get-started (never dead)', () => {
        const t = resolveDeepLink(undefined);
        expect(t.bucket).toBe('GET_STARTED');
    });
});

describe('resolveActionHref (pillar-check Fix affordance)', () => {
    test('maps raw admin-v2 paths to their bucket', () => {
        expect(resolveActionHref('/admin-v2/website-design')?.bucket).toBe('DESIGN');
        expect(resolveActionHref('/admin-v2/content')?.bucket).toBe('CONTENT');
        expect(resolveActionHref('/admin-v2/get-started')?.bucket).toBe('GET_STARTED');
        expect(resolveActionHref('/admin-v2/intelligence')?.bucket).toBe('INTELLIGENCE');
    });

    test('null when no href', () => {
        expect(resolveActionHref(undefined)).toBeNull();
    });
});
