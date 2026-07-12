/**
 * Restaurant Details v2 page (Brief 04 / DESIGN-04).
 *
 * Proves: the 5 quiet underline tabs render; a Basics save PATCHes only the
 * dirty field (whitelist-shaped); bad input shows the mirror-of-server 400
 * message and blocks the PATCH; the Hours tab writes the storefront DRAFT with
 * the "Saved to draft — publish to go live" copy; and the demo `uploadAsset`
 * twin returns an object URL with ZERO network.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import { DEMO_RESTAURANT } from '../lib/demo-fixtures';

const updateProfile = vi.fn();
const uploadAsset = vi.fn();
const getContentDraft = vi.fn();
const saveContentDraft = vi.fn();
const publishContent = vi.fn();

vi.mock('../api', () => ({
    restaurantAPI: {
        getProfile: vi.fn(),
        updateProfile: (...args: unknown[]) => updateProfile(...args),
        uploadAsset: (...args: unknown[]) => uploadAsset(...args),
    },
    orderingAdminAPI: {
        getContentDraft: (...args: unknown[]) => getContentDraft(...args),
        saveContentDraft: (...args: unknown[]) => saveContentDraft(...args),
        publishContent: (...args: unknown[]) => publishContent(...args),
    },
}));

import RestaurantDetailsV2 from '../components/v2/RestaurantDetailsV2';

describe('RestaurantDetailsV2', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getContentDraft.mockResolvedValue({ draft: { heroImages: [], hours: [{ day: 'Monday', open: '11:00', close: '23:00' }] }, publishedVersion: 1, versions: [] });
        updateProfile.mockImplementation(async (patch) => ({ ...DEMO_RESTAURANT, ...patch }));
        saveContentDraft.mockImplementation(async (d) => d);
        publishContent.mockResolvedValue(2);
        (global.URL.createObjectURL as unknown) = vi.fn(() => 'blob:mock-preview');
    });

    it('renders the five underline tabs, Basics first', async () => {
        render(<RestaurantDetailsV2 restaurantData={DEMO_RESTAURANT} />);
        expect(screen.getByRole('tab', { name: /^Basics$/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Address & Contact/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Legal/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Branding/i })).toBeInTheDocument();
        expect(screen.getByRole('tab', { name: /Hours/i })).toBeInTheDocument();
        expect(screen.getByLabelText(/Restaurant name/i)).toBeInTheDocument();
    });

    it('PATCHes only the dirty field on Save basics', async () => {
        render(<RestaurantDetailsV2 restaurantData={DEMO_RESTAURANT} />);
        const name = screen.getByLabelText(/Restaurant name/i);
        fireEvent.change(name, { target: { value: 'New Name' } });
        fireEvent.click(screen.getByRole('button', { name: /Save basics/i }));
        await waitFor(() => expect(updateProfile).toHaveBeenCalledTimes(1));
        expect(updateProfile).toHaveBeenCalledWith({ name: 'New Name' });
    });

    it('shows a field-named error and blocks the PATCH on a bad pincode', async () => {
        render(<RestaurantDetailsV2 restaurantData={DEMO_RESTAURANT} />);
        fireEvent.click(screen.getByRole('tab', { name: /Address & Contact/i }));
        fireEvent.change(screen.getByLabelText(/Address line 1/i), { target: { value: '1 Test Rd' } });
        fireEvent.change(screen.getByLabelText(/^City$/i), { target: { value: 'Bengaluru' } });
        fireEvent.change(screen.getByLabelText(/^State$/i), { target: { value: 'Karnataka' } });
        fireEvent.change(screen.getByLabelText(/PIN code/i), { target: { value: '012345' } });
        fireEvent.click(screen.getByRole('button', { name: /Save address & contact/i }));
        await waitFor(() => expect(screen.getByText(/valid 6-digit PIN code/i)).toBeInTheDocument());
        expect(updateProfile).not.toHaveBeenCalled();
    });

    it('writes the storefront draft with the publish-to-go-live copy from the Hours tab', async () => {
        render(<RestaurantDetailsV2 restaurantData={DEMO_RESTAURANT} />);
        fireEvent.click(screen.getByRole('tab', { name: /Hours/i }));
        // Draft loads → an editable hours row appears.
        await waitFor(() => expect(screen.getByLabelText(/Hours 1 day/i)).toBeInTheDocument());
        fireEvent.change(screen.getByLabelText(/Hours 1 open/i), { target: { value: '10:00' } });
        fireEvent.click(screen.getByRole('button', { name: /Save draft/i }));
        await waitFor(() => expect(saveContentDraft).toHaveBeenCalled());
        expect(screen.getAllByText(/Saved to draft — publish to go live/i).length).toBeGreaterThan(0);
    });

    it('uploads a logo → local preview + uploadAsset + updateProfile', async () => {
        uploadAsset.mockResolvedValue({ assetId: 'a1', url: '/api/assets/a1' });
        render(<RestaurantDetailsV2 restaurantData={DEMO_RESTAURANT} />);
        fireEvent.click(screen.getByRole('tab', { name: /Branding/i }));
        const file = new File(['x'], 'logo.png', { type: 'image/png' });
        fireEvent.change(screen.getByLabelText(/Upload logo/i), { target: { files: [file] } });
        await waitFor(() => expect(uploadAsset).toHaveBeenCalledWith(file, 'logo'));
        await waitFor(() => expect(updateProfile).toHaveBeenCalledWith({ logoUrl: '/api/assets/a1' }));
    });
});

describe('demo uploadAsset twin — object URL, zero network', () => {
    it('returns a demo-asset object URL and never touches fetch', async () => {
        const fetchSpy = vi.fn();
        (global.fetch as unknown) = fetchSpy;
        (global.URL.createObjectURL as unknown) = vi.fn(() => 'blob:demo');
        const demo = await import('../demo-api');
        const file = new File(['x'], 'logo.png', { type: 'image/png' });
        const res = await demo.restaurantAPI.uploadAsset(file, 'logo');
        expect(res.assetId).toMatch(/^demo-asset-\d+$/);
        expect(res.url).toBe('blob:demo');
        expect(fetchSpy).not.toHaveBeenCalled();
    });
});
