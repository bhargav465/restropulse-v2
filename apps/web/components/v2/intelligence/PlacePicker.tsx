import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    type PlacePickerEngine,
    type PlaceSuggestion,
    type PlaceDetails,
    type PlacePickerSelection,
    CITY_BIAS_RADIUS_KM,
} from './place-picker-engine';

/**
 * PlacePicker (Brief 10 §1) — "Add my restaurant" via Google Places.
 *
 * Flow: city input (`types:['(cities)']`) → name input (`types:['establishment']`,
 * enabled only after a city is chosen, biased to a 25 km circle around the city)
 * → selection preview card (photo, rating, reviews, address) → confirm, which
 * emits `{ placeId, name, city, location }`.
 *
 * The Places calls are behind an injected `engine`, so this component is fully
 * unit-testable with a mock and renders from `[SAMPLE]` fixtures in demo mode
 * (the demo engine) with zero backend. Tokens only — no raw hex.
 */

const DEBOUNCE_MS = 250;

interface PlacePickerProps {
    engine: PlacePickerEngine;
    onConfirm: (selection: PlacePickerSelection) => void;
    onCancel?: () => void;
    /** Disables all inputs (e.g. while the loader is still initializing). */
    disabled?: boolean;
}

interface SelectedCity {
    placeId: string;
    name: string;
    location: { lat: number; lng: number };
}

const fieldClass =
    'w-full rounded-lg border border-line bg-surface text-ink text-sm px-3 py-2.5 placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed';

const Dropdown: React.FC<{
    items: PlaceSuggestion[];
    onPick: (s: PlaceSuggestion) => void;
    testid: string;
}> = ({ items, onPick, testid }) => {
    if (items.length === 0) return null;
    return (
        <ul
            data-testid={testid}
            className="absolute z-20 mt-1 w-full bg-surface border border-line rounded-xl shadow-lg max-h-60 overflow-y-auto"
        >
            {items.map((s) => (
                <li key={s.placeId}>
                    <button
                        type="button"
                        onClick={() => onPick(s)}
                        className="w-full text-left px-4 py-3 text-sm text-ink hover:bg-primary-soft transition-colors first:rounded-t-xl last:rounded-b-xl"
                    >
                        {s.description}
                    </button>
                </li>
            ))}
        </ul>
    );
};

