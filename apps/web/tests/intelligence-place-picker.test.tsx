/**
 * PlacePicker (Brief 10 §1) — city→name enable flow, 25 km bounds bias, selection
 * emits {placeId,name,city,location}, and demo [SAMPLE] suggestions render with
 * zero backend (the demo engine).
 */
import { describe, test, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from './utils/test-utils';
import PlacePicker from '../components/v2/intelligence/PlacePicker';
import {
    demoPlacePickerEngine,
    type PlacePickerEngine,
} from '../components/v2/intelligence/place-picker-engine';

describe('PlacePicker', () => {
    test('demo: city suggestions render, name enables after city, selection emits placeId', async () => {
        const onConfirm = vi.fn();
        render(<PlacePicker engine={demoPlacePickerEngine} onConfirm={onConfirm} />);

        const cityInput = screen.getByLabelText('City');
        const nameInput = screen.getByLabelText('Restaurant name');
        // Name is disabled until a city is chosen.
        expect(nameInput).toBeDisabled();

        fireEvent.change(cityInput, { target: { value: 'Beng' } });
        const cityOption = await screen.findByText(/Bengaluru, Karnataka/);
        fireEvent.click(cityOption);

        await waitFor(() => expect(nameInput).not.toBeDisabled());

        fireEvent.change(nameInput, { target: { value: 'Spice' } });
        const nameOption = await screen.findByText(/\[SAMPLE\] The Spice Lounge/);
        fireEvent.click(nameOption);

        const confirmBtn = await screen.findByText(/Confirm this is my restaurant/);
        fireEvent.click(confirmBtn);

        expect(onConfirm).toHaveBeenCalledWith(
            expect.objectContaining({
                placeId: 'demo-place-spice-lounge',
                name: '[SAMPLE] The Spice Lounge',
                city: expect.stringContaining('Bengaluru'),
                location: expect.objectContaining({ lat: expect.any(Number), lng: expect.any(Number) }),
            }),
        );
    });

    test('biases the restaurant search to a 25 km circle around the selected city', async () => {
        const searchRestaurants = vi.fn().mockResolvedValue([{ placeId: 'p1', description: 'Test Resto' }]);
        const engine: PlacePickerEngine = {
            searchCities: vi.fn().mockResolvedValue([{ placeId: 'c1', description: 'Testville' }]),
            getCityLocation: vi.fn().mockResolvedValue({ lat: 12.9, lng: 77.6 }),
            searchRestaurants,
            getDetails: vi.fn(),
        };
        render(<PlacePicker engine={engine} onConfirm={vi.fn()} />);

        fireEvent.change(screen.getByLabelText('City'), { target: { value: 'Test' } });
        fireEvent.click(await screen.findByText('Testville'));
        await waitFor(() => expect(screen.getByLabelText('Restaurant name')).not.toBeDisabled());

        fireEvent.change(screen.getByLabelText('Restaurant name'), { target: { value: 'Res' } });
        await waitFor(() => expect(searchRestaurants).toHaveBeenCalled());

        expect(searchRestaurants).toHaveBeenCalledWith('Res', {
            center: { lat: 12.9, lng: 77.6 },
            radiusKm: 25,
        });
    });
});