const PlacePicker: React.FC<PlacePickerProps> = ({ engine, onConfirm, onCancel, disabled = false }) => {
    // City step
    const [cityInput, setCityInput] = useState('');
    const [citySuggestions, setCitySuggestions] = useState<PlaceSuggestion[]>([]);
    const [selectedCity, setSelectedCity] = useState<SelectedCity | null>(null);

    // Name step
    const [nameInput, setNameInput] = useState('');
    const [nameSuggestions, setNameSuggestions] = useState<PlaceSuggestion[]>([]);

    // Preview
    const [preview, setPreview] = useState<PlaceDetails | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    const cityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cityBias = useMemo(
        () => (selectedCity ? { center: selectedCity.location, radiusKm: CITY_BIAS_RADIUS_KM } : null),
        [selectedCity],
    );

    // Debounced city autocomplete (until a city is confirmed).
    useEffect(() => {
        if (selectedCity || !cityInput.trim()) {
            setCitySuggestions([]);
            return;
        }
        if (cityTimer.current) clearTimeout(cityTimer.current);
        cityTimer.current = setTimeout(async () => {
            try {
                setCitySuggestions(await engine.searchCities(cityInput));
            } catch {
                setCitySuggestions([]);
            }
        }, DEBOUNCE_MS);
        return () => {
            if (cityTimer.current) clearTimeout(cityTimer.current);
        };
    }, [cityInput, selectedCity, engine]);

    // Debounced restaurant autocomplete, biased to the selected city (25 km).
    useEffect(() => {
        if (!selectedCity || preview || !nameInput.trim()) {
            setNameSuggestions([]);
            return;
        }
        if (nameTimer.current) clearTimeout(nameTimer.current);
        nameTimer.current = setTimeout(async () => {
            try {
                setNameSuggestions(await engine.searchRestaurants(nameInput, cityBias));
            } catch {
                setNameSuggestions([]);
            }
        }, DEBOUNCE_MS);
        return () => {
            if (nameTimer.current) clearTimeout(nameTimer.current);
        };
    }, [nameInput, selectedCity, preview, cityBias, engine]);

    const pickCity = async (s: PlaceSuggestion) => {
        setCitySuggestions([]);
        setCityInput(s.description);
        try {
            const location = await engine.getCityLocation(s.placeId);
            setSelectedCity({ placeId: s.placeId, name: s.description, location });
        } catch {
            setSelectedCity({ placeId: s.placeId, name: s.description, location: { lat: 0, lng: 0 } });
        }
    };

    const resetCity = () => {
        setSelectedCity(null);
        setNameInput('');
        setNameSuggestions([]);
        setPreview(null);
    };

    const pickRestaurant = async (s: PlaceSuggestion) => {
        setNameSuggestions([]);
        setNameInput(s.description);
        setLoadingPreview(true);
        try {
            setPreview(await engine.getDetails(s.placeId));
        } catch {
            setPreview(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    const confirm = () => {
        if (!preview || !selectedCity) return;
        onConfirm({
            placeId: preview.placeId,
            name: preview.name,
            city: selectedCity.name,
            location: preview.location,
        });
    };

    return (
        <div className="space-y-4">
            {/* Step 1 — city */}
            <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">Your city</label>
                <div className="relative">
                    <input
                        type="text"
                        value={cityInput}
                        onChange={(e) => setCityInput(e.target.value)}
                        onFocus={() => selectedCity && resetCity()}
                        disabled={disabled}
                        placeholder="Start typing your city…"
                        aria-label="City"
                        className={fieldClass}
                    />
                    <Dropdown items={citySuggestions} onPick={pickCity} testid="city-suggestions" />
                </div>
            </div>

            {/* Step 2 — restaurant name (enabled after a city is chosen) */}
            <div>
                <label className="block text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                    Your restaurant
                </label>
                <div className="relative">
                    <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => {
                            setNameInput(e.target.value);
                            setPreview(null);
                        }}
                        disabled={disabled || !selectedCity}
                        placeholder={selectedCity ? 'Start typing your restaurant name…' : 'Pick your city first'}
                        aria-label="Restaurant name"
                        className={fieldClass}
                    />
                    <Dropdown items={nameSuggestions} onPick={pickRestaurant} testid="restaurant-suggestions" />
                </div>
            </div>

            {loadingPreview && <p className="text-sm text-muted">Loading restaurant details…</p>}

            {/* Preview card */}
            {preview && (
                <div className="rounded-2xl border border-line bg-surface p-4" data-testid="place-preview">
                    <div className="flex gap-4">
                        {preview.photoUrl ? (
                            // eslint-disable-next-line jsx-a11y/img-redundant-alt
                            <img
                                src={preview.photoUrl}
                                alt={`${preview.name} photo`}
                                className="w-20 h-20 rounded-xl object-cover shrink-0"
                            />
                        ) : (
                            <div className="w-20 h-20 rounded-xl bg-primary-soft shrink-0" aria-hidden="true" />
                        )}
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-semibold text-ink truncate">{preview.name}</p>
                            <p className="text-xs text-muted mt-0.5 line-clamp-2">{preview.address}</p>
                            <div className="flex items-center gap-3 mt-1.5 text-xs text-ink">
                                {preview.rating !== undefined && (
                                    <span className="font-semibold tabular-nums">★ {preview.rating.toFixed(1)}</span>
                                )}
                                {preview.totalRatings !== undefined && (
                                    <span className="text-muted tabular-nums">
                                        {preview.totalRatings.toLocaleString('en-IN')} reviews
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-3 mt-4">
                        <button
                            type="button"
                            onClick={confirm}
                            className="rounded-lg bg-primary-strong text-white px-4 py-2 text-sm font-semibold hover:opacity-90 transition-opacity"
                        >
                            Confirm this is my restaurant
                        </button>
                        <button
                            type="button"
                            onClick={() => {
                                setPreview(null);
                                setNameInput('');
                            }}
                            className="text-xs font-semibold text-muted hover:text-ink"
                        >
                            Not this one
                        </button>
                    </div>
                </div>
            )}

            {onCancel && !preview && (
                <button type="button" onClick={onCancel} className="text-xs font-semibold text-muted hover:text-ink">
                    Enter details manually instead
                </button>
            )}
        </div>
    );
};

export default PlacePicker;
